import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { READ_LIMIT } from '../src/chat';
import { startServer } from '../src/server';
import type { ChatMessageView } from '../src/types';
import { ev, floor, harness } from './helpers';

const KEY = 'c'.repeat(64);
const LEAD = '22222222-bbbb-4ccc-8ddd-000000000002';

async function freePort(): Promise<number> {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
  const port = Number(probe.port);
  probe.stop(true);
  return port;
}

describe('chat routes', () => {
  const h = harness();
  const repo = join(h.root, 'mobile');
  let base = '';
  let stop = () => {};
  const agentHeaders = { 'X-Office-Key': KEY, 'X-Office-Name': 'lead-mobile', 'X-Office-Role': 'office-lead-mobile' };

  const say = (text: string, extra: Record<string, string> = {}, format = '?format=text') =>
    fetch(`${base}/chat${format}`, {
      method: 'POST',
      headers: agentHeaders,
      body: new URLSearchParams({ channel: 'mobile', kind: 'texto', text, cwd: repo, ...extra }),
    });
  const read = (query: string) => fetch(`${base}/chat/mobile${query}`, { headers: { 'X-Office-Key': KEY } });
  const panel = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'X-Office-Key': KEY, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    mkdirSync(repo, { recursive: true });
    h.config.floors.mobile = floor(repo);
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { source: 'startup' }), { socket: null, token: null, role: 'office-lead-mobile', name: 'lead-mobile' });
    const publicDir = join(h.root, 'public');
    mkdirSync(publicDir, { recursive: true });
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    ({ stop } = startServer({ office: h.office, port, key: () => KEY, publicDir }));
  });

  afterAll(() => {
    stop();
    h.cleanup();
  });

  test('the script posts a form and gets the id back as text', async () => {
    const res = await say('hola equipo');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Publicado #1 en #mobile.\n');
  });

  test('without the key nothing is posted', async () => {
    const res = await fetch(`${base}/chat?format=text`, { method: 'POST', body: new URLSearchParams({ channel: 'mobile', text: 'x', cwd: repo }) });
    expect(res.status).toBe(401);
  });

  test('a toca with several files= fields claims them all, and a second claim warns', async () => {
    const form = new URLSearchParams({ channel: 'mobile', kind: 'toca', text: 'login', cwd: repo });
    form.append('files', 'lib/a.dart');
    form.append('files', 'lib/b.dart');
    const res = await fetch(`${base}/chat`, { method: 'POST', headers: agentHeaders, body: form });
    const body = (await res.json()) as { message: ChatMessageView };
    expect(body.message).toMatchObject({ kind: 'toca', files: ['lib/a.dart', 'lib/b.dart'], authorName: 'lead-mobile' });
    expect(h.office.chat.openClaims('mobile').map((c) => c.file)).toEqual(['lib/a.dart', 'lib/b.dart']);
  });

  test('reading from desde lists the lines as text', async () => {
    const res = await read('?desde=0&format=text');
    const lines = (await res.text()).trim().split('\n');
    expect(lines[0]).toMatch(/^#1 \d\d:\d\d lead-mobile \(jefe\): hola equipo$/);
    expect(lines[1]).toMatch(/TOCA lib\/a\.dart, lib\/b\.dart — login$/);
  });

  test('a wait with desde stays open and returns what another request posts', async () => {
    const started = Date.now();
    const waiting = read(`?desde=${h.office.chat.lastId('mobile')}&esperar=2`);
    await Bun.sleep(100);
    await say('respuesta');
    const messages = (await (await waiting).json()) as ChatMessageView[];
    expect(messages.map((m) => m.text)).toEqual(['respuesta']);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('a wait without desde does not return the old ones at once, only what comes next', async () => {
    const waiting = read('?esperar=2&format=text');
    await Bun.sleep(100);
    await say('lo siguiente');
    const out = (await (await waiting).text()).trim().split('\n');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('lo siguiente');
  });

  test('a wait that times out says there is nothing new', async () => {
    const last = h.office.chat.lastId('mobile');
    const res = await read(`?desde=${last}&esperar=1&format=text`);
    expect(await res.text()).toBe(`Sin mensajes nuevos en #mobile desde #${last}.\n`);
  });

  test('without desde nor esperar the latest ones come back at once', async () => {
    for (let i = 0; i < READ_LIMIT; i += 1) h.office.postChat({ channel: 'mobile', text: `m${i}`, cwd: repo }, { socket: null, token: null, role: null, name: 'lead-mobile' });
    const messages = (await (await read('')).json()) as ChatMessageView[];
    expect(messages).toHaveLength(READ_LIMIT);
    expect(messages.at(-1)?.text).toBe(`m${READ_LIMIT - 1}`);
  });

  test('an unknown channel is a 404 with its key, or an ERROR line as text', async () => {
    const res = await fetch(`${base}/chat/nada`, { headers: { 'X-Office-Key': KEY } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { key: 'hub.api.chatChannelUnknown' } });
    const asText = await fetch(`${base}/chat/nada?format=text`, { headers: { 'X-Office-Key': KEY } });
    expect(asText.status).toBe(404);
    expect(await asText.text()).toStartWith('ERROR: ');
  });

  test('a text too long is refused with 400', async () => {
    const res = await say('x'.repeat(2001), {}, '');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { key: 'hub.api.chatTooLong' } });
  });

  test('the panel writes in a channel and pages its history', async () => {
    const res = await panel('POST', '/api/chat/mobile', { text: '¿cómo vais?' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: ChatMessageView; delivered: number };
    expect(body).toMatchObject({ message: { origin: 'user', text: '¿cómo vais?' }, delivered: 0 });
    const page = (await (await panel('GET', `/api/chat/mobile?before=${body.message.id}`)).json()) as ChatMessageView[];
    expect(page.at(-1)?.id).toBe(body.message.id - 1);
    expect((await panel('POST', '/api/chat/mobile', { text: '' })).status).toBe(400);
    expect((await panel('POST', '/api/chat/nada', { text: 'x' })).status).toBe(404);
    expect((await panel('GET', '/api/chat/nada')).status).toBe(404);
  });
});
