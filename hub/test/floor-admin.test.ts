import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES_DIR, REPO_ROOT, loadConfig, saveConfig, type Paths } from '../src/config';
import { createFloorAdmin, type FloorAdmin } from '../src/floor-admin';
import { agentFile, removeFloor } from '../src/floor-cli';
import { FLOOR_TABLES } from '../src/floor-data';
import { realPath } from '../src/floors';
import type { GitRunner } from '../src/git';
import { loadProfiles } from '../src/profiles';
import type { FloorAddResult, FloorRemoveResult } from '../src/types';
import { ev, fakePaths, git, harness, makeRepo, testConfig, useGitIdentity, type Harness } from './helpers';

useGitIdentity();

const profiles = loadProfiles(PROFILES_DIR);
const ROLES = ['lead', 'dev', 'tester'] as const;
const MOBILE_SESSION = 'aaaaaaaa-0000-0000-0000-000000000001';
const TEAM_SESSION = 'bbbbbbbb-0000-0000-0000-000000000002';
const OTHER_SESSION = 'cccccccc-0000-0000-0000-000000000003';

function gitRepo(root: string, name: string, files: Record<string, string> = {}): string {
  const dir = makeRepo(root, name, files);
  git(dir, 'init', '--quiet');
  return realPath(dir);
}

function added(result: FloorAddResult) {
  if (!result.ok) throw new Error(result.error);
  return result;
}

function removed(result: FloorRemoveResult) {
  if (!result.ok) throw new Error(result.error);
  return result;
}

