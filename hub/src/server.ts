import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve, sep } from 'node:path';
import type { Server, ServerWebSocket } from 'bun';
import { Hono, type Context, type Next } from 'hono';
import type { FloorAdmin } from './floor-admin';
import { isRoleId } from './memory';
import { isHookEvent, type Office } from './office';
import { hostAllowed, injectKey, keyMatches, originAllowed } from './security';
import type { SettingsService } from './settings';
import { record, text } from './state-machine';
import type { ClientMessage, HookMeta, HubText, PlanDecision, ServerMessage } from './types';

type WsData = { authed: boolean; timer: ReturnType<typeof setTimeout> | null };

export type ServerOptions = {
  office: Office;
  port: number;
  key: () => string;
  publicDir: string;
  dev?: boolean;
  settings?: SettingsService;
  floors?: FloorAdmin;
};

export type RunningServer = { server: Server<WsData>; stop: () => void };

export const AUTH_TIMEOUT_MS = 1000;
const PLAN_DECISIONS: readonly PlanDecision[] = ['ejecutar', 'aparcar', 'cerrar'];
const MAX_ORDER_LENGTH = 4000;
const PENDING_MESSAGE: HubText = { key: 'hub.api.questionClosed' };

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

  app.get('/health', (c) => c.text('ok'));

  app.post('/events', requireKey, async (c) => {
    const event = await readJson(c);
    const output = isHookEvent(event) ? office.ingest(event, metaOf(c)) : null;
    return output ? c.body(output, 200, { 'Content-Type': 'application/json' }) : c.body(null, 200);
  });

  app.post('/guard', requireKey, async (c) => {
    const event = await readJson(c);
    const decision = isHookEvent(event) ? office.guard(event, metaOf(c)) : { pass: true, reason: '' };
    return c.text(decision.pass ? 'pass' : `block:${decision.reason}`);
  });

  app.post('/ask', requireKey, async (c) => {
    const event = await readJson(c);
    if (!isHookEvent(event)) return c.body(null, 200);
    holdRequest(c.req.raw);
    const body = await office.ask(event, metaOf(c), c.req.raw.signal);
    return body ? c.body(body, 200, { 'Content-Type': 'application/json' }) : c.body(null, 200);
  });

  app.post('/permission', requireKey, async (c) => {
    const event = await readJson(c);
    if (!isHookEvent(event)) return c.body(null, 200);
    holdRequest(c.req.raw);
    const body = await office.permission(event, metaOf(c), c.req.raw.signal);
    return body ? c.body(body, 200, { 'Content-Type': 'application/json' }) : c.body(null, 200);
  });

  app.post('/gate', requireKey, async (c) => {
    const event = await readJson(c);
    const decision = isHookEvent(event) ? office.gate(event) : { pass: true, reason: '' };
    return c.text(decision.pass ? 'pass' : `block:${decision.reason}`);
  });

  app.post('/gate-message', requireKey, async (c) => {
    const event = await readJson(c);
    const decision = isHookEvent(event) ? office.gateMessage(event) : { pass: true, reason: '' };
    return c.text(decision.pass ? 'pass' : `block:${decision.reason}`);
  });

  app.post('/usage', requireKey, async (c) => c.text(office.ingestUsage(await readJson(c))));

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
    return c.json({ error: { key: 'hub.api.answerMissing' } }, 400);
  });

  app.post('/api/orders', requireKey, async (c) => {
    const body = record(await readJson(c));
    const sessionId = text(body.sessionId);
    const order = text(body.text);
    if (!sessionId || !order) return c.json({ error: { key: 'hub.api.orderFields' } }, 400);
    if (order.length > MAX_ORDER_LENGTH) return c.json({ error: { key: 'hub.api.orderTooLong' } }, 400);
    const result = await office.order(sessionId, order);
    if (result === 'ok') return c.json({ ok: true });
    if (result === 'not-found') return c.json({ error: { key: 'hub.api.sessionNotFound' } }, 404);
    return c.json({ error: { key: 'hub.api.orderFailed' } }, 502);
  });

  app.get('/api/settings', requireKey, (c) => {
    if (!opts.settings) return c.json({ error: { key: 'hub.api.settingsUnavailable' } }, 503);
    return c.json(opts.settings.view());
  });

  app.post('/api/settings', requireKey, async (c) => {
    if (!opts.settings) return c.json({ ok: false, error: [{ key: 'hub.api.settingsUnavailable' }] }, 503);
    const result = opts.settings.update(await readJson(c));
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post('/api/floors', requireKey, async (c) => {
    if (!opts.floors) return c.json({ ok: false, error: { key: 'hub.api.floorsUnavailable' } }, 503);
    const result = opts.floors.add(await readJson(c));
    return c.json(result, result.ok ? 200 : result.status);
  });

  app.delete('/api/floors/:slug', requireKey, async (c) => {
    if (!opts.floors) return c.json({ ok: false, error: { key: 'hub.api.floorsUnavailable' } }, 503);
    holdRequest(c.req.raw);
    const result = await opts.floors.remove(c.req.param('slug') ?? '');
    return c.json(result, result.ok ? 200 : result.status);
  });

  app.get('/api/memory/:floor/:role', requireKey, (c) => {
    const floor = c.req.param('floor') ?? '';
    const role = c.req.param('role');
    if (!floor || floor.length > 80 || !isRoleId(role)) return c.json({ error: { key: 'hub.api.badMemoryTarget' } }, 400);
    return c.json(office.memoryView(floor, role));
  });

  app.post('/api/memory', requireKey, async (c) => {
    const result = office.addLesson(await readJson(c));
    if (result.ok) return c.json({ lesson: result.lesson });
    return c.json({ error: result.error }, result.status === 409 ? 409 : 400);
  });

  app.delete('/api/memory/:id', requireKey, (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: { key: 'hub.api.badId' } }, 400);
    return office.removeLesson(id) ? c.json({ ok: true }) : c.json({ error: { key: 'hub.api.lessonNotFound' } }, 404);
  });

  app.get('/api/reports/:agentKey', requireKey, (c) => {
    const report = office.report(c.req.param('agentKey') ?? '');
    return report ? c.json(report) : c.json({ error: { key: 'hub.api.noReport' } }, 404);
  });

  app.get('/api/documents', requireKey, (c) => c.json(office.documents()));

  app.get('/api/documents/content', requireKey, (c) => {
    const content = office.documentContent(c.req.query('path') ?? '');
    return content ? c.json(content) : c.json({ error: { key: 'hub.api.documentNotFound' } }, 404);
  });

  app.post('/api/documents/discard', requireKey, async (c) => {
    const path = text(record(await readJson(c)).path);
    if (!path) return c.json({ error: { key: 'hub.api.pathRequired' } }, 400);
    const result = await office.discardDocument(path);
    if (result === 'ok') return c.json({ ok: true });
    if (result === 'closed') return c.json({ error: { key: 'hub.api.planClosed' } }, 409);
    return c.json({ error: { key: 'hub.api.planNotFound' } }, 404);
  });

  app.post('/api/documents/decide', requireKey, async (c) => {
    const body = record(await readJson(c));
    const path = text(body.path);
    const decision = body.decision;
    if (!path || !isPlanDecision(decision)) return c.json({ error: { key: 'hub.api.decisionFields' } }, 400);
    const result = await office.decidePlan(path, decision);
    if (result === 'ok') return c.json({ ok: true });
    if (result === 'not-found') return c.json({ error: { key: 'hub.api.planNotFound' } }, 404);
    if (result === 'invalid-state') return c.json({ error: { key: 'hub.api.planBadState' } }, 409);
    if (result === 'no-director') return c.json({ error: { key: 'hub.api.directorClosed' } }, 409);
    return c.json({ error: { key: 'hub.api.directorUnreachable' } }, 502);
  });

  app.post('/api/redaccion/sync', requireKey, async (c) => {
    holdRequest(c.req.raw);
    const result = await office.syncSources(await readJson(c));
    const asText = c.req.query('format') === 'text';
    if (!result.ok) return asText ? c.text(`ERROR: ${result.error}\n`, 400) : c.json({ error: result.error }, 400);
    return asText ? c.text(`${result.text}\n`) : c.json(result);
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
            opts.office.panelConnected();
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
        if (clients.delete(ws)) opts.office.panelDisconnected();
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

export const CUSTOM_MODELS_INDEX = '/assets/characters/custom/index.json';

export function customModels(publicDir: string): string[] {
  try {
    return readdirSync(join(publicDir, 'assets', 'characters', 'custom'))
      .filter((name) => /^[A-Za-z0-9_-]+\.glb$/.test(name))
      .sort();
  } catch {
    return [];
  }
}

function serveStatic(path: string, opts: ServerOptions): Response {
  if (path === '/' || path === '/index.html') return indexResponse(opts);
  if (path === CUSTOM_MODELS_INDEX) {
    return new Response(JSON.stringify(customModels(opts.publicDir)), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
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

function isPlanDecision(value: unknown): value is PlanDecision {
  return typeof value === 'string' && (PLAN_DECISIONS as readonly string[]).includes(value);
}
