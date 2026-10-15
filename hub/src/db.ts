import { Database } from 'bun:sqlite';
import { chmodSync } from 'node:fs';
import type { FloorRecord, FloorRegistry } from './floors';

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
  `CREATE TABLE IF NOT EXISTS test_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    agent_key TEXT NOT NULL,
    role TEXT,
    floor TEXT NOT NULL,
    ok INTEGER NOT NULL,
    command TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS test_runs_floor ON test_runs (floor, ts)',
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    from_key TEXT NOT NULL,
    to_name TEXT NOT NULL,
    to_key TEXT,
    text TEXT,
    floor TEXT NOT NULL
  )`,
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
];

export function openDb(file: string): Database {
  const db = new Database(file, { create: true });
  if (file !== ':memory:') {
    try {
      chmodSync(file, 0o600);
    } catch {}
    db.run('PRAGMA journal_mode = WAL');
  }
  db.run('PRAGMA busy_timeout = 2000');
  for (const sql of SCHEMA) db.run(sql);
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
