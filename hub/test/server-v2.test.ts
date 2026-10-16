import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDocsRepo } from '../src/docs-repo';
import type { FloorAdmin } from '../src/floor-admin';
import { startServer } from '../src/server';
import type { SettingsService } from '../src/settings';
import { settingsView } from '../src/settings';
import { floor, harness, useGitIdentity } from './helpers';

useGitIdentity();
const KEY = 'v'.repeat(64);

async function freePort(): Promise<number> {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
  const port = Number(probe.port);
  probe.stop(true);
  return port;
}

describe('hub server v2 routes', () => {
  const h = harness({
    configure: (config) => {
      config.departments = { redaccion: true, mantenimiento: true };
    },
  });
  const repo = join(h.root, 'mobile');
  const docs = join(h.root, 'docs');
  const updates: unknown[] = [];
  const settings: SettingsService = {
    view: () => settingsView(h.config),
    update: (raw) => {
      updates.push(raw);
      return raw && typeof raw === 'object' && 'roles' in raw ? { ok: true, regenerated: 11, note: 'Guardado.' } : { ok: false, error: 'Nada que guardar' };
    },
  };
  const floorCalls: unknown[] = [];
  const floors: FloorAdmin = {
    add: (raw) => {
      floorCalls.push(raw);
      return raw && typeof raw === 'object' && 'path' in raw
        ? { ok: true, slug: 'web', path: '/tmp/web', stack: 'node', startCommand: 'claude', note: 'Planta web gestionada.' }
        : { ok: false, status: 400, error: 'Indica la ruta del repositorio.' };
    },
    remove: async (slug) => {
      floorCalls.push(slug);
      return { ok: false, status: 404, error: `No hay ninguna planta "${slug}".` };
    },
  };
  let base = '';
  let stop = () => {};
  const headers = { 'Content-Type': 'application/json', 'X-Office-Key': KEY };
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

  beforeAll(async () => {
    mkdirSync(repo, { recursive: true });
    ensureDocsRepo(docs);
    h.config.floors.mobile = floor(repo);
    const publicDir = join(h.root, 'public');
    mkdirSync(publicDir, { recursive: true });
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    ({ stop } = startServer({ office: h.office, port, key: () => KEY, publicDir, settings, floors }));
  });

  afterAll(() => {
    stop();
    h.cleanup();
  });

  test('health answers without the key and says nothing else', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  test('a starting lead receives its memory as additional context', async () => {
    h.office.addLesson({ floor: 'mobile', role: 'lead', text: 'Pide siempre el contrato a backend antes de repartir' });
    const res = await fetch(`${base}/events`, {
      method: 'POST',
      headers: { ...headers, 'X-Office-Role': 'office-lead-mobile', 'X-Office-Name': 'lead-mobile' },
      body: JSON.stringify({ session_id: 'lead-1', cwd: repo, hook_event_name: 'SessionStart', source: 'startup' }),
    });
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(body.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(body.hookSpecificOutput.additionalContext).toContain('Pide siempre el contrato');
    const quiet = await call('POST', '/events', { session_id: 'lead-1', cwd: repo, hook_event_name: 'Stop' });
    expect(await quiet.text()).toBe('');
  });

  test('the guard blocks a department write outside its folder', async () => {
    const event = (file: string) => ({
      session_id: 'red-1',
      cwd: join(docs, 'redaccion'),
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: file, content: 'x' },
    });
    const blocked = await fetch(`${base}/guard`, {
      method: 'POST',
      headers: { ...headers, 'X-Office-Role': 'office-lead-redaccion' },
      body: JSON.stringify(event(join(repo, 'lib', 'a.dart'))),
    });
    expect(await blocked.text()).toStartWith('block:Guardia de Agent Office');
    const allowed = await call('POST', '/guard', event(join(docs, 'redaccion', 'planes', 'x.md')));
    expect(await allowed.text()).toBe('pass');
    expect((await fetch(`${base}/guard`, { method: 'POST', body: '{}' })).status).toBe(401);
  });

  test('settings go through the settings service', async () => {
    const view = (await (await call('GET', '/api/settings')).json()) as { departments: { redaccion: boolean } };
    expect(view.departments.redaccion).toBe(true);
    const saved = await call('POST', '/api/settings', { roles: { dev: { model: 'haiku' } } });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ ok: true, regenerated: 11, note: 'Guardado.' });
    const refused = await call('POST', '/api/settings', { nada: true });
    expect(refused.status).toBe(400);
    expect(updates).toHaveLength(2);
  });

  test('floors are added and deleted through the floor admin', async () => {
    const created = await call('POST', '/api/floors', { path: '/tmp/web' });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ ok: true, slug: 'web' });
    const refused = await call('POST', '/api/floors', {});
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ ok: false, error: 'Indica la ruta del repositorio.' });
    const missing = await call('DELETE', '/api/floors/x');
    expect(missing.status).toBe(404);
    expect(floorCalls).toEqual([{ path: '/tmp/web' }, {}, 'x']);
    expect((await fetch(`${base}/api/floors`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(`${base}/api/floors/x`, { method: 'DELETE' })).status).toBe(401);
  });

  test('memory: list, add, refuse duplicates and delete', async () => {
    expect((await call('GET', '/api/memory/mobile/jefe')).status).toBe(400);
    const added = await call('POST', '/api/memory', { floor: 'mobile', role: 'tester', text: 'Arranca el emulador antes de los flow tests' });
    expect(added.status).toBe(200);
    const { lesson } = (await added.json()) as { lesson: { id: number; origin: string } };
    expect(lesson.origin).toBe('user');
    expect((await call('POST', '/api/memory', { floor: 'mobile', role: 'tester', text: 'arranca el emulador antes de los flow tests' })).status).toBe(409);
    const view = (await (await call('GET', '/api/memory/mobile/tester')).json()) as { lessons: { id: number }[]; reports: unknown[] };
    expect(view.lessons.map((l) => l.id)).toEqual([lesson.id]);
    expect(await (await call('DELETE', `/api/memory/${lesson.id}`)).json()).toEqual({ ok: true });
    expect((await call('DELETE', `/api/memory/${lesson.id}`)).status).toBe(404);
    expect((await call('DELETE', '/api/memory/abc')).status).toBe(400);
  });

  test('reports, documents and sources answer with clear errors', async () => {
    expect((await call('GET', '/api/reports/nadie')).status).toBe(404);
    const live = await call('GET', '/api/reports/lead-1');
    expect(((await live.json()) as { agentKey: string }).agentKey).toBe('lead-1');
    expect(await (await call('GET', '/api/documents')).json()).toEqual([]);
    expect((await call('GET', '/api/documents/content?path=redaccion/planes/x.md')).status).toBe(404);
    expect((await call('POST', '/api/documents/discard', {})).status).toBe(400);
    expect((await call('POST', '/api/documents/discard', { path: 'redaccion/planes/x.md' })).status).toBe(404);
    const bad = await call('POST', '/api/redaccion/sync', { slug: 'Mal', floors: [] });
    expect(bad.status).toBe(400);
    const text = await call('POST', '/api/redaccion/sync?format=text', { slug: 'x', floors: [] });
    expect(await text.text()).toStartWith('ERROR:');
  });
});
