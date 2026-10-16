import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_VERSION, PROFILES_DIR, defaultConfig, migrateConfig, normalizeConfig, validChecks, validLinkDirs } from '../src/config';
import { openDb } from '../src/db';
import { purgeFloorData } from '../src/floor-data';
import { checkFilesOf, checksOf, defaultChecks, defaultSetup, gateModeOf, loadProfiles, setupOf } from '../src/profiles';
import { prune, pruneInChunks } from '../src/prune';
import { tempDir } from './helpers';

describe('config v4', () => {
  test('a v3 config migrates to v4 keeping its floors and gaining the delivery defaults', () => {
    const v3 = normalizeConfig({ configVersion: 3, floors: { mobile: { path: '/m', stack: 'flutter', managed: true, baseBranch: 'develop' } } });
    expect(v3.checksConfig).toEqual({ timeoutMinutes: 15, maxParallel: 2, tailBytes: 8000 });
    expect(v3.worktrees).toEqual({ retentionDays: 3, maxActivePerFloor: 4, warnTotalGb: 20 });
    expect(v3.checkpoints.maxFileKb).toBe(1024);
    expect(v3.checkpoints.skipGlobs).toContain('*.log');
    const migrated = migrateConfig(v3);
    expect(migrated).toMatchObject({ changed: true, config: { configVersion: CONFIG_VERSION, floors: { mobile: { path: '/m' } } } });
    expect(migrated.config.floors.mobile).toEqual({ path: '/m', stack: 'flutter', managed: true, baseBranch: 'develop' });
    expect(migrateConfig(migrated.config).changed).toBe(false);
  });

  test('the delivery settings are normalized within their ranges', () => {
    const c = normalizeConfig({
      checksConfig: { timeoutMinutes: 0, maxParallel: 3, tailBytes: 99 },
      worktrees: { retentionDays: 7, maxActivePerFloor: 99, warnTotalGb: 30 },
      checkpoints: { maxFileKb: 0, skipGlobs: ['*.zip'] },
    });
    expect(c.checksConfig).toEqual({ timeoutMinutes: 15, maxParallel: 3, tailBytes: 8000 });
    expect(c.worktrees).toEqual({ retentionDays: 7, maxActivePerFloor: 4, warnTotalGb: 30 });
    expect(c.checkpoints).toEqual({ maxFileKb: 1024, skipGlobs: ['*.zip'] });
    expect(normalizeConfig({ checkpoints: { skipGlobs: 'no' } }).checkpoints.skipGlobs).toEqual(defaultConfig().checkpoints.skipGlobs);
  });

  test('per-floor fields are kept when valid and dropped when not', () => {
    const c = normalizeConfig({
      floors: {
        mobile: {
          path: '/m',
          stack: 'flutter',
          checks: [{ name: 'test', command: 'flutter test' }],
          setup: null,
          linkDirs: ['node_modules'],
          gateMode: 'checks+tester',
          review: 'large',
          reviewLargeLines: 500,
          checkFiles: ['build.yaml'],
          delivery: true,
        },
        backend: { path: '/b', stack: 'laravel', checks: [{ name: 'Bad Name', command: 'x' }], gateMode: 'nope', linkDirs: ['../x'], reviewLargeLines: 1 },
      },
    });
    expect(c.floors.mobile).toMatchObject({
      checks: [{ name: 'test', command: 'flutter test' }],
      setup: null,
      linkDirs: ['node_modules'],
      gateMode: 'checks+tester',
      review: 'large',
      reviewLargeLines: 500,
      checkFiles: ['build.yaml'],
      delivery: true,
    });
    expect(c.floors.backend).toEqual({ path: '/b', stack: 'laravel', managed: true, baseBranch: 'develop' });
    const off = normalizeConfig({ floors: { a: { path: '/a', delivery: false }, b: { path: '/b', delivery: 'yes' } } });
    expect(off.floors.a).toEqual({ path: '/a', stack: 'generic', managed: true, baseBranch: 'develop' });
    expect(off.floors.b).toEqual({ path: '/b', stack: 'generic', managed: true, baseBranch: 'develop' });
  });

  test('validChecks enforces the name, the command and the count', () => {
    expect(validChecks([{ name: 'a-1', command: 'bun test' }])).toEqual([{ name: 'a-1', command: 'bun test' }]);
    expect(validChecks([])).toEqual([]);
    expect(validChecks([{ name: 'A', command: 'x' }])).toBeNull();
    expect(validChecks([{ name: 'a', command: 'x' }, { name: 'a', command: 'y' }])).toBeNull();
    expect(validChecks([{ name: 'a', command: 'x'.repeat(301) }])).toBeNull();
    expect(validChecks([{ name: 'a', command: 'x\ny' }])).toBeNull();
    expect(validChecks(Array.from({ length: 9 }, (_, i) => ({ name: `c${i}`, command: 'x' })))).toBeNull();
    expect(validLinkDirs(['vendor', 'a/b'])).toEqual(['vendor', 'a/b']);
    expect(validLinkDirs(['/abs'])).toBeNull();
  });
});

