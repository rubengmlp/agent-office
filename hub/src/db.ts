import { Database } from 'bun:sqlite';
import { chmodSync } from 'node:fs';
import type { FloorRecord, FloorRegistry } from './floors';

export const SCHEMA_VERSION = 2;
export const ADDITIVE_SINCE = 2;

export type Migration = { version: number; statements: string[] };

export const MIGRATIONS: readonly Migration[] = [];

const V1_TABLES = ['events', 'sessions', 'agents', 'floors', 'tasks', 'edits', 'test_runs', 'messages', 'questions', 'gate_decisions'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    agent_key TEXT NOT NULL,
    floor TEXT NOT NULL,
    event TEXT NOT NULL,
    tool TEXT,
    state TEXT,
    path TEXT,
    payload TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS events_ts ON events (ts)',
  'CREATE INDEX IF NOT EXISTS events_agent ON events (agent_key, ts)',
  'CREATE INDEX IF NOT EXISTS events_floor ON events (floor, ts)',
  `CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    cwd TEXT,
    floor TEXT,
    role TEXT,
    name TEXT,
    socket TEXT,
    token TEXT,
    team TEXT,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ended_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS agents (
    agent_key TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    parent_key TEXT,
    name TEXT,
    role TEXT,
    floor TEXT,
    team TEXT,
    started_at INTEGER,
    updated_at INTEGER NOT NULL,
    ended_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS floors (
    slug TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    stack TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    scope TEXT NOT NULL,
    task_id TEXT NOT NULL,
    subject TEXT,
    owner TEXT,
    status TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (scope, task_id)
  )`,
  `CREATE TABLE IF NOT EXISTS edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    agent_key TEXT NOT NULL,
    floor TEXT NOT NULL,
    path TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS edits_agent ON edits (agent_key, floor, ts)',
  'CREATE INDEX IF NOT EXISTS edits_floor ON edits (floor, ts)',
  `CREATE TABLE IF NOT EXISTS verdicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    agent_key TEXT NOT NULL,
    role TEXT,
    floor TEXT NOT NULL,
    kind TEXT NOT NULL,
    ok INTEGER NOT NULL,
    command TEXT,
    path TEXT,
    round INTEGER,
    score REAL
  )`,
  'CREATE INDEX IF NOT EXISTS verdicts_floor ON verdicts (floor, kind, ts)',
  'CREATE INDEX IF NOT EXISTS verdicts_path ON verdicts (path, kind, ts)',
  'CREATE INDEX IF NOT EXISTS verdicts_agent ON verdicts (agent_key, ts)',
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    from_key TEXT NOT NULL,
    to_name TEXT NOT NULL,
    to_key TEXT,
    text TEXT,
    floor TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS messages_from ON messages (from_key, ts)',
  'CREATE INDEX IF NOT EXISTS messages_to ON messages (to_key, ts)',
  `CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_key TEXT NOT NULL,
    floor TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS gate_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    scope TEXT,
    task_id TEXT,
    decision TEXT NOT NULL,
    reason TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    floor TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    norm TEXT NOT NULL,
    origin TEXT NOT NULL,
    agent_key TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (floor, role, norm)
  )`,
  'CREATE INDEX IF NOT EXISTS lessons_agent ON lessons (agent_key)',
  `CREATE TABLE IF NOT EXISTS reports (
    agent_key TEXT PRIMARY KEY,
    floor TEXT NOT NULL,
    role_id TEXT,
    name TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    summary TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS reports_role ON reports (floor, role_id, updated_at)',
  `CREATE TABLE IF NOT EXISTS documents (
    path TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    slug TEXT NOT NULL,
    round INTEGER NOT NULL DEFAULT 0,
    requested_at INTEGER,
    closed_at INTEGER,
    discarded_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS floor_sync (
    floor TEXT NOT NULL,
    ref TEXT NOT NULL,
    last_sha TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (floor, ref)
  )`,
  `CREATE TABLE IF NOT EXISTS sync_worktrees (
    slug TEXT NOT NULL,
    floor TEXT NOT NULL,
    repo TEXT NOT NULL,
    path TEXT NOT NULL,
    ref TEXT NOT NULL,
    sha TEXT NOT NULL,
    date TEXT,
    stale INTEGER NOT NULL DEFAULT 0,
    ahead_commits INTEGER,
    ahead_files TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (slug, floor)
  )`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    level TEXT NOT NULL,
    floor TEXT NOT NULL,
    agent_key TEXT NOT NULL,
    files TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS alerts_ts ON alerts (ts)',
];

const DESTRUCTIVE = /\b(DROP|DELETE|TRUNCATE|REPLACE)\b|\bALTER\s+TABLE\s+\S+\s+(DROP|RENAME)\b|\bUPDATE\b/i;

export function checkAdditive(migration: Migration): void {
  if (migration.version <= ADDITIVE_SINCE) return;
  const bad = migration.statements.find((sql) => DESTRUCTIVE.test(sql));
  if (bad) {
    throw new Error(
      `La migración ${migration.version} borra o reescribe datos (${bad.trim().slice(0, 60)}): desde la versión ${ADDITIVE_SINCE} las migraciones solo añaden tablas, columnas o índices.`,
    );
  }
}

export function migrate(db: Database, migrations: readonly Migration[] = MIGRATIONS): number {
  const current = db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;
  if (current < ADDITIVE_SINCE) {
    db.transaction(() => {
      for (const table of V1_TABLES) db.run(`DROP TABLE IF EXISTS ${table}`);
      for (const sql of SCHEMA) db.run(sql);
      db.run(`PRAGMA user_version = ${ADDITIVE_SINCE}`);
    })();
  } else {
    for (const sql of SCHEMA) db.run(sql);
  }
  let version = Math.max(current, ADDITIVE_SINCE);
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (migration.version <= version) continue;
    checkAdditive(migration);
    db.transaction(() => {
      for (const sql of migration.statements) db.run(sql);
      db.run(`PRAGMA user_version = ${migration.version}`);
    })();
    version = migration.version;
  }
  return version;
}

export function openDb(file: string, migrations: readonly Migration[] = MIGRATIONS): Database {
  const db = new Database(file, { create: true });
  if (file !== ':memory:') {
    try {
      chmodSync(file, 0o600);
    } catch {}
    db.run('PRAGMA journal_mode = WAL');
  }
  db.run('PRAGMA busy_timeout = 2000');
  migrate(db, migrations);
  return db;
}

export function dbRegistry(db: Database): FloorRegistry {
  const byPath = db.query<FloorRecord, [string]>('SELECT slug, path, stack FROM floors WHERE path = ?');
  const insert = db.query('INSERT OR IGNORE INTO floors (slug, path, stack) VALUES (?, ?, ?)');
  const all = db.query<FloorRecord, []>('SELECT slug, path, stack FROM floors ORDER BY slug');
  return {
    byPath: (path) => byPath.get(path) ?? null,
    add: (r) => {
      insert.run(r.slug, r.path, r.stack);
    },
    all: () => all.all(),
  };
}
