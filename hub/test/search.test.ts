import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { purgeFloorData } from '../src/floor-data';
import { pruneInChunks } from '../src/prune';
import { SearchDesk, parseCursor, parseSearchParams, termsOf } from '../src/search';
import { createApp } from '../src/server';
import type { ActivityView, ChatMessageView, HubText, MessageView } from '../src/types';
import { ev, floor, harness, keyOf, type Harness } from './helpers';

const DAY = 86_400_000;
const T0 = 1_800_000_000_000;

function desk(opts: { noFts?: boolean } = {}) {
  const db = openDb(':memory:');
  const owners: Record<string, { floor: string | null; sessionId: string | null }> = {
    'lead-mobile': { floor: 'mobile', sessionId: 'sess-1' },
    'dev-api': { floor: 'backend', sessionId: 'sess-2' },
  };
  const search = new SearchDesk({ db, resolve: (key) => owners[key] ?? { floor: null, sessionId: null }, ...opts });
  return { db, search };
}

const activity = (ts: number, agentKey: string, summary: HubText): ActivityView => ({ ts, agentKey, event: 'PostToolUse', tool: null, state: null, summary });
const message = (id: number, ts: number, text: string | null, floorName = 'mobile'): MessageView => ({ id, ts, fromKey: 'lead-mobile', toName: 'director', toKey: null, text, floor: floorName });

function addMessage(d: ReturnType<typeof desk>, ts: number, text: string | null, floorName = 'mobile'): MessageView {
  const id = Number(d.db.query('INSERT INTO messages (ts, from_key, to_name, to_key, text, floor) VALUES (?, ?, ?, ?, ?, ?)').run(ts, 'lead-mobile', 'director', null, text, floorName).lastInsertRowid);
  const view = message(id, ts, text, floorName);
  d.search.recordMessage(view);
  return view;
}

