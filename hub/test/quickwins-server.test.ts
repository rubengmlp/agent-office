import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLog } from '../src/log';
import { broadcast, MAX_WS_PAYLOAD, startServer } from '../src/server';
import { shutdownSequence } from '../src/shutdown';
import { floor, harness, tempDir } from './helpers';

const KEY = 'q'.repeat(64);

async function freePort(): Promise<number> {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
  const port = Number(probe.port);
  probe.stop(true);
  return port;
}

describe('log', () => {
  test('hub.log is mode 600 and rotates to hub.log.1 past the maximum size', () => {
    const t = tempDir();
    try {
      const log = createLog(t.dir, { maxBytes: 300 });
      for (let i = 0; i < 3; i += 1) log(`línea ${i} ${'x'.repeat(60)}`);
      expect(existsSync(join(t.dir, 'hub.log.1'))).toBe(false);
      for (let i = 3; i < 12; i += 1) log(`línea ${i} ${'x'.repeat(60)}`);
      expect(existsSync(join(t.dir, 'hub.log.1'))).toBe(true);
      expect(statSync(join(t.dir, 'hub.log')).size).toBeLessThanOrEqual(300);
      expect(statSync(join(t.dir, 'hub.log')).mode & 0o777).toBe(0o600);
      expect(readFileSync(join(t.dir, 'hub.log'), 'utf8')).toContain('línea 11');
      expect(readFileSync(join(t.dir, 'hub.log.1'), 'utf8')).toContain('línea');
    } finally {
      t.cleanup();
    }
  });
});

describe('broadcast', () => {
  test('a client that throws or drops the message is removed and the others still receive it', () => {
    const got: string[] = [];
    const dropped: string[] = [];
    const ok = { name: 'ok', send: (payload: string) => (got.push(payload), payload.length) };
    const broken = {
      name: 'broken',
      send: (_payload: string): number => {
        throw new Error('closed');
      },
    };
    const full = { name: 'full', send: (_payload: string) => 0 };
    const after = { name: 'after', send: (payload: string) => (got.push(`after:${payload}`), payload.length) };
    broadcast([ok, broken, full, after], 'hola', (client) => dropped.push(client.name));
    expect(got).toEqual(['hola', 'after:hola']);
    expect(dropped).toEqual(['broken', 'full']);
  });

  test('a listener of the office that throws is logged and keeps listening', () => {
    const lines: string[] = [];
    const h = harness({ log: (text) => lines.push(text) });
    try {
      let calls = 0;
      h.office.subscribe(() => {
        calls += 1;
        throw new Error('listener roto');
      });
      const seen: string[] = [];
      h.office.subscribe((msg) => seen.push(msg.type));
      h.office.heartbeat(true);
      h.office.ingest({ session_id: 's1', cwd: h.workspace, hook_event_name: 'SessionStart' });
      h.office.ingest({ session_id: 's1', cwd: h.workspace, hook_event_name: 'Notification', message: 'x' });
      expect(calls).toBeGreaterThan(1);
      expect(seen.length).toBeGreaterThan(1);
      expect(lines.some((line) => line.includes('listener roto'))).toBe(true);
    } finally {
      h.cleanup();
    }
  });
});

describe('shutdown', () => {
  const fakeDb = () => {
    const closed: string[] = [];
    return { closed, db: { close: () => void closed.push('db') } };
  };

  test('waits for the pending work and only then closes the database', async () => {
    const order: string[] = [];
    let release = (): void => {};
    const idle = new Promise<void>((resolve) => (release = resolve));
    const { db, closed } = fakeDb();
    const done = shutdownSequence({
      stopServer: () => order.push('server'),
      office: { stop: () => order.push('office'), idle: () => idle.then(() => void order.push('idle')) },
      db: { close: () => (order.push('db'), db.close()) },
      timeoutMs: 2000,
    });
    await Bun.sleep(20);
    expect(order).toEqual(['server', 'office']);
    release();
    expect(await done).toEqual({ timedOut: false });
    expect(order).toEqual(['server', 'office', 'idle', 'db']);
    expect(closed).toEqual(['db']);
  });

  test('gives up after the cap when the pending work never ends', async () => {
    const { db, closed } = fakeDb();
    const start = Date.now();
    const result = await shutdownSequence({ stopServer: () => {}, office: { stop: () => {}, idle: () => new Promise<void>(() => {}) }, db, timeoutMs: 60 });
    expect(result).toEqual({ timedOut: true });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(closed).toEqual(['db']);
  });
});

