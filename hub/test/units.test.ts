import { describe, expect, test } from 'bun:test';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_VERSION, DEFAULT_ROLES, PROFILES_DIR, createIdIfMissing, createKeyIfMissing, defaultConfig, loadConfig, migrateConfig, normalizeConfig, roleSettingsFor, saveConfig } from '../src/config';
import { configTargets, watchTargets } from '../src/config-watch';
import { openDb } from '../src/db';
import { roundCap } from '../src/documents';
import { decideGate, decideReviewGate } from '../src/gate';
import { directorFloorsText, modelArgs, officeScript, sessionScript, sessionSpecs, sq } from '../src/office-sh';
import { loadProfiles } from '../src/profiles';
import { prune } from '../src/prune';
import { departmentOf, inOfficeScope, roleFromName, roleIdOf, roleKind } from '../src/scope';
import { hostAllowed, injectKey, keyMatches, originAllowed } from '../src/security';
import { fakePaths, floor, tempDir, testConfig } from './helpers';

describe('config', () => {
  test('defaults fill missing or invalid values', () => {
    const c = normalizeConfig({
      floors: { a: { path: '/x', stack: 'rust', baseBranch: '../evil' }, b: { nope: 1 }, c: { path: '/c', baseBranch: 'main' } },
      port: -1,
      roles: { dev: { model: 'haiku', effort: 'max' }, tester: { model: 'bad model!', effort: 'turbo' }, nadie: { model: 'opus' } },
      review: { maxRounds: 99 },
      memory: { maxLessons: 10, maxContextChars: 10 },
      departments: { redaccion: false },
    });
    expect(c.floors).toEqual({
      a: { path: '/x', stack: 'generic', managed: true, baseBranch: 'develop' },
      c: { path: '/c', stack: 'generic', managed: true, baseBranch: 'main' },
    });
    expect(c.port).toBe(4747);
    expect(c.roles.dev).toEqual({ model: 'haiku', effort: 'max' });
    expect(c.roles.tester).toEqual(DEFAULT_ROLES.tester);
    expect(c.roles.director).toEqual({ model: 'fable', effort: 'xhigh' });
    expect(c.review.maxRounds).toBe(2);
    expect(c.memory).toEqual({ maxLessons: 10, maxLessonsPerSession: 3, maxContextChars: 2500 });
    expect(c.departments).toEqual({ redaccion: false, mantenimiento: true });
    expect(c.docsRepo).toBe('~/Projects/office-docs');
  });

  test('floor roles keep only valid targets, roles of that target and complete valid settings', () => {
    const c = normalizeConfig({
      floorRoles: {
        mobile: { dev: { model: 'fable', effort: 'xhigh' }, redactor: { model: 'opus', effort: 'low' }, tester: { model: 'sonnet' }, lead: { model: 'bad model!', effort: 'low' } },
        redaccion: { 'revisor-planes': { model: 'sonnet', effort: 'medium' }, dev: { model: 'opus', effort: 'high' } },
        'Mal Slug': { dev: { model: 'opus', effort: 'high' } },
        vacia: { dev: { model: 'x y', effort: 'high' } },
        texto: 'no',
      },
    });
    expect(c.floorRoles).toEqual({
      mobile: { dev: { model: 'fable', effort: 'xhigh' } },
      redaccion: { 'revisor-planes': { model: 'sonnet', effort: 'medium' } },
    });
    expect(normalizeConfig({}).floorRoles).toEqual({});
    expect(normalizeConfig({ floorRoles: [] }).floorRoles).toEqual({});
    expect(defaultConfig().floorRoles).toEqual({});
  });

  test('roleSettingsFor prefers the floor override and falls back to the global role', () => {
    const config = testConfig({ floorRoles: { mobile: { dev: { model: 'haiku', effort: 'low' } } } });
    expect(roleSettingsFor(config, 'mobile', 'dev')).toEqual({ model: 'haiku', effort: 'low' });
    expect(roleSettingsFor(config, 'mobile', 'tester')).toEqual(DEFAULT_ROLES.tester);
    expect(roleSettingsFor(config, 'backend', 'dev')).toEqual(DEFAULT_ROLES.dev);
    expect(roleSettingsFor(config, null, 'dev')).toEqual(DEFAULT_ROLES.dev);
    expect(roleSettingsFor(config, undefined, 'director')).toEqual(DEFAULT_ROLES.director);
  });

  test('a v1 config gains the v2 defaults without losing its floors', () => {
    const c = normalizeConfig({ floors: { mobile: { path: '/m', stack: 'flutter', managed: true } }, blockedAfterMinutes: 7, retentionDays: 14, port: 4800 });
    expect(c.floors.mobile).toEqual(floor('/m'));
    expect(c.blockedAfterMinutes).toBe(7);
    expect(c.port).toBe(4800);
    expect(c.roles).toEqual(DEFAULT_ROLES);
  });

  test('the v1 plan reviewer default goes through v2 to the v3 default once', () => {
    expect(defaultConfig().configVersion).toBe(CONFIG_VERSION);
    expect(CONFIG_VERSION).toBe(3);
    const legacy = { roles: { 'revisor-planes': { model: 'sonnet', effort: 'xhigh' }, dev: { model: 'haiku', effort: 'low' } } };
    const v1 = normalizeConfig(legacy);
    expect(v1.configVersion).toBe(1);
    expect(v1.roles['revisor-planes']).toEqual({ model: 'sonnet', effort: 'xhigh' });
    const migrated = migrateConfig(v1);
    expect(migrated.changed).toBe(true);
    expect(migrated.config.configVersion).toBe(3);
    expect(migrated.config.roles['revisor-planes']).toEqual({ model: 'sonnet', effort: 'medium' });
    expect(migrated.config.roles.dev).toEqual({ model: 'haiku', effort: 'low' });
    const chosen = migrateConfig(normalizeConfig({ roles: { 'revisor-planes': { model: 'sonnet', effort: 'high' } } }));
    expect(chosen.config.roles['revisor-planes']).toEqual({ model: 'sonnet', effort: 'high' });
    const v3 = migrateConfig(normalizeConfig({ ...legacy, configVersion: 3 }));
    expect(v3).toMatchObject({ changed: false, config: { roles: { 'revisor-planes': { model: 'sonnet', effort: 'xhigh' } } } });

    const { dir, cleanup } = tempDir();
    const p = fakePaths(dir);
    writeFileSync(p.config, JSON.stringify(legacy));
    expect(loadConfig(p).roles['revisor-planes']).toEqual({ model: 'sonnet', effort: 'medium' });
    const saved = JSON.parse(readFileSync(p.config, 'utf8'));
    expect(saved.configVersion).toBe(3);
    expect(saved.roles['revisor-planes']).toEqual({ model: 'sonnet', effort: 'medium' });
    saved.roles['revisor-planes'] = { model: 'sonnet', effort: 'xhigh' };
    writeFileSync(p.config, JSON.stringify(saved));
    expect(loadConfig(p).roles['revisor-planes']).toEqual({ model: 'sonnet', effort: 'xhigh' });
    cleanup();
  });

  test('the v3 migration moves only the values still at their old default', () => {
    expect(DEFAULT_ROLES.redactor).toEqual({ model: 'opus', effort: 'high' });
    expect(DEFAULT_ROLES['revisor-planes']).toEqual({ model: 'sonnet', effort: 'medium' });
    const old = {
      configVersion: 2,
      roles: { redactor: { model: 'fable', effort: 'xhigh' }, 'revisor-planes': { model: 'opus', effort: 'medium' } },
      review: { maxRounds: 4 },
      memory: { maxLessons: 30, maxLessonsPerSession: 3, maxContextChars: 4000 },
    };
    const migrated = migrateConfig(normalizeConfig(old));
    expect(migrated.changed).toBe(true);
    expect(migrated.config.configVersion).toBe(3);
    expect(migrated.config.review).toEqual({ maxRounds: 2, maxPlanBytes: 20000, maxReviewerReads: 30 });
    expect(migrated.config.memory.maxContextChars).toBe(2500);
    expect(migrated.config.roles.redactor).toEqual({ model: 'opus', effort: 'high' });
    expect(migrated.config.roles['revisor-planes']).toEqual({ model: 'sonnet', effort: 'medium' });
    expect(migrated.config.limits).toEqual({ maxBriefsPerOrder: 3, stalledAfterMinutes: 10 });

    const chosen = migrateConfig(
      normalizeConfig({
        configVersion: 2,
        roles: { redactor: { model: 'fable', effort: 'high' }, 'revisor-planes': { model: 'opus', effort: 'high' } },
        review: { maxRounds: 3 },
        memory: { maxContextChars: 6000 },
      }),
    );
    expect(chosen.config.review.maxRounds).toBe(3);
    expect(chosen.config.memory.maxContextChars).toBe(6000);
    expect(chosen.config.roles.redactor).toEqual({ model: 'fable', effort: 'high' });
    expect(chosen.config.roles['revisor-planes']).toEqual({ model: 'opus', effort: 'high' });

    const current = migrateConfig(normalizeConfig({ ...old, configVersion: 3 }));
    expect(current.changed).toBe(false);
    expect(current.config.review.maxRounds).toBe(4);
    expect(current.config.roles.redactor).toEqual({ model: 'fable', effort: 'xhigh' });
  });

  test('the new limits are normalized within their ranges, 0 included', () => {
    const c = normalizeConfig({ review: { maxPlanBytes: 0, maxReviewerReads: 501 }, limits: { maxBriefsPerOrder: 0, stalledAfterMinutes: -1 } });
    expect(c.review).toEqual({ maxRounds: 2, maxPlanBytes: 0, maxReviewerReads: 30 });
    expect(c.limits).toEqual({ maxBriefsPerOrder: 0, stalledAfterMinutes: 10 });
    expect(normalizeConfig({ limits: 'no' }).limits).toEqual({ maxBriefsPerOrder: 3, stalledAfterMinutes: 10 });
  });

  test('the key is created once with private permissions', () => {
    const { dir, cleanup } = tempDir();
    const p = fakePaths(dir);
    const first = createKeyIfMissing(p);
    expect(first.created).toBe(true);
    expect(first.key).toMatch(/^[0-9a-f]{64}$/);
    expect(createKeyIfMissing(p)).toEqual({ key: first.key, created: false });
    expect(statSync(p.key).mode & 0o777).toBe(0o600);
    saveConfig(p, loadConfig(p));
    expect(statSync(p.config).mode & 0o777).toBe(0o600);
    cleanup();
  });

  test('the hub id is created once with private permissions', () => {
    const { dir, cleanup } = tempDir();
    const p = fakePaths(dir);
    const first = createIdIfMissing(p);
    expect(first.created).toBe(true);
    expect(first.id).toMatch(/^[0-9a-f]{16}$/);
    expect(createIdIfMissing(p)).toEqual({ id: first.id, created: false });
    expect(statSync(p.id).mode & 0o777).toBe(0o600);
    cleanup();
  });

  test('the watcher fires for config.json and ignores the database', async () => {
    const { dir, cleanup } = tempDir();
    let calls = 0;
    const stop = watchTargets(configTargets(dir, join(dir, 'no-profiles')), () => calls++, 50);
    writeFileSync(join(dir, 'office.db'), 'x');
    await Bun.sleep(400);
    expect(calls).toBe(0);
    writeFileSync(join(dir, 'config.json'), '{}');
    const start = Date.now();
    while (calls === 0 && Date.now() - start < 3000) await Bun.sleep(25);
    expect(calls).toBeGreaterThanOrEqual(1);
    stop();
    cleanup();
  });
});

