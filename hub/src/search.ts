import type { Database, Statement } from 'bun:sqlite';
import { renderHubText } from './render-text';
import { SEARCH_KINDS, type ActivityView, type ChatMessageView, type HubText, type MessageView, type SearchHit, type SearchKind, type SearchResult } from './types';

export const SEARCH_MAX_LIMIT = 100;
export const SEARCH_DEFAULT_LIMIT = 50;
export const SEARCH_MAX_TERMS = 8;
export const SEARCH_MAX_QUERY = 200;
const BACKFILL_CHUNK = 2000;

export type SearchQuery = {
  q?: string;
  floor?: string;
  agent?: string;
  kind?: SearchKind;
  from?: number;
  to?: number;
  // "ts:id" of the last hit of the previous page.
  before?: string;
  limit?: number;
};

type Owner = { floor: string | null; sessionId: string | null };

export type SearchDeskOpts = {
  db: Database;
  // Who an activity line belongs to: its floor and session, when the office still knows the agent.
  resolve: (agentKey: string) => Owner;
  // Tests: behave as if FTS5 were not compiled in.
  noFts?: boolean;
};

type Cursor = { ts: number; id: number };
type Row = { sid: number; kind: SearchKind; ref: string; ts: number; floor: string | null; agent: string | null };

// Union ordering needs one number per row across tables; the kind rides in the low bits.
const KIND_SLOT: Record<Exclude<SearchKind, 'agent'>, number> = { activity: 0, message: 1, chat: 2 };
const SLOTS = 4;

// The words of a query, as the index sees them: letters and digits, at most SEARCH_MAX_TERMS.
export function termsOf(q: string): string[] {
  return (q.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, SEARCH_MAX_TERMS);
}

export function parseCursor(raw: string | undefined): Cursor | null {
  const match = /^(\d{1,16}):(\d{1,16})$/.exec(raw ?? '');
  return match ? { ts: Number(match[1]), id: Number(match[2]) } : null;
}

function whole(raw: string | undefined): number | null | undefined {
  if (raw === undefined || raw === '') return undefined;
  return /^\d{1,16}$/.test(raw) ? Number(raw) : null;
}

