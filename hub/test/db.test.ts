import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { ADDITIVE_SINCE, MIGRATIONS, SCHEMA_VERSION, checkAdditive, migrate, openDb } from '../src/db';
import { tempDir } from './helpers';

const tables = (db: Database) =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((r) => r.name);

const version = (db: Database) => db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version;

describe('schema', () => {
  test('a v1 database is recreated once as v2 and test runs become verdicts', () => {
    const { dir, cleanup } = tempDir();
    const file = join(dir, 'office.db');
    const v1 = new Database(file, { create: true });
    v1.run('CREATE TABLE test_runs (id INTEGER PRIMARY KEY, ts INTEGER)');
    v1.run('CREATE TABLE events (id INTEGER PRIMARY KEY, ts INTEGER)');
    v1.run('INSERT INTO test_runs (ts) VALUES (1)');
    v1.close();
    const db = openDb(file);
    expect(version(db)).toBe(SCHEMA_VERSION);
    expect(tables(db)).not.toContain('test_runs');
    for (const t of ['verdicts', 'lessons', 'reports', 'documents', 'floor_sync', 'sync_worktrees', 'alerts', 'events']) expect(tables(db)).toContain(t);
    db.query("INSERT INTO lessons (floor, role, text, norm, origin, created_at) VALUES ('mobile', 'dev', 'x', 'x', 'user', 1)").run();
    db.close();
    const reopened = openDb(file);
    expect(reopened.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM lessons').get()?.n).toBe(1);
    reopened.close();
    cleanup();
  });

  test('later migrations only add tables, columns or indexes', () => {
    const db = openDb(':memory:');
    db.query("INSERT INTO lessons (floor, role, text, norm, origin, created_at) VALUES ('mobile', 'dev', 'x', 'x', 'user', 1)").run();
    expect(migrate(db, [{ version: 5, statements: ['ALTER TABLE lessons ADD COLUMN tags TEXT', 'CREATE INDEX IF NOT EXISTS lessons_tags ON lessons (tags)'] }])).toBe(5);
    expect(version(db)).toBe(5);
    expect(columns(db, 'lessons')).toContain('tags');
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM lessons').get()?.n).toBe(1);
    expect(() => migrate(db, [{ version: 6, statements: ['DROP TABLE lessons'] }])).toThrow(/solo añaden/);
    expect(() => checkAdditive({ version: 7, statements: ['DELETE FROM reports'] })).toThrow();
    expect(() => checkAdditive({ version: 7, statements: ['ALTER TABLE reports RENAME TO informes'] })).toThrow();
    expect(() => checkAdditive({ version: ADDITIVE_SINCE, statements: ['DROP TABLE x'] })).not.toThrow();
    expect(version(db)).toBe(5);
    expect(tables(db)).toContain('lessons');
  });

  test('v3 adds the delivery and decision columns of documents and every migration is additive', () => {
    const db = openDb(':memory:');
    expect(version(db)).toBe(SCHEMA_VERSION);
    for (const column of ['delivered_at', 'decision', 'decided_at', 'delivered_base']) expect(columns(db, 'documents')).toContain(column);
    for (const migration of MIGRATIONS) expect(() => checkAdditive(migration)).not.toThrow();
    const { dir, cleanup } = tempDir();
    const file = join(dir, 'office.db');
    const v2 = openDb(file, []);
    expect(version(v2)).toBe(2);
    v2.query("INSERT INTO documents (path, kind, slug, round, closed_at, updated_at) VALUES ('redaccion/planes/viejo.md', 'plan', 'viejo', 2, 5, 5)").run();
    v2.close();
    const upgraded = openDb(file, MIGRATIONS.filter((m) => m.version <= 3));
    expect(version(upgraded)).toBe(3);
    expect(upgraded.query<{ closed_at: number; delivered_at: number | null }, []>('SELECT closed_at, delivered_at FROM documents').get()).toEqual({
      closed_at: 5,
      delivered_at: null,
    });
    upgraded.close();
    cleanup();
  });

  test('v4 adds the token tables and the session columns without touching the data', () => {
    expect(SCHEMA_VERSION).toBe(4);
    const { dir, cleanup } = tempDir();
    const file = join(dir, 'office.db');
    const v3 = openDb(file, MIGRATIONS.filter((m) => m.version <= 3));
    expect(version(v3)).toBe(3);
    expect(tables(v3)).not.toContain('token_usage');
    v3.query("INSERT INTO sessions (session_id, floor, role, started_at, updated_at) VALUES ('s-1', 'mobile', 'office-lead-mobile', 1, 2)").run();
    v3.query("INSERT INTO documents (path, kind, slug, round, updated_at) VALUES ('redaccion/planes/x.md', 'plan', 'x', 1, 3)").run();
    v3.close();

    const db = openDb(file);
    expect(version(db)).toBe(4);
    for (const t of ['token_usage', 'token_cursor']) expect(tables(db)).toContain(t);
    expect(columns(db, 'token_usage')).toEqual([
      'day', 'agent_key', 'session_id', 'floor', 'role_id', 'name', 'model', 'plan_slug',
      'turns', 'input', 'cache_read', 'cache_create', 'output', 'updated_at',
    ]);
    expect(columns(db, 'token_cursor')).toEqual([
      'agent_key', 'session_id', 'floor', 'transcript', 'byte_offset', 'last_msg_id', 'last_out', 'skipped_lines', 'updated_at',
    ]);
    for (const column of ['rules_hash', 'launch_hash', 'task_open_since', 'plan_slug']) expect(columns(db, 'sessions')).toContain(column);
    expect(db.query('SELECT session_id, floor, role, rules_hash, launch_hash, task_open_since, plan_slug FROM sessions').all()).toEqual([
      { session_id: 's-1', floor: 'mobile', role: 'office-lead-mobile', rules_hash: null, launch_hash: null, task_open_since: null, plan_slug: null },
    ]);
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM documents').get()?.n).toBe(1);

    const upsert = db.query(
      `INSERT INTO token_usage (day, agent_key, session_id, floor, turns, input, cache_read, cache_create, output, updated_at)
       VALUES ('2026-10-16', 'a-1', 's-1', 'mobile', 1, 10, 100, 5, 7, ?)
       ON CONFLICT (day, agent_key, model, plan_slug) DO UPDATE SET turns = turns + excluded.turns, output = output + excluded.output, updated_at = excluded.updated_at`,
    );
    upsert.run(1);
    upsert.run(2);
    expect(db.query('SELECT model, plan_slug, turns, output FROM token_usage').all()).toEqual([{ model: '', plan_slug: '', turns: 2, output: 14 }]);
    for (const migration of MIGRATIONS) expect(() => checkAdditive(migration)).not.toThrow();
    db.close();
    expect(version(openDb(file))).toBe(4);
    cleanup();
  });
});
