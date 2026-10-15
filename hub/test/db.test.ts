import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { ADDITIVE_SINCE, SCHEMA_VERSION, checkAdditive, migrate, openDb } from '../src/db';
import { tempDir } from './helpers';

const tables = (db: Database) =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
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
    expect(migrate(db, [{ version: 3, statements: ['ALTER TABLE lessons ADD COLUMN tags TEXT', 'CREATE INDEX IF NOT EXISTS lessons_tags ON lessons (tags)'] }])).toBe(3);
    expect(version(db)).toBe(3);
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM lessons').get()?.n).toBe(1);
    expect(() => migrate(db, [{ version: 4, statements: ['DROP TABLE lessons'] }])).toThrow(/solo añaden/);
    expect(() => checkAdditive({ version: 5, statements: ['DELETE FROM reports'] })).toThrow();
    expect(() => checkAdditive({ version: 5, statements: ['ALTER TABLE reports RENAME TO informes'] })).toThrow();
    expect(() => checkAdditive({ version: ADDITIVE_SINCE, statements: ['DROP TABLE x'] })).not.toThrow();
    expect(version(db)).toBe(3);
    expect(tables(db)).toContain('lessons');
  });
});
