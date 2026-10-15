import { describe, expect, test } from 'bun:test';
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES_DIR, createKeyIfMissing, loadConfig, normalizeConfig, saveConfig } from '../src/config';
import { configTargets, watchTargets } from '../src/config-watch';
import { openDb } from '../src/db';
import { decideGate } from '../src/gate';
import { directorFloorsText, officeScript, sessionScript, sq } from '../src/office-sh';
import { loadProfiles } from '../src/profiles';
import { prune } from '../src/prune';
import { inOfficeScope, roleKind } from '../src/scope';
import { hostAllowed, injectKey, keyMatches, originAllowed } from '../src/security';
import { fakePaths, tempDir } from './helpers';

describe('config', () => {
  test('defaults fill missing or invalid values', () => {
    const c = normalizeConfig({ floors: { a: { path: '/x', stack: 'rust' }, b: { nope: 1 } }, port: -1 });
    expect(c).toEqual({ floors: { a: { path: '/x', stack: 'generic', managed: true } }, blockedAfterMinutes: 5, retentionDays: 14, port: 4747 });
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
    expect(roleKind('office-lead-mobile')).toBe('lead');
    expect(roleKind('office-dev-mobile')).toBe('dev');
    expect(roleKind('office-tester-mobile')).toBe('tester');
    expect(roleKind('office:reviewer')).toBe('reviewer');
    expect(roleKind('Explore')).toBe('intern');
    expect(roleKind(null)).toBe('intern');
  });

  test('only office sessions on managed floors or in the direction are in scope', () => {
    expect(inOfficeScope({ floorKind: 'managed', sessionRole: 'office-lead-mobile', leadRole: null })).toBe(true);
    expect(inOfficeScope({ floorKind: 'managed', sessionRole: null, leadRole: 'office-lead-mobile' })).toBe(true);
    expect(inOfficeScope({ floorKind: 'direccion', sessionRole: 'office:director', leadRole: null })).toBe(true);
    expect(inOfficeScope({ floorKind: 'observed', sessionRole: 'office-lead-mobile', leadRole: null })).toBe(false);
    expect(inOfficeScope({ floorKind: 'managed', sessionRole: 'Explore', leadRole: null })).toBe(false);
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
    const script = sessionScript({
      name: 'director',
      cwd: '/r/workspace',
      role: 'office:director',
      agent: 'office:director',
      extraArgs: ['--append-system-prompt-file', p.directorFloors],
    });
    expect(script).toContain("cd '/r/workspace' || exit 1");
    expect(script).toContain('export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1');
    expect(script).toContain(`'--append-system-prompt-file' '${p.directorFloors}'`);
    expect(script).toContain(`'--settings' '{"subagentPromptCacheTtl":"1h"}'`);
    expect(script.trimEnd().endsWith('"$@"')).toBe(true);
    const office = officeScript([{ name: 'director', cwd: '/r', role: 'r', agent: 'a', extraArgs: [] }], p);
    expect(office).toContain('tmux new-session -d -s agent-office');
    expect(office).toContain('tell application \\"Terminal\\" to do script');
    const floors = directorFloorsText(
      { floors: { mobile: { path: '/m', stack: 'flutter', managed: true }, old: { path: '/o', stack: 'node', managed: false } }, blockedAfterMinutes: 5, retentionDays: 14, port: 4747 },
      loadProfiles(PROFILES_DIR),
    );
    expect(floors).toContain('`mobile`: Flutter, repositorio /m. Jefe de planta: sesión `lead-mobile`.');
    expect(floors).not.toContain('old');
    cleanup();
  });
});