function seedFloorRows(db: Database, floor: string, session: string): void {
  const now = 1;
  db.query('INSERT INTO events (ts, session_id, agent_key, floor, event) VALUES (?, ?, ?, ?, ?)').run(now, session, session, floor, 'Seed');
  db.query('INSERT OR REPLACE INTO sessions (session_id, floor, started_at, updated_at) VALUES (?, ?, ?, ?)').run(session, floor, now, now);
  db.query('INSERT OR REPLACE INTO agents (agent_key, session_id, floor, updated_at) VALUES (?, ?, ?, ?)').run(`${session}-agent`, session, floor, now);
  db.query('INSERT INTO edits (ts, agent_key, floor, path) VALUES (?, ?, ?, ?)').run(now, session, floor, 'a.dart');
  db.query('INSERT INTO verdicts (ts, agent_key, floor, kind, ok) VALUES (?, ?, ?, ?, ?)').run(now, session, floor, 'tests', 1);
  db.query('INSERT INTO messages (ts, from_key, to_name, floor) VALUES (?, ?, ?, ?)').run(now, session, 'lead', floor);
  db.query('INSERT INTO questions (id, session_id, agent_key, floor, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    `q-${floor}`,
    session,
    session,
    floor,
    '[]',
    'answered',
    now,
  );
  db.query('INSERT INTO lessons (floor, role, text, norm, origin, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(floor, 'dev', 'leccion', `leccion-${floor}`, 'user', now);
  db.query('INSERT INTO reports (agent_key, floor, started_at, summary, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(`r-${floor}`, floor, now, 's', '{}', now);
  db.query('INSERT INTO alerts (ts, level, floor, agent_key, files) VALUES (?, ?, ?, ?, ?)').run(now, 'alerta', floor, session, '[]');
  db.query('INSERT INTO floor_sync (floor, ref, last_sha, updated_at) VALUES (?, ?, ?, ?)').run(floor, 'develop', 'abc', now);
}

function count(db: Database, table: string, floor: string): number {
  return db.query<{ n: number }, [string]>(`SELECT COUNT(*) AS n FROM ${table} WHERE floor = ?`).get(floor)?.n ?? -1;
}

function scoped(db: Database, table: string, scope: string): number {
  return db.query<{ n: number }, [string]>(`SELECT COUNT(*) AS n FROM ${table} WHERE scope = ?`).get(scope)?.n ?? -1;
}

describe('floor admin', () => {
  let h: Harness;
  let p: Paths;
  let admin: FloorAdmin;
  let broken: boolean;
  let duringGit: (() => void) | null;

  beforeEach(() => {
    broken = false;
    duringGit = null;
    const stubGit: GitRunner = async () => {
      if (broken) throw new Error('git colgado');
      duringGit?.();
      return { code: 0, stdout: '', stderr: '' };
    };
    h = harness({ git: stubGit });
    p = fakePaths(h.root);
    // Without a saved config loadConfig falls back to the real documents repo: everything here stays in the temp dir.
    saveConfig(p, testConfig({ docsRepo: join(h.root, 'docs') }));
    const reload = () => h.office.reload(loadConfig(p), profiles);
    admin = createFloorAdmin(p, () => profiles, h.office, reload);
  });
  afterEach(() => h.cleanup());

  test('adding a repository creates a managed floor with its three agents', () => {
    const repo = gitRepo(h.root, 'mobile', { 'pubspec.yaml': 'name: app\n' });
    const result = added(admin.add({ path: repo }));
    expect(result).toMatchObject({ slug: 'mobile', stack: 'flutter', path: repo });
    expect(result.startCommand).toContain('office-lead-mobile');
    for (const role of ROLES) expect(existsSync(agentFile(p, role, 'mobile'))).toBe(true);
    expect(loadConfig(p).floors.mobile?.managed).toBe(true);
    expect(h.office.snapshot().floors).toContainEqual(expect.objectContaining({ slug: 'mobile', kind: 'managed' }));
  });

  test('adding refuses bad paths, folders that are not a repository root, taken floors and reserved names', () => {
    const repo = gitRepo(h.root, 'mobile', { 'pubspec.yaml': '' });
    added(admin.add({ path: repo }));
    const mtimes = ROLES.map((role) => statSync(agentFile(p, role, 'mobile')).mtimeMs);

    expect(admin.add({ path: join(h.root, 'nope') })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('No existe') });
    expect(admin.add({ path: repo })).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('ya es la planta gestionada') });
    expect(ROLES.map((role) => statSync(agentFile(p, role, 'mobile')).mtimeMs)).toEqual(mtimes);
    expect(admin.add({ path: repo, slug: 'otra' })).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('ya es la planta') });
    expect(admin.add({ path: REPO_ROOT })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('copia de la que corre la oficina') });
    expect(admin.add({ path: gitRepo(h.root, 'x'), slug: 'redaccion' })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('reservado') });
    expect(admin.add({})).toMatchObject({ ok: false, status: 400 });

    expect(admin.add({ path: makeRepo(h.root, 'sin-git') })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('no es un repositorio git') });
    const sub = join(repo, 'lib');
    mkdirSync(sub);
    expect(admin.add({ path: sub })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('dentro del repositorio') });
    expect(loadConfig(p).floors.lib).toBeUndefined();
  });

  test('an observed floor left by floor remove can be managed again', () => {
    const repo = gitRepo(h.root, 'mobile');
    added(admin.add({ path: repo }));
    removeFloor(p, profiles, 'mobile');
    expect(loadConfig(p).floors.mobile?.managed).toBe(false);
    expect(added(admin.add({ path: repo })).slug).toBe('mobile');
    expect(loadConfig(p).floors.mobile?.managed).toBe(true);
  });

  function floorWithData(): { repo: string; snapshotDir: string } {
    const repo = gitRepo(h.root, 'mobile', { 'pubspec.yaml': '' });
    added(admin.add({ path: repo }));
    const config = loadConfig(p);
    config.permissionModes.mobile = 'plan';
    saveConfig(p, config);

    h.office.ingest(ev(MOBILE_SESSION, repo, 'SessionStart'));
    h.office.ingest(ev(MOBILE_SESSION, repo, 'PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'director', message: 'hola' } }));
    h.office.ingest(ev(MOBILE_SESSION, repo, 'SessionEnd', { reason: 'other' }));

    seedFloorRows(h.db, 'mobile', TEAM_SESSION);
    seedFloorRows(h.db, 'otra', OTHER_SESSION);
    h.db.query("UPDATE sessions SET team = 'equipo-x' WHERE session_id = ?").run(TEAM_SESSION);
    h.db.query("UPDATE agents SET team = 'equipo-agente' WHERE agent_key = ?").run(`${TEAM_SESSION}-agent`);
    for (const scope of ['session-aaaaaaaa', 'equipo-x', 'equipo-agente', 'session-cccccccc']) {
      h.db.query('INSERT INTO tasks (scope, task_id, updated_at) VALUES (?, ?, ?)').run(scope, '1', 1);
      h.db.query('INSERT INTO gate_decisions (ts, scope, decision) VALUES (?, ?, ?)').run(1, scope, 'pass');
    }
    h.db.query('INSERT OR REPLACE INTO floors (slug, path, stack) VALUES (?, ?, ?)').run('mobile', repo, 'flutter');
    h.db.query('INSERT INTO floors (slug, path, stack) VALUES (?, ?, ?)').run('otra', join(h.root, 'otra'), 'generic');

    const snapshotDir = join(h.root, 'docs', 'redaccion', '.fuentes', 'x', 'mobile');
    mkdirSync(snapshotDir, { recursive: true });
    h.db
      .query('INSERT INTO sync_worktrees (slug, floor, repo, path, ref, sha, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('x', 'mobile', repo, snapshotDir, 'develop', 'abc', 1);
    h.db
      .query('INSERT INTO sync_worktrees (slug, floor, repo, path, ref, sha, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('x', 'otra', join(h.root, 'otra'), join(h.root, 'docs', 'redaccion', '.fuentes', 'x', 'otra'), 'develop', 'abc', 1);
    return { repo, snapshotDir };
  }

  test('deleting a floor removes its config, agents, launcher, rows, snapshots and memory', async () => {
    const { snapshotDir } = floorWithData();
    expect(count(h.db, 'lessons', 'mobile')).toBeGreaterThan(0);
    expect(count(h.db, 'events', 'mobile')).toBeGreaterThan(0);
    const before = h.office.snapshot();
    expect(before.agents.some((agent) => agent.floor === 'mobile')).toBe(true);
    expect(before.sessions.some((session) => session.floor === 'mobile')).toBe(true);
    expect(before.messages.some((message) => message.floor === 'mobile')).toBe(true);
    h.messages.length = 0;

    const result = removed(await admin.remove('mobile'));
    expect(result.removed).toMatchObject({ files: 3, worktrees: 1 });
    expect(result.removed.rows).toBeGreaterThan(0);

    for (const table of FLOOR_TABLES) {
      expect(count(h.db, table, 'mobile')).toBe(0);
      expect(count(h.db, table, 'otra')).toBe(1);
    }
    for (const table of ['tasks', 'gate_decisions']) {
      expect(scoped(h.db, table, 'session-aaaaaaaa')).toBe(0);
      expect(scoped(h.db, table, 'equipo-x')).toBe(0);
      expect(scoped(h.db, table, 'equipo-agente')).toBe(0);
      expect(scoped(h.db, table, 'session-cccccccc')).toBe(1);
    }
    expect(h.db.query("SELECT slug FROM floors ORDER BY slug").all()).toEqual([{ slug: 'otra' }]);

    const config = loadConfig(p);
    expect(config.floors.mobile).toBeUndefined();
    expect(config.permissionModes.mobile).toBeUndefined();
    for (const role of ROLES) expect(existsSync(agentFile(p, role, 'mobile'))).toBe(false);
    expect(existsSync(join(p.sessionsDir, 'lead-mobile.sh'))).toBe(false);
    expect(readFileSync(p.officeSh, 'utf8')).not.toContain('mobile');
    expect(readFileSync(p.directorFloors, 'utf8')).not.toContain('mobile');
    expect(existsSync(snapshotDir)).toBe(false);

    const snapshot = h.office.snapshot();
    expect(snapshot.floors.map((floor) => floor.slug)).not.toContain('mobile');
    expect(snapshot.agents.filter((agent) => agent.floor === 'mobile')).toEqual([]);
    expect(snapshot.sessions.filter((session) => session.floor === 'mobile')).toEqual([]);
    expect(snapshot.messages.filter((message) => message.floor === 'mobile')).toEqual([]);
    expect(snapshot.activity.some((entry) => entry.summary.includes('planta borrada'))).toBe(true);

    const floorsAt = h.messages.findIndex((msg) => msg.type === 'floors');
    expect(floorsAt).toBeGreaterThan(0);
    expect(h.messages[floorsAt - 1]?.type).toBe('snapshot');
  });

  test('a delete that fails halfway keeps the floor and can be repeated', async () => {
    floorWithData();
    broken = true;
    expect(await admin.remove('mobile')).toMatchObject({ ok: false, status: 500 });
    expect(loadConfig(p).floors.mobile).toBeDefined();
    for (const role of ROLES) expect(existsSync(agentFile(p, role, 'mobile'))).toBe(true);

    broken = false;
    removed(await admin.remove('mobile'));
    expect(loadConfig(p).floors.mobile).toBeUndefined();
    for (const table of FLOOR_TABLES) expect(count(h.db, table, 'mobile')).toBe(0);
  });

  test('a delete whose launchers cannot be written keeps the floor and the retry writes them', async () => {
    floorWithData();
    rmSync(p.sessionsDir, { recursive: true, force: true });
    writeFileSync(p.sessionsDir, 'no es una carpeta');
    expect(await admin.remove('mobile')).toMatchObject({ ok: false, status: 500 });
    expect(loadConfig(p).floors.mobile).toBeDefined();
    expect(loadConfig(p).permissionModes.mobile).toBe('plan');

    rmSync(p.sessionsDir);
    removed(await admin.remove('mobile'));
    expect(loadConfig(p).floors.mobile).toBeUndefined();
    expect(readFileSync(p.officeSh, 'utf8')).not.toContain('mobile');
    expect(readFileSync(p.directorFloors, 'utf8')).not.toContain('mobile');
    expect(existsSync(join(p.sessionsDir, 'lead-mobile.sh'))).toBe(false);
  });

  test('a second delete of the same floor while the first runs is refused', async () => {
    floorWithData();
    const first = admin.remove('mobile');
    expect(await admin.remove('mobile')).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('ya se está borrando') });
    removed(await first);
  });

  test('a session opened on the floor while its snapshots are removed stops the delete', async () => {
    const { repo } = floorWithData();
    duringGit = () => {
      duringGit = null;
      h.office.ingest(ev('dddddddd-0000-0000-0000-000000000004', repo, 'SessionStart'), { socket: null, token: null, role: 'office-lead-mobile', name: 'lead-mobile' });
    };
    expect(await admin.remove('mobile')).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('lead-mobile') });
    expect(loadConfig(p).floors.mobile).toBeDefined();
    expect(count(h.db, 'lessons', 'mobile')).toBeGreaterThan(0);
  });

  test('reserved floors cannot be deleted', async () => {
    const config = loadConfig(p);
    config.floors.redaccion = { path: join(h.root, 'docs'), stack: 'generic', managed: false, baseBranch: 'develop' };
    config.permissionModes.redaccion = 'plan';
    saveConfig(p, config);
    expect(await admin.remove('redaccion')).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('reservado') });
    expect(await admin.remove('direccion')).toMatchObject({ ok: false, status: 400 });
    const after = loadConfig(p);
    expect(after.floors.redaccion).toBeDefined();
    expect(after.permissionModes.redaccion).toBe('plan');
  });

  test('deleting needs the floor sessions closed, an existing floor and a valid name', async () => {
    const repo = gitRepo(h.root, 'mobile');
    added(admin.add({ path: repo }));
    h.office.ingest(ev(MOBILE_SESSION, repo, 'SessionStart'), { socket: null, token: null, role: 'office-lead-mobile', name: 'lead-mobile' });

    expect(await admin.remove('mobile')).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('lead-mobile') });
    expect(loadConfig(p).floors.mobile).toBeDefined();
    expect(await admin.remove('nope')).toMatchObject({ ok: false, status: 404 });
    expect(await admin.remove('Mal slug')).toMatchObject({ ok: false, status: 400 });
  });
});
