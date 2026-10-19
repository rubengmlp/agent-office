import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

function scripts(): string[] {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  return Object.keys(pkg.scripts);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return [relative(ROOT, path), ...(entry.isDirectory() ? walk(path) : [])];
  });
}

describe('INSTALL.md and README.md', () => {
  test('every script of the root package.json is written as `bun run <name>`', () => {
    const text = `${read('INSTALL.md')}\n${read('README.md')}`;
    const missing = scripts().filter((name) => !new RegExp(`bun run ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w:-])`).test(text));
    expect(missing).toEqual([]);
  });
});

describe('office-docs/', () => {
  const files = walk(join(ROOT, 'office-docs'));

  test('is a snapshot with its SNAPSHOT.md', () => {
    expect(existsSync(join(ROOT, 'office-docs', 'SNAPSHOT.md'))).toBe(true);
    expect(files.length).toBeGreaterThan(5);
  });

  test('has no flow-test file', () => {
    expect(files.filter((file) => file.includes('flow-test'))).toEqual([]);
  });

  test('has no .claude or .git folder and no .fuentes', () => {
    expect(files.filter((file) => file.split('/').some((part) => part === '.claude' || part === '.git' || part === '.fuentes'))).toEqual([]);
  });
});
