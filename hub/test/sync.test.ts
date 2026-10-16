import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../src/db';
import { ensureDocsRepo } from '../src/docs-repo';
import { realPath } from '../src/floors';
import { runGit } from '../src/git';
import { SyncDesk, isSyncError, type SyncResult } from '../src/sync';
import { floor, git, originAndClone, pushCommit, tempDir, useGitIdentity } from './helpers';

useGitIdentity();

function setup() {
  const t = tempDir();
  const root = realPath(t.dir);
  const docs = join(root, 'docs');
  ensureDocsRepo(docs);
  const mobile = originAndClone(root, 'mobile');
  const backend = originAndClone(root, 'backend');
  const floors = { mobile: floor(mobile.repo), backend: floor(backend.repo, true, 'laravel') };
  const db = openDb(':memory:');
  let changes = 0;
  const foreign: string[] = [];
  const desk = new SyncDesk({
    db,
    git: runGit,
    root: () => docs,
    floors: () => floors,
    now: () => Date.now(),
    onChange: () => changes++,
    id: 'hub-a',
    onForeign: (dirs) => foreign.push(...dirs),
  });
  const fuentes = (slug: string, name: string) => join(docs, 'redaccion', '.fuentes', slug, name);
  // A snapshot made by hand, as another hub would leave it, with its marker (or none).
  const handmade = (slug: string, owner: string | null) => {
    mkdirSync(join(docs, 'redaccion', '.fuentes', slug), { recursive: true });
    git(mobile.repo, 'worktree', 'add', '-q', '--detach', fuentes(slug, 'mobile'), 'origin/develop');
    if (owner) writeFileSync(fuentes(slug, '.office'), `${owner}\n`);
  };
  return { ...t, root, docs, mobile, backend, db, desk, fuentes, handmade, foreign, changes: () => changes };
}

function ok(result: SyncResult) {
  if (!result.ok) throw new Error(result.error);
  return result;
}

const worktrees = (repo: string) => git(repo, 'worktree', 'list', '--porcelain');