// Pure: the query string of GET /api/search. null when any of it is not valid.
export function parseSearchParams(get: (name: string) => string | undefined): SearchQuery | null {
  const query: SearchQuery = {};
  const q = get('q');
  if (q !== undefined) {
    if (q.length > SEARCH_MAX_QUERY) return null;
    query.q = q;
  }
  for (const name of ['floor', 'agent'] as const) {
    const value = get(name);
    if (value === undefined || value === '') continue;
    if (value.length > 200) return null;
    query[name] = value;
  }
  const kind = get('kind');
  if (kind !== undefined && kind !== '') {
    if (!(SEARCH_KINDS as readonly string[]).includes(kind)) return null;
    query.kind = kind as SearchKind;
  }
  for (const name of ['from', 'to', 'limit'] as const) {
    const value = whole(get(name));
    if (value === null) return null;
    if (value !== undefined) query[name] = value;
  }
  if (query.limit !== undefined && (query.limit < 1 || query.limit > SEARCH_MAX_LIMIT)) return null;
  const before = get('before');
  if (before !== undefined && before !== '') {
    if (!parseCursor(before)) return null;
    query.before = before;
  }
  return query;
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export class SearchDesk {
  private fts = false;
  private backfillTo: { activity: number; message: number; chat: number } | null = null;
  private readonly insertActivity: Statement;
  private insertFts: Statement | null = null;

  constructor(private readonly opts: SearchDeskOpts) {
    this.insertActivity = opts.db.query(
      'INSERT INTO activity_log (ts, session_id, agent_key, floor, event, tool, state, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
  }

  get indexed(): boolean {
    return this.fts;
  }

  // The full-text table is created here and not in MIGRATIONS: a Bun built without FTS5 must still open the database.
  // When the table is new, what the office already stored is indexed later by backfill().
  ensureIndex(): boolean {
    if (this.opts.noFts) return false;
    const { db } = this.opts;
    try {
      const existed = db.query("SELECT 1 FROM sqlite_master WHERE name = 'search_fts'").get() !== null;
      db.run(
        "CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(body, kind UNINDEXED, ref UNINDEXED, ts UNINDEXED, floor UNINDEXED, agent UNINDEXED, tokenize='unicode61 remove_diacritics 2')",
      );
      this.insertFts = db.query('INSERT INTO search_fts (body, kind, ref, ts, floor, agent) VALUES (?, ?, ?, ?, ?, ?)');
      this.fts = true;
      if (!existed) this.backfillTo = this.maxIds();
    } catch {
      this.fts = false;
      this.insertFts = null;
    }
    return this.fts;
  }

  private maxIds(): { activity: number; message: number; chat: number } {
    const max = (table: string): number => this.opts.db.query<{ n: number | null }, []>(`SELECT MAX(id) AS n FROM ${table}`).get()?.n ?? 0;
    return { activity: max('activity_log'), message: max('messages'), chat: max('chat_messages') };
  }

  // Indexes the rows that existed when the index was created, in slices so the loop is not held.
  async backfill(yieldLoop: () => Promise<void> = () => new Promise<void>((resolve) => setTimeout(resolve, 0))): Promise<void> {
    const upto = this.backfillTo;
    if (!this.fts || !upto) return;
    this.backfillTo = null;
    const { db } = this.opts;
    const sources: { kind: Exclude<SearchKind, 'agent'>; limit: number; sql: string }[] = [
      { kind: 'activity', limit: upto.activity, sql: 'SELECT id, ts, floor, agent_key AS agent, summary AS body FROM activity_log WHERE id > ?1 AND id <= ?2 ORDER BY id LIMIT ?3' },
      {
        kind: 'message',
        limit: upto.message,
        sql: "SELECT id, ts, floor, from_key AS agent, text AS body FROM messages WHERE id > ?1 AND id <= ?2 AND text IS NOT NULL ORDER BY id LIMIT ?3",
      },
      { kind: 'chat', limit: upto.chat, sql: 'SELECT id, ts, floor, author_key AS agent, text AS body FROM chat_messages WHERE id > ?1 AND id <= ?2 ORDER BY id LIMIT ?3' },
    ];
    for (const source of sources) {
      let after = 0;
      for (;;) {
        const rows = db
          .query<{ id: number; ts: number; floor: string | null; agent: string; body: string }, [number, number, number]>(source.sql)
          .all(after, source.limit, BACKFILL_CHUNK);
        if (rows.length === 0) break;
        db.transaction(() => {
          for (const row of rows) {
            const body = source.kind === 'activity' ? renderStored(row.body) : row.body;
            this.index(source.kind, row.id, row.ts, row.floor, row.agent, body);
          }
        })();
        after = rows[rows.length - 1].id;
        if (rows.length < BACKFILL_CHUNK) break;
        await yieldLoop();
      }
    }
  }

  private index(kind: Exclude<SearchKind, 'agent'>, id: number, ts: number, floor: string | null, agent: string | null, body: string): void {
    if (!this.insertFts || body.trim() === '') return;
    try {
      this.insertFts.run(body, kind, String(id), ts, floor, agent);
    } catch {
      // A broken index must never take the hook down with it.
    }
  }

  // Persists an activity line and indexes it. Never throws: it runs inside the transaction of a hook.
  recordActivity(entry: ActivityView): void {
    try {
      const owner = this.opts.resolve(entry.agentKey);
      const id = Number(
        this.insertActivity.run(entry.ts, owner.sessionId, entry.agentKey, owner.floor, entry.event, entry.tool, entry.state, JSON.stringify(entry.summary)).lastInsertRowid,
      );
      this.index('activity', id, entry.ts, owner.floor, entry.agentKey, `${renderHubText(entry.summary)} ${entry.tool ?? ''}`);
    } catch {
      // Same as above.
    }
  }

  // A message the office hid (an observed floor: text null) is not indexed.
  recordMessage(view: MessageView): void {
    if (view.text === null) return;
    this.index('message', view.id, view.ts, view.floor, view.fromKey, `${view.text} ${view.toName}`);
  }

  recordChat(view: ChatMessageView): void {
    this.index('chat', view.id, view.ts, view.floor, view.authorKey, view.text);
  }

  search(raw: SearchQuery): SearchResult {
    const limit = Math.min(Math.max(raw.limit ?? SEARCH_DEFAULT_LIMIT, 1), SEARCH_MAX_LIMIT);
    const terms = termsOf(raw.q ?? '');
    const cursor = parseCursor(raw.before);
    const useIndex = this.fts && terms.length > 0 && raw.kind !== 'agent';
    const rows = useIndex ? this.viaIndex(terms, raw, cursor, limit + 1) : this.scan(terms, raw, cursor, limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { hits: this.hydrate(page), next: rows.length > limit && last ? `${last.ts}:${last.sid}` : null, indexed: useIndex };
  }

  private viaIndex(terms: string[], q: SearchQuery, cursor: Cursor | null, limit: number): Row[] {
    const where = ['search_fts MATCH ?'];
    const args: (string | number)[] = [`body : (${terms.map((term) => `"${term}"*`).join(' ')})`];
    if (q.kind) (where.push('kind = ?'), args.push(q.kind));
    if (q.floor) (where.push('floor = ?'), args.push(q.floor));
    if (q.agent) (where.push('agent = ?'), args.push(q.agent));
    if (q.from !== undefined) (where.push('ts >= ?'), args.push(q.from));
    if (q.to !== undefined) (where.push('ts <= ?'), args.push(q.to));
    if (cursor) (where.push('(ts < ? OR (ts = ? AND rowid < ?))'), args.push(cursor.ts, cursor.ts, cursor.id));
    const sql = `SELECT rowid AS sid, kind, ref, ts, floor, agent FROM search_fts WHERE ${where.join(' AND ')} ORDER BY ts DESC, rowid DESC LIMIT ${limit}`;
    try {
      return this.opts.db.query<Row, (string | number)[]>(sql).all(...args);
    } catch {
      // A broken index answers like no index: the plain match below.
      this.fts = false;
      return this.scan(terms, q, cursor, limit);
    }
  }

  // The plain path: substring match (LIKE) over the three tables, or the list of the latest things when there is
  // no text. Also what answers when FTS5 is not available.
  private scan(terms: string[], q: SearchQuery, cursor: Cursor | null, limit: number): Row[] {
    const likes = terms.map((term) => `%${escapeLike(term)}%`);
    const parts: string[] = [];
    const args: (string | number)[] = [];
    const add = (
      slot: number,
      kind: SearchKind,
      table: string,
      cols: { id: string; ts: string; floor: string; agent: string; text: string; extra?: string },
    ): void => {
      const where: string[] = cols.extra ? [cols.extra] : [];
      const sub: (string | number)[] = [];
      for (const like of likes) (where.push(`${cols.text} LIKE ? ESCAPE '\\'`), sub.push(like));
      if (q.floor) (where.push(`${cols.floor} = ?`), sub.push(q.floor));
      if (q.agent) (where.push(`${cols.agent} = ?`), sub.push(q.agent));
      if (q.from !== undefined) (where.push(`${cols.ts} >= ?`), sub.push(q.from));
      if (q.to !== undefined) (where.push(`${cols.ts} <= ?`), sub.push(q.to));
      if (cursor) (where.push(`(${cols.ts} < ? OR (${cols.ts} = ? AND ${cols.id} * ${SLOTS} + ${slot} < ?))`), sub.push(cursor.ts, cursor.ts, cursor.id));
      parts.push(
        `SELECT ${cols.id} * ${SLOTS} + ${slot} AS sid, '${kind}' AS kind, CAST(${cols.id} AS TEXT) AS ref, ${cols.ts} AS ts, ${cols.floor} AS floor, ${cols.agent} AS agent FROM ${table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`,
      );
      args.push(...sub);
    };
    const wants = (kind: SearchKind): boolean => (q.kind ? q.kind === kind : kind !== 'agent');
    if (wants('activity')) add(KIND_SLOT.activity, 'activity', 'activity_log', { id: 'id', ts: 'ts', floor: 'floor', agent: 'agent_key', text: "(summary || ' ' || COALESCE(tool, ''))" });
    if (wants('message')) {
      add(KIND_SLOT.message, 'message', 'messages', { id: 'id', ts: 'ts', floor: 'floor', agent: 'from_key', text: "(COALESCE(text, '') || ' ' || to_name)", extra: 'text IS NOT NULL' });
    }
    if (wants('chat')) add(KIND_SLOT.chat, 'chat', 'chat_messages', { id: 'id', ts: 'ts', floor: 'floor', agent: 'author_key', text: 'text' });
    if (wants('agent')) {
      // The agent table is keyed by text: rowid stands for the id in the cursor.
      add(3, 'agent', 'agents', {
        id: 'rowid',
        ts: 'COALESCE(updated_at, started_at, 0)',
        floor: 'floor',
        agent: 'agent_key',
        text: "(COALESCE(name, '') || ' ' || agent_key || ' ' || COALESCE(role, ''))",
      });
    }
    if (parts.length === 0) return [];
    const sql = `SELECT * FROM (${parts.join(' UNION ALL ')}) ORDER BY ts DESC, sid DESC LIMIT ${limit}`;
    return this.opts.db.query<Row, (string | number)[]>(sql).all(...args);
  }

  private sessionOf(agentKey: string | null, cache: Map<string, string | null>): string | null {
    if (!agentKey) return null;
    if (cache.has(agentKey)) return cache.get(agentKey) ?? null;
    const { db } = this.opts;
    const viaAgent = db.query<{ session_id: string }, [string]>('SELECT session_id FROM agents WHERE agent_key = ?').get(agentKey)?.session_id;
    const found = viaAgent ?? (db.query('SELECT 1 FROM sessions WHERE session_id = ?').get(agentKey) ? agentKey : null);
    cache.set(agentKey, found);
    return found;
  }

  private hydrate(rows: Row[]): SearchHit[] {
    const { db } = this.opts;
    const ids = (kind: SearchKind): string[] => rows.filter((row) => row.kind === kind).map((row) => row.ref);
    const marks = (list: string[]): string => list.map(() => '?').join(', ');
    const text = new Map<string, HubText>();
    const sessions = new Map<string, string | null>();
    const own = new Map<string, string | null>();

    const activity = ids('activity');
    if (activity.length > 0) {
      for (const row of db
        .query<{ id: number; session_id: string | null; summary: string }, string[]>(`SELECT id, session_id, summary FROM activity_log WHERE id IN (${marks(activity)})`)
        .all(...activity)) {
        text.set(`activity:${row.id}`, parseSummary(row.summary));
        own.set(`activity:${row.id}`, row.session_id);
      }
    }
    const messages = ids('message');
    if (messages.length > 0) {
      for (const row of db
        .query<{ id: number; text: string | null }, string[]>(`SELECT id, text FROM messages WHERE id IN (${marks(messages)})`)
        .all(...messages)) {
        text.set(`message:${row.id}`, row.text ?? '');
      }
    }
    const chats = ids('chat');
    if (chats.length > 0) {
      for (const row of db
        .query<{ id: number; text: string }, string[]>(`SELECT id, text FROM chat_messages WHERE id IN (${marks(chats)})`)
        .all(...chats)) {
        text.set(`chat:${row.id}`, row.text);
      }
    }
    const agents = ids('agent');
    if (agents.length > 0) {
      for (const row of db
        .query<{ rowid: number; agent_key: string; name: string | null; role: string | null; session_id: string }, string[]>(
          `SELECT rowid, agent_key, name, role, session_id FROM agents WHERE rowid IN (${marks(agents)})`,
        )
        .all(...agents)) {
        text.set(`agent:${row.rowid}`, [row.name ?? row.agent_key, row.role].filter(Boolean).join(' · '));
        own.set(`agent:${row.rowid}`, row.session_id);
      }
    }

    const hits: SearchHit[] = [];
    for (const row of rows) {
      const key = `${row.kind}:${row.ref}`;
      const body = text.get(key);
      if (body === undefined) continue;
      hits.push({
        kind: row.kind,
        id: row.kind === 'agent' ? (row.agent ?? row.ref) : row.ref,
        ts: row.ts,
        floor: row.floor,
        agent: row.agent,
        sessionId: own.get(key) ?? this.sessionOf(row.agent, sessions),
        text: body,
      });
    }
    return hits;
  }
}

function parseSummary(raw: string): HubText {
  try {
    return JSON.parse(raw) as HubText;
  } catch {
    return raw;
  }
}

function renderStored(raw: string): string {
  return renderHubText(parseSummary(raw));
}
