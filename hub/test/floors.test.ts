import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DIRECCION, FloorResolver, UNKNOWN_FLOOR, gitMainRoot, isInside, memoryRegistry, realPath, slugify } from '../src/floors';
import type { OfficeConfig } from '../src/types';
import { tempDir } from './helpers';

function git(cwd: string, ...args: string[]): void {
  const r = Bun.spawnSync(['git', '-c', 'user.email=office@test', '-c', 'user.name=office', '-C', cwd, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
}

describe('floors', () => {
  const { dir, cleanup } = tempDir();
  const root = realPath(dir);
  const mobile = join(root, 'mobile');
  const worktree = join(mobile, '.claude', 'worktrees', 'feature');
  const otherMobile = join(root, 'other', 'mobile');
  const plain = join(root, 'plain');
  const workspace = join(root, 'agent-office', 'workspace');

  beforeAll(() => {
    for (const d of [join(mobile, 'lib'), otherMobile, plain, workspace]) mkdirSync(d, { recursive: true });
    git(mobile, 'init', '-q');
    git(mobile, 'commit', '-q', '--allow-empty', '-m', 'init');
    git(mobile, 'worktree', 'add', '-q', worktree);
    git(otherMobile, 'init', '-q');
  });

  afterAll(cleanup);

  test('the git root of a subfolder and of a worktree is the main checkout', () => {
    expect(gitMainRoot(join(mobile, 'lib'))).toBe(mobile);
    expect(realPath(gitMainRoot(worktree) ?? '')).toBe(mobile);
    expect(gitMainRoot(plain)).toBeNull();
  });

  test('observed floors are created on the fly, one per repository', () => {
    const config: OfficeConfig = { floors: {}, blockedAfterMinutes: 5, retentionDays: 14, port: 4747 };
    const resolver = new FloorResolver(() => config, workspace, memoryRegistry());
    expect(resolver.resolve(join(mobile, 'lib'))).toMatchObject({ slug: 'mobile', kind: 'observed', path: mobile });
    expect(resolver.resolve(worktree).slug).toBe('mobile');
    expect(resolver.resolve(otherMobile).slug).toBe('mobile-2');
    expect(resolver.resolve(plain)).toMatchObject({ slug: 'plain', kind: 'observed' });
    expect(resolver.resolve(join(workspace, 'notes')).slug).toBe(DIRECCION);
    expect(resolver.resolve(undefined).slug).toBe(UNKNOWN_FLOOR);
  });

  test('a configured floor wins and keeps its kind', () => {
    const config: OfficeConfig = {
      floors: { app: { path: mobile, stack: 'flutter', managed: true } },
      blockedAfterMinutes: 5,
      retentionDays: 14,
      port: 4747,
    };
    const resolver = new FloorResolver(() => config, workspace, memoryRegistry());
    expect(resolver.resolve(worktree)).toMatchObject({ slug: 'app', kind: 'managed', stack: 'flutter' });
    resolver.resolve(plain);
    const views = resolver.views();
    expect(views[0]).toMatchObject({ slug: DIRECCION, kind: 'direccion', label: 'Dirección' });
    expect(views.map((v) => v.slug)).toEqual([DIRECCION, 'app', 'plain']);
  });

  test('slugs and containment', () => {
    expect(slugify('Mi Repo_Á')).toBe('mi-repo-a');
    expect(isInside('/a/b/c', '/a/b')).toBe(true);
    expect(isInside('/a/bc', '/a/b')).toBe(false);
  });
});