describe('Redacción sources', () => {
  test('a plan gets a detached snapshot of origin/develop and the working copy is never touched', async () => {
    const s = setup();
    writeFileSync(join(s.mobile.repo, 'sin-commit.txt'), 'trabajo del usuario');
    const sha = pushCommit(s.mobile.seed, s.mobile.origin, 'viajes.dart', 'class Viajes {}', 'feat: viajes');
    const result = ok(await s.desk.sync({ slug: 'login', floors: ['mobile'] }));
    const first = result.floors[0]!;
    if (isSyncError(first)) throw new Error(first.error);
    expect(first).toMatchObject({ floor: 'mobile', ref: 'develop', sha, stale: false, reused: false, path: s.fuentes('login', 'mobile') });
    expect(readFileSync(join(first.path, 'viajes.dart'), 'utf8')).toBe('class Viajes {}');
    expect(git(first.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
    expect(git(s.mobile.repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/local');
    expect(existsSync(join(s.mobile.repo, 'viajes.dart'))).toBe(false);
    expect(git(s.mobile.repo, 'status', '--porcelain')).toContain('?? sin-commit.txt');
    expect(result.text).toContain(`mobile develop @ ${sha.slice(0, 7)}`);
    expect(result.text).toContain('Primer plan sobre mobile');
    expect(s.desk.base('login')).toEqual([{ floor: 'mobile', ref: 'develop', sha, date: expect.any(String), stale: false }]);
    expect(s.changes()).toBeGreaterThan(0);
    s.cleanup();
  });

  test('the next plan lists the commits since the previous one and each plan keeps its own fixed snapshot', async () => {
    const s = setup();
    const before = ok(await s.desk.sync({ slug: 'login', floors: ['mobile', 'backend'] }));
    expect(before.floors).toHaveLength(2);
    pushCommit(s.mobile.seed, s.mobile.origin, 'trips.dart', 'x', 'feat: pantalla de viajes');
    const next = ok(await s.desk.sync({ slug: 'viajes', floors: ['mobile'] }));
    expect(next.text).toContain('Cambios desde el último plan sobre mobile');
    expect(next.text).toContain('feat: pantalla de viajes');
    expect(existsSync(s.fuentes('login', 'mobile'))).toBe(true);
    expect(existsSync(s.fuentes('viajes', 'mobile'))).toBe(true);
    expect(existsSync(join(s.fuentes('login', 'mobile'), 'trips.dart'))).toBe(false);
    const again = ok(await s.desk.sync({ slug: 'login', floors: ['mobile'] }));
    expect(again.floors[0]).toMatchObject({ reused: true });
    expect(again.text).toContain('se mantiene fija');
    s.cleanup();
  });

  test('without network the last copy of origin/develop is used and flagged with its date', async () => {
    const s = setup();
    git(s.mobile.repo, 'remote', 'set-url', 'origin', join(s.root, 'no-existe.git'));
    const result = ok(await s.desk.sync({ slug: 'sin-red', floors: ['mobile'] }));
    expect(result.floors[0]).toMatchObject({ stale: true });
    expect(result.text).toContain('Sin actualizar');
    expect(s.desk.base('sin-red')[0]?.stale).toBe(true);
    s.cleanup();
  });

  test('a missing branch, an unknown floor and a bad slug give clear errors', async () => {
    const s = setup();
    const missing = await s.desk.sync({ slug: 'x', floors: ['mobile'], ref: 'no-existe' });
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.error).toContain('La rama no-existe no existe en origin de mobile');
    const unknown = await s.desk.sync({ slug: 'y', floors: ['nada'] });
    expect(!unknown.ok && unknown.error).toContain('No hay ninguna planta "nada"');
    const bad = await s.desk.sync({ slug: 'Mal Slug', floors: ['mobile'] });
    expect(bad).toMatchObject({ ok: false, status: 400 });
    const mixed = ok(await s.desk.sync({ slug: 'z', floors: ['mobile', 'nada'] }));
    expect(mixed.text).toContain('- nada: ERROR');
    s.cleanup();
  });

  test('closing a plan retires its worktrees and prunes them; cleanup removes orphans and finished plans and keeps plans in progress', async () => {
    const s = setup();
    ok(await s.desk.sync({ slug: 'login', floors: ['mobile', 'backend'] }));
    ok(await s.desk.sync({ slug: 'abierto', floors: ['mobile'] }));
    await s.desk.remove('login');
    expect(existsSync(s.fuentes('login', 'mobile'))).toBe(false);
    expect(existsSync(join(s.docs, 'redaccion', '.fuentes', 'login'))).toBe(false);
    expect(worktrees(s.mobile.repo)).not.toContain(s.fuentes('login', 'mobile'));
    expect(worktrees(s.backend.repo)).not.toContain(s.fuentes('login', 'backend'));
    expect(s.desk.base('login')).toEqual([]);

    s.handmade('fantasma', 'hub-a');
    const removed = await s.desk.cleanup(new Set());
    expect(removed).toContain('fantasma/mobile');
    expect(existsSync(s.fuentes('fantasma', 'mobile'))).toBe(false);
    expect(existsSync(join(s.docs, 'redaccion', '.fuentes', 'fantasma'))).toBe(false);
    expect(worktrees(s.mobile.repo)).not.toContain('fantasma');
    expect(existsSync(s.fuentes('abierto', 'mobile'))).toBe(true);
    expect(await s.desk.cleanup(new Set(['abierto']))).toContain('abierto');
    expect(existsSync(s.fuentes('abierto', 'mobile'))).toBe(false);
    s.cleanup();
  });

  test('a snapshot owned by another hub survives cleanup with an empty database', async () => {
    const s = setup();
    s.handmade('ajeno', 'hub-b');
    expect(await s.desk.cleanup(new Set())).toEqual([]);
    expect(existsSync(s.fuentes('ajeno', 'mobile'))).toBe(true);
    expect(existsSync(s.fuentes('ajeno', '.office'))).toBe(true);
    expect(worktrees(s.mobile.repo)).toContain(s.fuentes('ajeno', 'mobile'));
    expect(s.foreign).toEqual(['ajeno/mobile']);
    s.cleanup();
  });

  test('with an empty database and a foreign snapshot, own orphans are kept too', async () => {
    const s = setup();
    s.handmade('ajeno', 'hub-b');
    s.handmade('propio', 'hub-a');
    expect(await s.desk.cleanup(new Set())).toEqual([]);
    expect(existsSync(s.fuentes('ajeno', 'mobile'))).toBe(true);
    expect(existsSync(s.fuentes('propio', 'mobile'))).toBe(true);
    expect(s.foreign).toEqual(['ajeno/mobile']);
    s.cleanup();
  });

  test('syncFloor marks the plan folder and cleanup adopts unmarked folders of its own database', async () => {
    const s = setup();
    ok(await s.desk.sync({ slug: 'login', floors: ['mobile'] }));
    expect(readFileSync(s.fuentes('login', '.office'), 'utf8')).toBe('hub-a\n');
    rmSync(s.fuentes('login', '.office'));
    expect(await s.desk.cleanup(new Set())).toEqual([]);
    expect(readFileSync(s.fuentes('login', '.office'), 'utf8')).toBe('hub-a\n');
    expect(existsSync(s.fuentes('login', 'mobile'))).toBe(true);
    expect(s.foreign).toEqual([]);
    s.cleanup();
  });

  test('an unmarked folder outside the database is reported, not removed', async () => {
    const s = setup();
    ok(await s.desk.sync({ slug: 'login', floors: ['mobile'] }));
    s.handmade('viejo', null);
    expect(await s.desk.cleanup(new Set())).toEqual([]);
    expect(existsSync(s.fuentes('viejo', 'mobile'))).toBe(true);
    expect(s.foreign).toEqual(['viejo/mobile']);
    s.cleanup();
  });

  test('removing a floor retires its snapshots in every plan and keeps the other floors', async () => {
    const s = setup();
    ok(await s.desk.sync({ slug: 'login', floors: ['mobile', 'backend'] }));
    ok(await s.desk.sync({ slug: 'viajes', floors: ['mobile'] }));
    const count = (sql: string) => s.db.query<{ n: number }, []>(sql).get()?.n;

    expect(await s.desk.removeFloor('mobile')).toBe(2);
    expect(existsSync(s.fuentes('login', 'mobile'))).toBe(false);
    expect(existsSync(s.fuentes('viajes', 'mobile'))).toBe(false);
    expect(existsSync(join(s.docs, 'redaccion', '.fuentes', 'viajes'))).toBe(false);
    expect(existsSync(s.fuentes('login', 'backend'))).toBe(true);
    expect(count("SELECT COUNT(*) AS n FROM sync_worktrees WHERE floor = 'mobile'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM floor_sync WHERE floor = 'mobile'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM sync_worktrees WHERE floor = 'backend'")).toBe(1);
    expect(worktrees(s.mobile.repo)).not.toContain('.fuentes');
    expect(worktrees(s.backend.repo)).toContain(s.fuentes('login', 'backend'));
    expect(s.desk.base('login')).toEqual([expect.objectContaining({ floor: 'backend' })]);
    s.cleanup();
  });

  test('after approval the hub measures how far the base branch moved and which files changed', async () => {
    const s = setup();
    ok(await s.desk.sync({ slug: 'login', floors: ['mobile'] }));
    expect(s.desk.ahead('login')).toEqual([]);
    pushCommit(s.mobile.seed, s.mobile.origin, 'auth.dart', 'x', 'fix: auth');
    await s.desk.checkAhead('login');
    expect(s.desk.ahead('login')).toEqual([{ floor: 'mobile', commits: 1, files: ['auth.dart'] }]);
    s.cleanup();
  });

  test('plans older than the retention lose their sources', async () => {
    const s = setup();
    ok(await s.desk.sync({ slug: 'viejo', floors: ['mobile'] }));
    expect(await s.desk.expire(Date.now() - 1000, () => 0)).toEqual([]);
    expect(await s.desk.expire(Date.now() + 60_000, () => 0)).toEqual(['viejo']);
    expect(existsSync(s.fuentes('viejo', 'mobile'))).toBe(false);
    s.cleanup();
  });
});
