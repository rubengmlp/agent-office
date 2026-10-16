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
    expect(migrate(db, [{ version: 4, statements: ['ALTER TABLE lessons ADD COLUMN tags TEXT', 'CREATE INDEX IF NOT EXISTS lessons_tags ON lessons (tags)'] }])).toBe(4);
    expect(version(db)).toBe(4);
    expect(columns(db, 'lessons')).toContain('tags');
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM lessons').get()?.n).toBe(1);
    expect(() => migrate(db, [{ version: 5, statements: ['DROP TABLE lessons'] }])).toThrow(/solo añaden/);
    expect(() => checkAdditive({ version: 6, statements: ['DELETE FROM reports'] })).toThrow();
    expect(() => checkAdditive({ version: 6, statements: ['ALTER TABLE reports RENAME TO informes'] })).toThrow();
    expect(() => checkAdditive({ version: ADDITIVE_SINCE, statements: ['DROP TABLE x'] })).not.toThrow();
    expect(version(db)).toBe(4);
    expect(tables(db)).toContain('lessons');
  });

  test('v3 adds the delivery and decision columns of documents and every migration is additive', () => {
    const db = openDb(':memory:');
    expect(SCHEMA_VERSION).toBe(3);
    expect(version(db)).toBe(3);
    for (const column of ['delivered_at', 'decision', 'decided_at', 'delivered_base']) expect(columns(db, 'documents')).toContain(column);
    for (const migration of MIGRATIONS) expect(() => checkAdditive(migration)).not.toThrow();
    const { dir, cleanup } = tempDir();
    const file = join(dir, 'office.db');
    const v2 = openDb(file, []);
    expect(version(v2)).toBe(2);
    v2.query("INSERT INTO documents (path, kind, slug, round, closed_at, updated_at) VALUES ('redaccion/planes/viejo.md', 'plan', 'viejo', 2, 5, 5)").run();
    v2.close();
    const upgraded = openDb(file);
    expect(version(upgraded)).toBe(3);
    expect(upgraded.query<{ closed_at: number; delivered_at: number | null }, []>('SELECT closed_at, delivered_at FROM documents').get()).toEqual({
      closed_at: 5,
      delivered_at: null,
    });
    upgraded.close();
    cleanup();
  });
});