function addChat(d: ReturnType<typeof desk>, ts: number, text: string): ChatMessageView {
  const id = Number(
    d.db
      .query('INSERT INTO chat_messages (ts, channel, floor, author_key, author_name, role, origin, kind, text, files) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ts, 'mobile', 'mobile', 'dev-api', 'dev-api', null, 'agent', 'texto', text, '[]').lastInsertRowid,
  );
  const view = { id, ts, channel: 'mobile', floor: 'mobile', authorKey: 'dev-api', authorName: 'dev-api', role: null, roleId: null, origin: 'agent', kind: 'texto', text, files: [] } satisfies ChatMessageView;
  d.search.recordChat(view);
  return view;
}

for (const mode of ['fts', 'like'] as const) {
  describe(`search (${mode})`, () => {
    const fresh = () => {
      const d = desk({ noFts: mode === 'like' });
      d.search.ensureIndex();
      expect(d.search.indexed).toBe(mode === 'fts');
      return d;
    };

    test('finds without caring about accents or case, and by prefix', () => {
      const d = fresh();
      addMessage(d, T0, 'Revisión de Redacción terminada');
      addMessage(d, T0 + 1, 'otra cosa');
      const exact = mode === 'fts' ? 'redaccion' : 'Redacción';
      expect(d.search.search({ q: exact }).hits.map((hit) => hit.text)).toEqual(['Revisión de Redacción terminada']);
      expect(d.search.search({ q: 'REDAC' }).hits).toHaveLength(1);
      expect(d.search.search({ q: 'revision redaccion' }).hits).toHaveLength(mode === 'fts' ? 1 : 0);
      expect(d.search.search({ q: 'zzz' }).hits).toEqual([]);
    });

    test('indexes activity with its rendered summary and keeps the HubText for the panel', () => {
      const d = fresh();
      d.search.recordActivity(activity(T0, 'lead-mobile', { key: 'hub.act.edit', params: { name: 'viajes.dart' } }));
      const result = d.search.search({ q: 'viajes' });
      expect(result.hits).toHaveLength(1);
      const hit = result.hits[0];
      expect(hit).toMatchObject({ kind: 'activity', floor: 'mobile', agent: 'lead-mobile', sessionId: 'sess-1', ts: T0 });
      expect(keyOf(hit.text)).toBe('hub.act.edit');
      expect(result.indexed).toBe(mode === 'fts');
    });

    test('filters by floor, agent, kind and dates', () => {
      const d = fresh();
      d.search.recordActivity(activity(T0, 'lead-mobile', 'pantalla de viajes'));
      d.search.recordActivity(activity(T0 + 10, 'dev-api', 'endpoint de viajes'));
      addMessage(d, T0 + 20, 'viajes cerrados');
      addChat(d, T0 + 30, 'viajes en el chat');
      const all = d.search.search({ q: 'viajes' });
      expect(all.hits.map((hit) => hit.kind)).toEqual(['chat', 'message', 'activity', 'activity']);
      expect(d.search.search({ q: 'viajes', floor: 'backend' }).hits.map((hit) => hit.agent)).toEqual(['dev-api']);
      expect(d.search.search({ q: 'viajes', agent: 'lead-mobile' }).hits.map((hit) => hit.kind)).toEqual(['message', 'activity']);
      expect(d.search.search({ q: 'viajes', kind: 'chat' }).hits).toHaveLength(1);
      expect(d.search.search({ q: 'viajes', from: T0 + 10, to: T0 + 20 }).hits.map((hit) => hit.ts)).toEqual([T0 + 20, T0 + 10]);
    });

    test('pages with the ts:id cursor without repeating or skipping a hit', () => {
      const d = fresh();
      for (let i = 0; i < 7; i++) addMessage(d, T0 + Math.floor(i / 2), `mensaje número ${i}`);
      const seen: string[] = [];
      let before: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = d.search.search({ q: 'mensaje', limit: 3, before });
        seen.push(...result.hits.map((hit) => hit.id));
        if (!result.next) break;
        expect(result.hits).toHaveLength(3);
        before = result.next;
      }
      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
    });

    test('a query with several words needs all of them, and special characters do no harm', () => {
      const d = fresh();
      addMessage(d, T0, 'cien por cien seguro');
      expect(d.search.search({ q: 'cien seguro' }).hits).toHaveLength(1);
      expect(d.search.search({ q: 'cien azul' }).hits).toHaveLength(0);
      for (const nasty of ['"', '*', 'a OR b', "'; DROP TABLE messages; --", '100%', 'a_b', '\\', 'body:x', '(((']) {
        expect(() => d.search.search({ q: nasty })).not.toThrow();
      }
      expect(d.db.query('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 1 });
    });

    test('without text it lists the latest things, newest first', () => {
      const d = fresh();
      addMessage(d, T0, 'uno');
      d.search.recordActivity(activity(T0 + 5, 'lead-mobile', 'dos'));
      const result = d.search.search({});
      expect(result.hits.map((hit) => hit.kind)).toEqual(['activity', 'message']);
      expect(result.indexed).toBe(false);
    });

    test('a message the office hid (observed floors) is neither indexed nor listed', () => {
      const d = fresh();
      addMessage(d, T0, null, 'kapper');
      addMessage(d, T0 + 1, 'visible kapper');
      expect(d.search.search({ q: 'kapper' }).hits).toHaveLength(1);
      expect(d.search.search({}).hits).toHaveLength(1);
    });

    test('kind agent searches the agents table', () => {
      const d = fresh();
      d.db.query('INSERT INTO agents (agent_key, session_id, name, role, floor, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('dev-1', 'sess-1', 'Marta', 'office-dev-mobile', 'mobile', T0, T0 + 5);
      const result = d.search.search({ q: 'marta', kind: 'agent' });
      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]).toMatchObject({ kind: 'agent', id: 'dev-1', sessionId: 'sess-1', text: 'Marta · office-dev-mobile' });
      expect(d.search.search({ q: 'marta' }).hits).toEqual([]);
    });
  });
}

describe('search index', () => {
  test('is created apart from the migrations, outside user_version', () => {
    const d = desk();
    expect(d.db.query("SELECT 1 FROM sqlite_master WHERE name = 'search_fts'").get()).toBeNull();
    expect(d.search.ensureIndex()).toBe(true);
    expect(d.db.query("SELECT 1 FROM sqlite_master WHERE name = 'search_fts'").get()).not.toBeNull();
    expect(d.search.ensureIndex()).toBe(true);
  });

  test('what the office stored before the index existed is indexed once, in slices', async () => {
    const d = desk();
    addMessage(d, T0, 'mensaje antiguo');
    d.db.query('INSERT INTO activity_log (ts, session_id, agent_key, floor, event, summary) VALUES (?, ?, ?, ?, ?, ?)').run(T0 + 1, 's', 'lead-mobile', 'mobile', 'Stop', JSON.stringify({ key: 'hub.act.turnEnd' }));
    d.search.ensureIndex();
    expect(d.search.search({ q: 'antiguo' }).indexed).toBe(true);
    expect(d.search.search({ q: 'antiguo' }).hits).toHaveLength(0);
    await d.search.backfill();
    expect(d.search.search({ q: 'antiguo' }).hits).toHaveLength(1);
    expect(d.search.search({ q: 'turno', kind: 'activity' }).hits).toHaveLength(1);
    await d.search.backfill();
    expect(d.search.search({ q: 'antiguo' }).hits).toHaveLength(1);
  });

  test('retention takes the index with it', async () => {
    const d = desk();
    d.search.ensureIndex();
    addMessage(d, T0 - 40 * DAY, 'viejo recuerdo');
    addMessage(d, T0 - DAY, 'reciente recuerdo');
    expect(d.search.search({ q: 'recuerdo' }).hits).toHaveLength(2);
    await pruneInChunks(d.db, T0, 30);
    expect(d.db.query("SELECT COUNT(*) AS n FROM search_fts WHERE body LIKE '%viejo%'").get()).toEqual({ n: 0 });
    expect(d.search.search({ q: 'recuerdo' }).hits.map((hit) => hit.text)).toEqual(['reciente recuerdo']);
  });

  test('removing a floor removes what the index kept of it', () => {
    const d = desk();
    d.search.ensureIndex();
    addMessage(d, T0, 'secreto de mobile', 'mobile');
    addMessage(d, T0 + 1, 'secreto de backend', 'backend');
    purgeFloorData(d.db, 'mobile', '/nowhere');
    expect(d.search.search({ q: 'secreto' }).hits.map((hit) => hit.floor)).toEqual(['backend']);
    expect(d.db.query("SELECT COUNT(*) AS n FROM search_fts WHERE floor = 'mobile'").get()).toEqual({ n: 0 });
  });

  test('a database without FTS5 keeps working through the plain match', () => {
    const d = desk({ noFts: true });
    expect(d.search.ensureIndex()).toBe(false);
    addMessage(d, T0, 'sin índice');
    expect(d.search.search({ q: 'sin' }).hits).toHaveLength(1);
  });
});

describe('query parameters', () => {
  const parse = (params: Record<string, string>) => parseSearchParams((name) => params[name]);

  test('valid parameters become a query', () => {
    expect(parse({ q: 'hola', floor: 'mobile', kind: 'chat', from: '10', to: '20', limit: '5', before: '30:4' })).toEqual({
      q: 'hola', floor: 'mobile', kind: 'chat', from: 10, to: 20, limit: 5, before: '30:4',
    });
    expect(parse({})).toEqual({});
  });

  test('anything off is refused', () => {
    const bads: Record<string, string>[] = [{ kind: 'nope' }, { from: 'x' }, { limit: '0' }, { limit: '101' }, { before: '5' }, { q: 'x'.repeat(201) }, { to: '-1' }];
    for (const bad of bads) expect(parse(bad)).toBeNull();
  });

  test('terms and cursors', () => {
    expect(termsOf('Redacción: lead-mobile "x"')).toEqual(['Redacción', 'lead', 'mobile', 'x']);
    expect(termsOf('a b c d e f g h i j')).toHaveLength(8);
    expect(parseCursor('12:34')).toEqual({ ts: 12, id: 34 });
    expect(parseCursor('12')).toBeNull();
  });
});

describe('the office persists what it shows', () => {
  let h: Harness;
  afterEach(() => h?.cleanup());
  const LEAD = '22222222-bbbb-4ccc-8ddd-000000000002';

  test('every line of activity goes to activity_log with its floor and session, and is searchable', () => {
    h = harness();
    const repo = join(h.root, 'mobile');
    mkdirSync(repo, { recursive: true });
    h.config.floors.mobile = floor(repo, true, 'flutter');
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { source: 'startup' }), { socket: null, token: null, role: 'office-lead-mobile', name: 'lead-mobile' });
    h.clock.advance(1000);
    h.office.ingest(ev(LEAD, repo, 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: join(repo, 'lib', 'viajes.dart') } }));
    const rows = h.db.query<{ session_id: string; floor: string; agent_key: string; summary: string }, []>('SELECT session_id, floor, agent_key, summary FROM activity_log ORDER BY id').all();
    expect(rows.length).toBe(h.office.snapshot().activity.length);
    expect(rows.every((row) => row.session_id === LEAD && row.floor === 'mobile')).toBe(true);
    const result = h.office.search({ q: 'viajes' });
    expect(result.indexed).toBe(true);
    expect(result.hits[0]).toMatchObject({ kind: 'activity', floor: 'mobile', sessionId: LEAD });
  });

  test('a message from an observed floor is not indexed', () => {
    h = harness();
    const repo = join(h.root, 'kapper');
    mkdirSync(repo, { recursive: true });
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { source: 'startup' }));
    h.office.ingest(ev(LEAD, repo, 'PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'director', message: 'secreto de kapper' } }));
    expect(h.office.snapshot().messages.at(-1)?.text).toBeNull();
    expect(h.office.search({ q: 'secreto' }).hits).toEqual([]);
  });
});

describe('GET /api/search', () => {
  let h: Harness;
  afterEach(() => h?.cleanup());
  const KEY = 'k'.repeat(64);
  const PORT = 4747;

  test('needs the panel credential, validates the query and answers a page', async () => {
    h = harness();
    h.office.ingest(ev('s1', h.workspace, 'SessionStart', { source: 'startup' }));
    const app = createApp({ office: h.office, port: PORT, key: () => KEY, publicDir: h.root }, () => {});
    const get = (path: string, auth = true) =>
      app.request(`http://127.0.0.1:${PORT}${path}`, { headers: { host: `127.0.0.1:${PORT}`, ...(auth ? { 'x-office-key': KEY } : {}) } });
    expect((await get('/api/search?q=hola', false)).status).toBe(401);
    const bad = await get('/api/search?kind=nope');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: { key: 'hub.api.searchBad' } });
    const ok = await get('/api/search?limit=5');
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { hits: unknown[]; next: string | null };
    expect(Array.isArray(body.hits)).toBe(true);
    expect(body.next).toBeNull();
  });
});
