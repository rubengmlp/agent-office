import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DIRECCION, FloorResolver, MANTENIMIENTO, REDACCION, UNKNOWN_FLOOR, gitMainRoot, isInside, memoryRegistry, realPath, slugify } from '../src/floors';
import { floor, tempDir, testConfig } from './helpers';

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
    const config = testConfig();
    const resolver = new FloorResolver(() => config, workspace, memoryRegistry());
    expect(resolver.resolve(join(mobile, 'lib'))).toMatchObject({ slug: 'mobile', kind: 'observed', path: mobile });
    expect(resolver.resolve(worktree).slug).toBe('mobile');
    expect(resolver.resolve(otherMobile).slug).toBe('mobile-2');
    expect(resolver.resolve(plain)).toMatchObject({ slug: 'plain', kind: 'observed' });
    expect(resolver.resolve(join(workspace, 'notes')).slug).toBe(DIRECCION);
    expect(resolver.resolve(undefined).slug).toBe(UNKNOWN_FLOOR);
  });

  test('a configured floor wins and keeps its kind', () => {
    const config = testConfig({ floors: { app: floor(mobile) } });
    const resolver = new FloorResolver(() => config, workspace, memoryRegistry());
    expect(resolver.resolve(worktree)).toMatchObject({ slug: 'app', kind: 'managed', stack: 'flutter' });
    resolver.resolve(plain);
    const views = resolver.views();
    expect(views[0]).toMatchObject({ slug: DIRECCION, kind: 'direccion', label: 'Dirección', building: 'principal' });
    expect(views.map((v) => v.slug)).toEqual([DIRECCION, 'app', 'plain']);
  });

  test('the view of a floor says whether it works with a folder per order', () => {
    const config = testConfig({ floors: { app: { ...floor(mobile), delivery: true }, other: floor(plain) } });
    const views = new FloorResolver(() => config, workspace, memoryRegistry()).views();
    expect(views.find((v) => v.slug === 'app')?.delivery).toBe(true);
    expect(views.find((v) => v.slug === 'other')?.delivery).toBeUndefined();
  });

  test('department folders of the documents repository resolve before the git root', () => {
    const docs = join(root, 'office-docs');
    const fuentes = join(docs, 'redaccion', '.fuentes', 'plan-a', 'mobile');
    for (const d of [join(docs, 'redaccion', 'planes'), join(docs, 'taller', 'skills', 'x'), fuentes]) mkdirSync(d, { recursive: true });
    const config = testConfig({ docsRepo: docs, departments: { redaccion: true, mantenimiento: true }, floors: { app: floor(mobile) } });
    const resolver = new FloorResolver(() => config, workspace, memoryRegistry(), () => mobile);
    expect(resolver.resolve(join(docs, 'redaccion', 'planes'))).toMatchObject({ slug: REDACCION, kind: 'redaccion' });
    expect(resolver.resolve(fuentes)).toMatchObject({ slug: REDACCION, kind: 'redaccion' });
    expect(resolver.resolve(join(docs, 'taller', 'skills', 'x'))).toMatchObject({ slug: MANTENIMIENTO, kind: 'mantenimiento' });
    const views = resolver.views();
    expect(views.map((v) => [v.slug, v.kind, v.building])).toEqual([
      [DIRECCION, 'direccion', 'principal'],
      [REDACCION, 'redaccion', 'principal'],
      [MANTENIMIENTO, 'mantenimiento', 'mantenimiento'],
      ['app', 'managed', 'principal'],
    ]);
    config.departments.mantenimiento = false;
    expect(resolver.views().map((v) => v.slug)).not.toContain(MANTENIMIENTO);
  });

  test('slugs and containment', () => {
    expect(slugify('Mi Repo_Á')).toBe('mi-repo-a');
    expect(isInside('/a/b/c', '/a/b')).toBe(true);
    expect(isInside('/a/bc', '/a/b')).toBe(false);
  });
});
