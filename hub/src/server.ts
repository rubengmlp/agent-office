import { readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import type { Server, ServerWebSocket } from 'bun';
import { Hono, type Context, type Next } from 'hono';
import { isHookEvent, type Office } from './office';
import { hostAllowed, injectKey, keyMatches, originAllowed } from './security';
import { record, text } from './state-machine';
import type { ClientMessage, HookMeta, ServerMessage } from './types';

type WsData = { authed: boolean; timer: ReturnType<typeof setTimeout> | null };

export type ServerOptions = {
  office: Office;
  port: number;
  key: () => string;
  publicDir: string;
  dev?: boolean;
};

export type RunningServer = { server: Server<WsData>; stop: () => void };

export const AUTH_TIMEOUT_MS = 1000;
const MAX_ORDER_LENGTH = 4000;
const PENDING_MESSAGE = 'La pregunta ya no está pendiente';

const MISSING_UI = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Agent Office</title></head>
<body style="font-family:system-ui;padding:2rem"><h1>Agent Office</h1>
<p>El hub está en marcha, pero la interfaz no está compilada. Ejecuta <code>bun run build</code> en el repositorio y recarga.</p></body></html>`;

export function createApp(opts: ServerOptions, holdRequest: (req: Request) => void): Hono {
  const app = new Hono();
  const { office, port } = opts;

  app.use('*', async (c, next) => {
    if (!hostAllowed(c.req.header('host'), port)) return c.text('forbidden', 403);
    await next();
  });

  const requireKey = async (c: Context, next: Next) => {
    if (!keyMatches(c.req.header('x-office-key'), opts.key())) return c.text('unauthorized', 401);
    await next();
  };

  app.post('/events', requireKey, async (c) => {
    const event = await readJson(c);
    if (isHookEvent(event)) office.ingest(event, metaOf(c));
    return c.body(null, 200);
  });

  app.post('/ask', requireKey, async (c) => {
    const event = await readJson(c);
    if (!isHookEvent(event)) return c.body(null, 200);
    holdRequest(c.req.raw);
    const body = await office.ask(event, metaOf(c));
    return body ? c.body(body, 200, { 'Content-Type': 'application/json' }) : c.body(null, 200);
  });

  app.post('/gate', requireKey, async (c) => {
    const event = await readJson(c);
    const decision = isHookEvent(event) ? office.gate(event) : { pass: true, reason: '' };
    return c.text(decision.pass ? 'pass' : `block:${decision.reason}`);
  });

  app.get('/api/state', requireKey, (c) => c.json(office.snapshot()));

  app.post('/api/answers/:id', requireKey, async (c) => {
    const body = record(await readJson(c));
    const id = c.req.param('id') ?? '';
    if (body.release === true) {
      return office.release(id) === 'ok' ? c.json({ ok: true }) : c.json({ error: PENDING_MESSAGE }, 409);
    }
    const result = office.answer(id, body.answers);
    if (result === 'ok') return c.json({ ok: true });
    if (result === 'closed') return c.json({ error: PENDING_MESSAGE }, 409);
    return c.json({ error: 'Falta la respuesta de alguna pregunta' }, 400);
  });

  app.post('/api/orders', requireKey, async (c) => {
    const body = record(await readJson(c));
    const sessionId = text(body.sessionId);
    const order = text(body.text);
    if (!sessionId || !order) return c.json({ error: 'sessionId y text son obligatorios' }, 400);
    if (order.length > MAX_ORDER_LENGTH) return c.json({ error: 'La orden es demasiado larga' }, 400);
    const result = await office.order(sessionId, order);
    if (result === 'ok') return c.json({ ok: true });
    if (result === 'not-found') return c.json({ error: 'Sesión no encontrada' }, 404);
    return c.json({ error: 'No se pudo entregar la orden' }, 502);
  });

  app.get('*', (c) => serveStatic(c.req.path, opts));
  return app;
}

export function startServer(opts: ServerOptions): RunningServer {
  const clients = new Set<ServerWebSocket<WsData>>();
  let running: Server<WsData> | null = null;
  const app = createApp(opts, (req) => running?.timeout(req, 0));

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: opts.port,
    idleTimeout: 30,
    fetch(req, srv) {
      if (new URL(req.url).pathname === '/live') {
        const allowed =
          hostAllowed(req.headers.get('host'), opts.port) &&
          originAllowed(req.headers.get('origin'), opts.port, !!opts.dev);
        if (!allowed) return new Response('forbidden', { status: 403 });
        if (srv.upgrade(req, { data: { authed: false, timer: null } })) return undefined;
        return new Response('upgrade required', { status: 426 });
      }
      return app.fetch(req);
    },
    websocket: {
      data: {} as WsData,
      open(ws) {
        ws.data.timer = setTimeout(() => {
          if (!ws.data.authed) ws.close(4401, 'auth');
        }, AUTH_TIMEOUT_MS);
      },
      message(ws, raw) {
        const msg = parseClientMessage(raw);
        if (!ws.data.authed) {
          if (msg?.type === 'auth' && keyMatches(msg.key, opts.key())) {
            ws.data.authed = true;
            if (ws.data.timer) clearTimeout(ws.data.timer);
            clients.add(ws);
            const snapshot: ServerMessage = { type: 'snapshot', data: opts.office.snapshot() };
            ws.send(JSON.stringify(snapshot));
          } else {
            ws.close(4401, 'auth');
          }
          return;
        }
        if (msg?.type === 'heartbeat') opts.office.heartbeat(msg.visible === true);
      },
      close(ws) {
        clients.delete(ws);
        if (ws.data.timer) clearTimeout(ws.data.timer);
      },
    },
  });
  running = server;

  const unsubscribe = opts.office.subscribe((msg) => {
    const payload = JSON.stringify(msg);
    for (const ws of clients) ws.send(payload);
  });

  return {
    server,
    stop: () => {
      unsubscribe();
      server.stop(true);
    },
  };
}

function serveStatic(path: string, opts: ServerOptions): Response {
  if (path === '/' || path === '/index.html') return indexResponse(opts);
  const root = resolve(opts.publicDir);
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const file = resolve(root, `.${normalize(decoded)}`);
  if (!file.startsWith(root + sep)) return new Response('not found', { status: 404 });
  try {
    if (!statSync(file).isFile()) return new Response('not found', { status: 404 });
  } catch {
    return new Response('not found', { status: 404 });
  }
  return new Response(Bun.file(file));
}

function indexResponse(opts: ServerOptions): Response {
  let html = MISSING_UI;
  try {
    html = readFileSync(join(opts.publicDir, 'index.html'), 'utf8');
  } catch {}
  return new Response(injectKey(html, opts.key()), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function metaOf(c: Context): HookMeta {
  const header = (name: string) => text(c.req.header(name) ?? null);
  return {
    socket: header('x-office-socket'),
    token: header('x-office-token'),
    role: header('x-office-role'),
    name: header('x-office-name'),
  };
}

function parseClientMessage(raw: string | Buffer): ClientMessage | null {
  try {
    const value = record(JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')));
    if (value.type === 'auth' && typeof value.key === 'string') return { type: 'auth', key: value.key };
    if (value.type === 'heartbeat') return { type: 'heartbeat', visible: value.visible === true };
    return null;
  } catch {
    return null;
  }
}
