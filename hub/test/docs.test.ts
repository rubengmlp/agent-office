import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION, openDb } from '../src/db';

const ROOT = join(import.meta.dir, '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const METHODS = 'get|post|put|delete';

// Every route the hub answers: those of the Hono app, plus the WebSocket that startServer routes by hand.
function serverRoutes(): string[] {
  const source = read('hub', 'src', 'server.ts');
  const routes = [...source.matchAll(new RegExp(`app\\.(${METHODS})\\('([^']+)'`, 'g'))].map((m) => `${m[1].toUpperCase()} ${m[2]}`);
  return [...new Set([...routes, 'GET /live'])].sort();
}

function documentedRoutes(): string[] {
  const doc = read('docs', 'api.md');
  return [...new Set([...doc.matchAll(/`((?:GET|POST|PUT|DELETE) [^`\s]+)`/g)].map((m) => m[1]))].sort();
}

describe('docs/api.md', () => {
  test('server.ts defines routes to compare against', () => {
    expect(serverRoutes().length).toBeGreaterThan(40);
  });

  test('every route of server.ts is documented', () => {
    const documented = new Set(documentedRoutes());
    expect(serverRoutes().filter((route) => !documented.has(route))).toEqual([]);
  });

  test('api.md documents no route the server does not have', () => {
    const real = new Set(serverRoutes());
    expect(documentedRoutes().filter((route) => !real.has(route))).toEqual([]);
  });
});

describe('docs/db.md', () => {
  const doc = read('docs', 'db.md');

  test('names the current schema version', () => {
    expect(doc).toContain(`schema v${SCHEMA_VERSION}`);
  });

  test('has a section for every table of a fresh database', () => {
    const db = openDb(':memory:');
    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .filter((table) => !/^search_fts_/.test(table.name))
      .map((table) => table.name)
      .sort();
    db.close();
    expect(tables.length).toBeGreaterThan(20);
    const headings = new Set([...doc.matchAll(/^## (\S+)\s*$/gm)].map((m) => m[1]));
    expect(tables.filter((table) => !headings.has(table))).toEqual([]);
  });

  test('documents the optional search index', () => {
    expect(doc).toMatch(/^## search_fts\s*$/m);
  });
});
