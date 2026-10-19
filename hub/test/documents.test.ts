import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { DocumentDesk, PLANS_DIR, SKILLS_DIR } from '../src/documents';
import type { DocumentView } from '../src/types';
import { tempDir } from './helpers';

function deskFor(root: string, seen: DocumentView[][]): DocumentDesk {
  return new DocumentDesk({
    db: openDb(':memory:'),
    root: () => root,
    enabled: () => ({ redaccion: true, mantenimiento: true }),
    installTargets: () => [],
    base: () => [],
    ahead: () => [],
    onChange: (docs) => seen.push(docs),
    maxRounds: () => 3,
  });
}

// Waits for the debounced refresh to see the path, and returns what it saw either way.
async function waitForSeen(seen: DocumentView[][], path: string): Promise<string[]> {
  const start = Date.now();
  while (Date.now() - start < 3000) {
    const paths = seen.flat().map((doc) => doc.path);
    if (paths.includes(path)) return paths;
    await Bun.sleep(25);
  }
  return seen.flat().map((doc) => doc.path);
}

describe('documents watcher', () => {
  test('watch() attaches a directory that did not exist on the first call', async () => {
    const { dir, cleanup } = tempDir();
    mkdirSync(join(dir, PLANS_DIR), { recursive: true });
    const seen: DocumentView[][] = [];
    const desk = deskFor(dir, seen);
    desk.watch();

    // A config reload calls watch() again: the skill lands in the directory that was missing before.
    mkdirSync(join(dir, SKILLS_DIR, 'demo'), { recursive: true });
    desk.watch();
    seen.length = 0;
    writeFileSync(join(dir, SKILLS_DIR, 'demo', 'SKILL.md'), '---\nname: Demo\n---\n');
    expect(await waitForSeen(seen, 'taller/skills/demo')).toContain('taller/skills/demo');

    // The directory that was already watched keeps working.
    seen.length = 0;
    writeFileSync(join(dir, PLANS_DIR, 'plan-a.md'), '# Plan A\n');
    expect(await waitForSeen(seen, 'redaccion/planes/plan-a.md')).toContain('redaccion/planes/plan-a.md');

    desk.unwatch();
    cleanup();
  });
});