describe('profile defaults', () => {
  const profiles = loadProfiles(PROFILES_DIR);

  test('flutter, laravel and generic', () => {
    expect(defaultChecks('/x', 'flutter').map((c) => c.name)).toEqual(['analyze', 'test']);
    expect(defaultSetup('/x', 'flutter')).toBe('flutter pub get');
    expect(defaultChecks('/x', 'laravel').map((c) => c.command)).toEqual(['php artisan test', 'vendor/bin/pint --test']);
    expect(defaultSetup('/x', 'laravel')).toBe('composer install --no-interaction');
    expect(defaultChecks('/x', 'generic')).toEqual([]);
    expect(defaultSetup('/x', 'generic')).toBeNull();
  });

  test('node reads the scripts of package.json and the runner of the lockfile', () => {
    const { dir, cleanup } = tempDir();
    const bun = join(dir, 'bun');
    mkdirSync(bun);
    writeFileSync(join(bun, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .', build: 'vite build' } }));
    writeFileSync(join(bun, 'bun.lock'), '');
    expect(defaultChecks(bun, 'node')).toEqual([
      { name: 'test', command: 'bun run test' },
      { name: 'lint', command: 'bun run lint' },
    ]);
    expect(defaultSetup(bun, 'node')).toBe('bun install');
    const npm = join(dir, 'npm');
    mkdirSync(npm);
    writeFileSync(join(npm, 'package.json'), JSON.stringify({ scripts: { test: 'jest', typecheck: 'tsc' } }));
    expect(defaultChecks(npm, 'node')).toEqual([
      { name: 'test', command: 'npm test' },
      { name: 'typecheck', command: 'npm run typecheck' },
    ]);
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    expect(defaultChecks(empty, 'node')).toEqual([]);
    expect(defaultSetup(empty, 'node')).toBeNull();
    cleanup();
  });

  test('a floor overrides checks and setup, and without checks the gate stays on the tester', () => {
    const floor = { path: '/x', stack: 'flutter' as const };
    expect(gateModeOf(floor)).toBe('checks');
    expect(checksOf({ ...floor, checks: [] })).toEqual([]);
    expect(gateModeOf({ ...floor, checks: [] })).toBe('tester');
    expect(gateModeOf({ ...floor, gateMode: 'checks+tester' })).toBe('checks+tester');
    expect(gateModeOf({ path: '/x', stack: 'generic' as const })).toBe('tester');
    expect(setupOf({ ...floor, setup: null })).toBeNull();
    expect(setupOf({ ...floor, setup: 'make deps' })).toBe('make deps');
    expect(setupOf(floor)).toBe('flutter pub get');
  });

  test('checkFiles joins the profile and the floor patterns', () => {
    expect(checkFilesOf(profiles, { stack: 'node', checkFiles: ['build.yaml'] })).toEqual(expect.arrayContaining(['tsconfig*.json', 'package.json#scripts', 'build.yaml']));
    expect(checkFilesOf(profiles, { stack: 'flutter' })).toEqual(['analysis_options.yaml', 'dart_test.yaml']);
    expect(checkFilesOf(profiles, { stack: 'generic' })).toEqual([]);
  });
});

describe('purge and prune cover the delivery tables', () => {
  function seed() {
    const db = openDb(':memory:');
    db.query("INSERT INTO orders (slug, floor, title, source, created_at, updated_at) VALUES ('a', 'mobile', 'A', 'director', 1, 1)").run();
    db.query("INSERT INTO orders (slug, floor, title, source, created_at, updated_at) VALUES ('b', 'backend', 'B', 'director', 1, 1)").run();
    for (const orderId of [1, 2]) {
      db.query("INSERT INTO checkpoints (order_id, sha, reason, label, created_at) VALUES (?, 'abcdef1', 'listo', 'x', 1)").run(orderId);
      db.query("INSERT INTO order_comments (order_id, path, line, side, text, created_at) VALUES (?, 'a', 1, 'new', 'x', 1)").run(orderId);
      db.query("INSERT INTO review_findings (order_id, sha, reviewer_key, n, text, created_at) VALUES (?, 'abcdef1', 'r', 1, 'x', 1)").run(orderId);
    }
    db.query("INSERT INTO check_runs (order_id, floor, slug, sha, trigger, status, started_at) VALUES (1, 'mobile', 'a', 'abcdef1', 'listo', 'passed', 10)").run();
    db.query("INSERT INTO check_runs (order_id, floor, slug, sha, trigger, status, started_at) VALUES (2, 'backend', 'b', 'abcdef1', 'listo', 'passed', 10)").run();
    db.query("INSERT INTO checks (run_id, floor, slug, name, command, status, output_tail) VALUES (1, 'mobile', 'a', 'test', 'x', 'passed', 'salida')").run();
    db.query("INSERT INTO checks (run_id, floor, slug, name, command, status, output_tail) VALUES (2, 'backend', 'b', 'test', 'x', 'passed', 'salida')").run();
    db.query("INSERT INTO activity_log (ts, agent_key, floor, event, summary) VALUES (1, 'a', 'mobile', 'Stop', '{}')").run();
    return db;
  }
  const count = (db: ReturnType<typeof openDb>, table: string) => db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n;

  test('removing a floor deletes its orders and everything that hangs from them, and only its own', () => {
    const db = seed();
    purgeFloorData(db, 'mobile', '/m');
    for (const table of ['orders', 'checkpoints', 'order_comments', 'review_findings', 'check_runs', 'checks']) expect(count(db, table)).toBe(1);
    expect(count(db, 'activity_log')).toBe(0);
    expect(db.query<{ slug: string }, []>('SELECT slug FROM orders').get()?.slug).toBe('b');
    expect(db.query<{ order_id: number }, []>('SELECT order_id FROM checkpoints').get()?.order_id).toBe(2);
  });

  test('past the retention the output of the checks goes and the result stays', async () => {
    const db = seed();
    const day = 86_400_000;
    prune(db, 10 + 30 * day, 14);
    expect(db.query('SELECT output_tail FROM checks').all()).toEqual([{ output_tail: null }, { output_tail: null }]);
    expect(count(db, 'check_runs')).toBe(2);
    expect(count(db, 'activity_log')).toBe(0);
    const again = seed();
    await pruneInChunks(again, 10 + 30 * day, 14);
    expect(again.query('SELECT output_tail FROM checks').all()).toEqual([{ output_tail: null }, { output_tail: null }]);
    const fresh = seed();
    prune(fresh, 10 + day, 14);
    expect(fresh.query('SELECT output_tail FROM checks').all()).toEqual([{ output_tail: 'salida' }, { output_tail: 'salida' }]);
  });
});