describe('prune', () => {
  test('removes rows older than the retention and keeps pending questions and live sessions', () => {
    const db = openDb(':memory:');
    const now = 1_800_000_000_000;
    const old = now - 15 * 86_400_000;
    const recent = now - 86_400_000;
    const event = db.query('INSERT INTO events (ts, session_id, agent_key, floor, event) VALUES (?, ?, ?, ?, ?)');
    event.run(old, 's', 'a', 'f', 'Stop');
    event.run(recent, 's', 'a', 'f', 'Stop');
    const session = db.query('INSERT INTO sessions (session_id, started_at, updated_at, ended_at) VALUES (?, ?, ?, ?)');
    session.run('ended-old', old, old, old);
    session.run('stale', old, old, null);
    session.run('live', recent, recent, null);
    const question = db.query("INSERT INTO questions (id, session_id, agent_key, floor, payload, status, created_at) VALUES (?, 's', 'a', 'f', '[]', ?, ?)");
    question.run('q-old', 'answered', old);
    question.run('q-pending', 'pending', old);
    expect(prune(db, now, 14)).toBe(4);
    expect(db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM events').get()?.n).toBe(1);
    expect(db.query<{ id: string }, []>('SELECT session_id AS id FROM sessions').all().map((r) => r.id)).toEqual(['live']);
    expect(db.query<{ id: string }, []>('SELECT id FROM questions').all().map((r) => r.id)).toEqual(['q-pending']);
  });
});

describe('security', () => {
  test('only the hub host and port are allowed', () => {
    expect(hostAllowed('127.0.0.1:4747', 4747)).toBe(true);
    expect(hostAllowed('localhost:4747', 4747)).toBe(true);
    expect(hostAllowed('evil.test:4747', 4747)).toBe(false);
    expect(hostAllowed('127.0.0.1:4748', 4747)).toBe(false);
    expect(hostAllowed(null, 4747)).toBe(false);
  });

  test('keys compare in constant time and refuse empty values', () => {
    expect(keyMatches('abc', 'abc')).toBe(true);
    expect(keyMatches('abd', 'abc')).toBe(false);
    expect(keyMatches('ab', 'abc')).toBe(false);
    expect(keyMatches(undefined, 'abc')).toBe(false);
  });

  test('dev origins are only accepted in dev mode', () => {
    expect(originAllowed('http://127.0.0.1:4747', 4747, false)).toBe(true);
    expect(originAllowed('http://localhost:5173', 4747, false)).toBe(false);
    expect(originAllowed('http://localhost:5173', 4747, true)).toBe(true);
    expect(originAllowed('https://evil.test', 4747, true)).toBe(false);
    expect(originAllowed(null, 4747, true)).toBe(false);
  });

  test('the key goes into the head of the page', () => {
    expect(injectKey('<html><head></head></html>', 'k')).toBe('<html><head><script>window.__OFFICE_KEY__="k"</script></head></html>');
  });
});

describe('scope and roles', () => {
  test('role kinds', () => {
    expect(roleKind('office:director')).toBe('director');
    expect(roleKind('office-director')).toBe('director');
    expect(roleKind('office-lead-mobile')).toBe('lead');
    expect(roleKind('office-dev-mobile')).toBe('dev');
    expect(roleKind('office-tester-mobile')).toBe('tester');
    expect(roleKind('office:reviewer')).toBe('reviewer');
    expect(roleKind('office-reviewer')).toBe('reviewer');
    expect(roleKind('office-lead-redaccion')).toBe('lead');
    expect(roleKind('office-redactor')).toBe('writer');
    expect(roleKind('office-revisor-planes')).toBe('planReviewer');
    expect(roleKind('office-artesano')).toBe('skillwright');
    expect(roleKind('office-revisor-skills')).toBe('skillReviewer');
    expect(roleKind('Explore')).toBe('intern');
    expect(roleKind(null)).toBe('intern');
  });

  test('role ids and departments', () => {
    expect(roleIdOf('office-lead-mantenimiento')).toBe('lead');
    expect(roleIdOf('office-dev-backend')).toBe('dev');
    expect(roleIdOf('office-revisor-planes')).toBe('revisor-planes');
    expect(roleIdOf('Explore')).toBeNull();
    expect(departmentOf('office-redactor')).toBe('redaccion');
    expect(departmentOf('office-lead-mantenimiento')).toBe('mantenimiento');
    expect(departmentOf('office-lead-mobile')).toBeNull();
  });

  test('teammate names map to their type by prefix only on the right floor', () => {
    expect(roleFromName('dev-mobile', 'mobile', 'managed')).toBe('office-dev-mobile');
    expect(roleFromName('tester-mobile', 'mobile', 'managed')).toBe('office-tester-mobile');
    expect(roleFromName('reviewer-mobile', 'mobile', 'managed')).toBe('office-reviewer');
    expect(roleFromName('redactor-login', 'redaccion', 'redaccion')).toBe('office-redactor');
    expect(roleFromName('revisor-planes-login-r2', 'redaccion', 'redaccion')).toBe('office-revisor-planes');
    expect(roleFromName('artesano-pdf', 'mantenimiento', 'mantenimiento')).toBe('office-artesano');
    expect(roleFromName('revisor-skills-pdf-r1', 'mantenimiento', 'mantenimiento')).toBe('office-revisor-skills');
    expect(roleFromName('redactor-login', 'mobile', 'managed')).toBeNull();
    expect(roleFromName('dev-mobile', 'kapper', 'observed')).toBeNull();
    expect(roleFromName('developer', 'mobile', 'managed')).toBeNull();
  });

  test('only office sessions on managed floors or in the direction are in scope', () => {
    expect(inOfficeScope({ floorKind: 'managed', sessionRole: 'office-lead-mobile', leadRole: null })).toBe(true);
    expect(inOfficeScope({ floorKind: 'managed', sessionRole: null, leadRole: 'office-lead-mobile' })).toBe(true);
    expect(inOfficeScope({ floorKind: 'direccion', sessionRole: 'office:director', leadRole: null })).toBe(true);
    expect(inOfficeScope({ floorKind: 'observed', sessionRole: 'office-lead-mobile', leadRole: null })).toBe(false);
    expect(inOfficeScope({ floorKind: 'managed', sessionRole: 'Explore', leadRole: null })).toBe(false);
    expect(inOfficeScope({ floorKind: 'redaccion', sessionRole: 'office-lead-redaccion', leadRole: null })).toBe(true);
    expect(inOfficeScope({ floorKind: 'mantenimiento', sessionRole: null, leadRole: 'office-lead-mantenimiento' })).toBe(true);
  });
});

describe('gate decision', () => {
  const base = { officeTeam: true, floorManaged: true, owner: 'dev-mobile', lastOwnerEdit: 100, lastTesterGreen: null };
  test('rules', () => {
    expect(decideGate({ ...base, officeTeam: false }).pass).toBe(true);
    expect(decideGate({ ...base, floorManaged: false }).pass).toBe(true);
    expect(decideGate({ ...base, lastOwnerEdit: null }).pass).toBe(true);
    expect(decideGate(base).pass).toBe(false);
    expect(decideGate({ ...base, lastTesterGreen: 100 }).pass).toBe(false);
    expect(decideGate({ ...base, lastTesterGreen: 101 }).pass).toBe(true);
    expect(decideGate(base).reason).toContain('de dev-mobile');
  });
});

describe('launch scripts', () => {
  test('single quotes are escaped for the shell', () => {
    expect(sq("it's")).toBe(`'it'\\''s'`);
  });

  test('the director gets its floor list and every session exports the office variables', () => {
    const { dir, cleanup } = tempDir();
    const p = fakePaths(dir);
    const script = sessionScript(
      {
        name: 'director',
        cwd: '/r/workspace',
        role: 'office-director',
        agent: 'office-director',
        extraArgs: ['--append-system-prompt-file', p.directorFloors, ...modelArgs({ model: 'opus', effort: 'high' })],
        needsHub: false,
        permissionMode: 'auto',
        settings: { subagentPromptCacheTtl: '1h' },
      },
      4747,
    );
    expect(script).toContain("cd '/r/workspace' || exit 1");
    expect(script).toContain('export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1');
    expect(script).toContain(`'--append-system-prompt-file' '${p.directorFloors}'`);
    expect(script).toContain(`'--settings' '{"subagentPromptCacheTtl":"1h"}'`);
    expect(script).toContain("'--model' 'opus' '--effort' 'high'");
    expect(script).not.toContain('/health');
    expect(script.trimEnd().endsWith('"$@"')).toBe(true);
    const office = officeScript(
      [{ name: 'director', cwd: '/r', role: 'r', agent: 'a', extraArgs: [], needsHub: false, permissionMode: 'auto', settings: {} }],
      p,
    );
    expect(office).toContain('tmux new-session -d -s agent-office');
    expect(office).toContain('tell application \\"Terminal\\" to do script');
    const config = testConfig({ floors: { mobile: floor('/m'), old: floor('/o', false, 'node') }, departments: { redaccion: true, mantenimiento: false } });
    const floors = directorFloorsText(config, loadProfiles(PROFILES_DIR));
    expect(floors).toContain('`mobile`: Flutter, repositorio /m, rama base `develop`. Jefe de planta: sesión `lead-mobile`.');
    expect(floors).not.toContain('old');
    expect(floors).toContain('Redacción: sesión `lead-redaccion`');
    expect(floors).not.toContain('Mantenimiento: sesión');
    cleanup();
  });

  test('inherit sends no model flag and the effort always goes', () => {
    expect(modelArgs({ model: 'inherit', effort: 'low' })).toEqual(['--effort', 'low']);
    expect(modelArgs({ model: 'claude-opus-5-5', effort: 'xhigh' })).toEqual(['--model', 'claude-opus-5-5', '--effort', 'xhigh']);
  });

  test('department leads open in their folder, check the hub first and only Mantenimiento gets the skills folder', () => {
    const { dir, cleanup } = tempDir();
    const p = fakePaths(dir);
    const config = testConfig({
      docsRepo: '/docs',
      departments: { redaccion: true, mantenimiento: true },
      floors: { mobile: floor('/m') },
      roles: { ...DEFAULT_ROLES, lead: { model: 'haiku', effort: 'low' } },
    });
    const specs = sessionSpecs(config, p, '/ws');
    expect(specs.map((s) => s.name)).toEqual(['director', 'lead-mobile', 'lead-redaccion', 'lead-mantenimiento']);
    const redaccion = specs.find((s) => s.name === 'lead-redaccion')!;
    const mantenimiento = specs.find((s) => s.name === 'lead-mantenimiento')!;
    expect(redaccion).toMatchObject({ cwd: '/docs/redaccion', agent: 'office-lead-redaccion', needsHub: true });
    expect(redaccion.extraArgs).not.toContain('--add-dir');
    expect(mantenimiento).toMatchObject({ cwd: '/docs/taller', agent: 'office-lead-mantenimiento', needsHub: true });
    expect(mantenimiento.extraArgs.slice(0, 2)).toEqual(['--add-dir', p.skillsDir]);
    expect(specs.find((s) => s.name === 'lead-mobile')!.extraArgs).toEqual(['--model', 'haiku', '--effort', 'low']);
    const script = sessionScript(redaccion, 4747);
    expect(script).toContain("curl -sf -m 2 'http://127.0.0.1:4747/health'");
    expect(script.indexOf('/health')).toBeLessThan(script.indexOf('exec claude'));
    expect(script).toContain("export AGENT_OFFICE_ROLE='office-lead-redaccion'");
    cleanup();
  });
});

describe('round cap', () => {
  test('a REVISAR over the effective cap is blocked with the reason', () => {
    const over = decideReviewGate({ path: 'redaccion/planes/x.md', round: 3, cap: 2, maxRounds: 2 });
    expect(over.pass).toBe(false);
    expect(over.reason).toContain('ronda 3');
    expect(over.reason).toContain('2 rondas');
    expect(decideReviewGate({ path: 'redaccion/planes/x.md', round: 2, cap: 2, maxRounds: 2 }).pass).toBe(true);
    expect(decideReviewGate({ path: 'redaccion/planes/x.md', round: null, cap: 2, maxRounds: 2 }).pass).toBe(true);
    expect(decideReviewGate({ path: 'redaccion/planes/x.md', round: 5, cap: 6, maxRounds: 4 }).pass).toBe(true);
    const renewed = decideReviewGate({ path: 'redaccion/planes/x.md', round: 7, cap: 6, maxRounds: 4 });
    expect(renewed.pass).toBe(false);
    expect(renewed.reason).toContain('gastadas');
  });

  test('every SIN ACUERDO adds its round to the configured maximum', () => {
    expect(roundCap(4, null)).toBe(4);
    expect(roundCap(4, 4)).toBe(8);
  });
});