describe('server limits and errors', () => {
  const lines: string[] = [];
  const h = harness({ holdMs: 30_000 });
  const repo = join(h.root, 'mobile');
  const headers = { 'Content-Type': 'application/json', 'X-Office-Key': KEY };
  let base = '';
  let port = 0;
  let stop = () => {};

  beforeAll(async () => {
    mkdirSync(repo, { recursive: true });
    h.config.floors.mobile = floor(repo);
    const publicDir = join(h.root, 'public');
    mkdirSync(publicDir, { recursive: true });
    writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>x</title>');
    port = await freePort();
    base = `http://127.0.0.1:${port}`;
    ({ stop } = startServer({ office: h.office, port, key: () => KEY, publicDir, log: (text) => lines.push(text) }));
  });

  afterAll(() => {
    stop();
    h.cleanup();
  });

  const post = (path: string, body: string) => fetch(`${base}${path}`, { method: 'POST', headers, body });

  test('an unexpected error answers 500 with a key and is written to the log, with the key of the hub', async () => {
    const original = h.office.snapshot.bind(h.office);
    h.office.snapshot = () => {
      throw new Error('snapshot roto');
    };
    try {
      const res = await fetch(`${base}/api/state`, { headers });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: { key: 'hub.api.internalError' } });
      expect(lines.some((line) => line.includes('GET /api/state') && line.includes('snapshot roto'))).toBe(true);
      expect((await fetch(`${base}/api/state`)).status).toBe(401);
    } finally {
      h.office.snapshot = original;
    }
  });

  test('the panel API takes 1 MB, the hook and chat routes 8 MB, and over the limit answers 413 with a key', async () => {
    const pad = (bytes: number) => JSON.stringify({ sessionId: 'x', text: 'y', pad: 'z'.repeat(bytes) });
    const small = await post('/api/orders', pad(1000));
    expect(small.status).not.toBe(413);
    const big = await post('/api/orders', pad(1_100_000));
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: { key: 'hub.api.bodyTooLarge' } });
    const event = (bytes: number) => JSON.stringify({ session_id: 'big-1', cwd: repo, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_response: 'r'.repeat(bytes) });
    expect((await post('/events', event(3_000_000))).status).toBe(200);
    expect((await post('/hook', event(2_000_000))).status).toBe(200);
    const huge = await post('/events', event(9_000_000));
    expect(huge.status).toBe(413);
    const chat = await post('/api/chat/mobile', JSON.stringify({ text: 'a'.repeat(2_000_000) }));
    expect(chat.status).not.toBe(413);
  });

  test('a websocket message of 32 KB closes the socket', async () => {
    expect(MAX_WS_PAYLOAD).toBe(16 * 1024);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live`, { headers: { Origin: base } });
    await new Promise<void>((resolve) => {
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: KEY }));
      ws.onmessage = () => resolve();
    });
    const closed = new Promise<number>((resolve) => {
      ws.onclose = (e) => resolve(e.code);
    });
    ws.send(JSON.stringify({ type: 'heartbeat', visible: true, pad: 'p'.repeat(32 * 1024) }));
    const code = await Promise.race([closed, Bun.sleep(2000).then(() => -1)]);
    expect(code).not.toBe(-1);
    expect(code).not.toBe(1000);
  });
});
