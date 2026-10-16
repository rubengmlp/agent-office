import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES_DIR, REPO_ROOT, normalizeConfig } from '../src/config';
import { FloorError, planFloor } from '../src/floor-cli';
import { clonePermissions, isOfficeClone, sessionScript, sessionSpecs } from '../src/office-sh';
import { loadProfiles } from '../src/profiles';
import { applySettings, settingsView } from '../src/settings';
import type { HookMeta } from '../src/types';
import { ev, fakePaths, floor, harness, makeRepo, tempDir, testConfig, type Harness } from './helpers';

const LEAD = '33333333-cccc-4ddd-8eee-000000000003';
const leadMeta: HookMeta = { socket: null, token: null, role: 'office-lead-mobile', name: 'lead-mobile' };

let h: Harness;
afterEach(() => h?.cleanup());

function watched(): string {
  h = harness({ holdMs: 60_000 });
  const repo = join(h.root, 'mobile');
  mkdirSync(repo, { recursive: true });
  h.config.floors.mobile = floor(repo);
  h.office.heartbeat(true);
  h.office.ingest(ev(LEAD, repo, 'SessionStart', {}), leadMeta);
  return repo;
}

const request = (repo: string, command: string, extra: Record<string, unknown> = {}) =>
  ev(LEAD, repo, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command }, ...extra });

describe('permission requests in the panel', () => {
  test('a request waits in the panel and Permitir answers allow', async () => {
    const repo = watched();
    const pending = h.office.permission(request(repo, 'bun run hub'), leadMeta);
    const question = h.office.snapshot().questions[0];
    expect(question).toMatchObject({ kind: 'permission', detail: 'bun run hub', agentKey: LEAD, floor: 'mobile' });
    expect(question?.questions[0]?.question).toBe('¿Permites a lead-mobile ejecutar este comando?');
    expect(h.office.answer(question!.id, { [question!.questions[0]!.question]: 'Quizá' })).toBe('invalid');
    expect(h.office.answer(question!.id, { [question!.questions[0]!.question]: 'Permitir' })).toBe('ok');
    expect(JSON.parse((await pending) ?? '{}')).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    expect(h.office.snapshot().activity.some((a) => a.summary.startsWith('permiso esperando en el panel'))).toBe(true);
  });

  test('Denegar answers deny with a message for Claude', async () => {
    const repo = watched();
    const pending = h.office.permission(request(repo, 'rm -rf build'), leadMeta);
    const question = h.office.snapshot().questions[0]!;
    h.office.answer(question.id, { [question.questions[0]!.question]: 'Denegar' });
    const decision = JSON.parse((await pending) ?? '{}').hookSpecificOutput.decision;
    expect(decision).toMatchObject({ behavior: 'deny', interrupt: false });
    expect(decision.message).toContain('panel de Agent Office');
  });

  test('an answer in the terminal releases the panel question when the same call runs or the turn ends', async () => {
    const repo = watched();
    const first = h.office.permission(request(repo, 'bun run hub'), leadMeta);
    const other = h.office.permission(request(repo, 'bun run office'), leadMeta);
    expect(h.office.snapshot().questions).toHaveLength(2);
    h.office.ingest(ev(LEAD, repo, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'bun run hub' } }));
    expect(await first).toBeNull();
    expect(h.office.snapshot().questions.map((q) => q.detail)).toEqual(['bun run office']);
    h.office.ingest(ev(LEAD, repo, 'Stop', {}));
    expect(await other).toBeNull();
    expect(h.office.snapshot().questions).toEqual([]);
  });

  test('a question or a plan approval sent to the terminal never becomes a permission card', async () => {
    const repo = watched();
    const ask = ev(LEAD, repo, 'PermissionRequest', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: '¿Sigo?', options: [] }] } });
    expect(await h.office.permission(ask, leadMeta)).toBeNull();
    const plan = ev(LEAD, repo, 'PermissionRequest', { tool_name: 'ExitPlanMode', tool_input: { plan: '1. hacer x' } });
    expect(await h.office.permission(plan, leadMeta)).toBeNull();
    expect(h.office.snapshot().questions).toEqual([]);
  });

  test('nothing is held when nobody watches the panel or the session is not part of the office', async () => {
    h = harness({ holdMs: 60_000 });
    const repo = join(h.root, 'kapper');
    mkdirSync(repo, { recursive: true });
    expect(await h.office.permission(ev('s-1', repo, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } }))).toBeNull();
    h.office.heartbeat(true);
    expect(await h.office.permission(ev('s-1', repo, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } }))).toBeNull();
    expect(h.office.snapshot().questions).toEqual([]);
  });
});

describe('permission modes and clone floors in the launchers', () => {
  test('each session opens with its permission mode and the director can read the floors and documents', () => {
    const { dir, cleanup } = tempDir();
    const p = fakePaths(dir);
    const mobile = makeRepo(dir, 'mobile');
    const docs = join(dir, 'docs');
    mkdirSync(docs, { recursive: true });
    mkdirSync(p.skillsDir, { recursive: true });
    const config = testConfig({
      docsRepo: docs,
      departments: { redaccion: true, mantenimiento: false },
      floors: { mobile: floor(mobile) },
      permissionModes: { direccion: 'manual', mobile: 'plan', redaccion: 'acceptEdits' },
    });
    const specs = sessionSpecs(config, p, '/ws');
    expect(Object.fromEntries(specs.map((s) => [s.name, s.permissionMode]))).toEqual({
      director: 'manual',
      'lead-mobile': 'plan',
      'lead-redaccion': 'acceptEdits',
    });
    const director = specs.find((s) => s.name === 'director')!;
    const dirs = director.extraArgs.flatMap((arg, i) => (arg === '--add-dir' ? [director.extraArgs[i + 1]] : []));
    expect(dirs).toEqual([mobile, docs, p.skillsDir]);
    const script = sessionScript(specs.find((s) => s.name === 'lead-mobile')!, 4747);
    expect(script).toContain("'--permission-mode' 'plan'");
    expect(script).toContain(`'--settings' '{"subagentPromptCacheTtl":"1h"}'`);
    cleanup();
  });

  test('floor leads read the plans folder and may not write it, only while Redacción is active', () => {
    const { dir, cleanup } = tempDir();
    const p = fakePaths(dir);
    const mobile = makeRepo(dir, 'mobile');
    const docs = join(dir, 'docs');
    const plans = join(docs, 'redaccion', 'planes');
    mkdirSync(plans, { recursive: true });
    mkdirSync(p.skillsDir, { recursive: true });
    const config = testConfig({ docsRepo: docs, departments: { redaccion: true, mantenimiento: false }, floors: { mobile: floor(mobile) } });
    const specs = sessionSpecs(config, p, '/ws');
    const lead = specs.find((s) => s.name === 'lead-mobile')!;
    expect(lead.extraArgs.slice(0, 2)).toEqual(['--add-dir', plans]);
    const deny = [`Edit(//${plans.slice(1)}/**)`, `Write(//${plans.slice(1)}/**)`];
    expect(deny[0]).toStartWith('Edit(//');
    expect(lead.settings).toEqual({ subagentPromptCacheTtl: '1h', permissions: { deny } });
    expect(sessionScript(lead, 4747)).toContain(`"permissions":{"deny":["Edit(//${plans.slice(1)}/**)"`);
    const director = specs.find((s) => s.name === 'director')!;
    expect(director.extraArgs.flatMap((arg, i) => (arg === '--add-dir' ? [director.extraArgs[i + 1]] : []))).toEqual([mobile, docs, p.skillsDir]);
    expect(director.settings).toEqual({ subagentPromptCacheTtl: '1h' });
    expect(specs.find((s) => s.name === 'lead-redaccion')!.extraArgs).not.toContain('--add-dir');

    const off = sessionSpecs({ ...config, departments: { redaccion: false, mantenimiento: false } }, p, '/ws').find((s) => s.name === 'lead-mobile')!;
    expect(off.extraArgs).not.toContain('--add-dir');
    expect(off.settings).toEqual({ subagentPromptCacheTtl: '1h' });
    rmSync(plans, { recursive: true });
    expect(sessionSpecs(config, p, '/ws').find((s) => s.name === 'lead-mobile')!.extraArgs).not.toContain('--add-dir');
    cleanup();
  });

  test('only a clone of Agent Office gets the ask rules, and the live copy cannot become a floor', () => {
    const { dir, cleanup } = tempDir();
    const p = fakePaths(dir);
    const clone = makeRepo(dir, 'agent-office-dev', { 'package.json': '{}' });
    mkdirSync(join(clone, '.claude-plugin'), { recursive: true });
    writeFileSync(join(clone, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'agent-office' }));
    const other = makeRepo(dir, 'web', { 'package.json': '{}' });
    expect(isOfficeClone(clone)).toBe(true);
    expect(isOfficeClone(REPO_ROOT)).toBe(false);
    expect(isOfficeClone(other)).toBe(false);
    const rules = clonePermissions();
    expect(rules).toContain('Bash(bun run hub)');
    expect(rules).toContain('Bash(bun run setup *)');
    expect(rules).toContain('Edit(~/.claude/agents/**)');
    const specs = sessionSpecs(testConfig({ floors: { 'agent-office-dev': floor(clone), web: floor(other) } }), p, '/ws');
    const cloneSpec = specs.find((s) => s.name === 'lead-agent-office-dev')!;
    expect(cloneSpec.settings).toEqual({ subagentPromptCacheTtl: '1h', permissions: { ask: rules } });
    expect(sessionScript(cloneSpec, 4747)).toContain('"permissions":{"ask":["Bash(bun run setup)"');
    expect(specs.find((s) => s.name === 'lead-web')!.settings).toEqual({ subagentPromptCacheTtl: '1h' });
    expect(() => planFloor(p, loadProfiles(PROFILES_DIR), REPO_ROOT)).toThrow(FloorError);
    cleanup();
  });

  test('settings show and validate the permission mode of each session', () => {
    const config = testConfig({ floors: { mobile: floor('/m'), old: floor('/o', false) }, departments: { redaccion: true, mantenimiento: false } });
    expect(settingsView(config).permissionModes).toEqual({ direccion: 'auto', redaccion: 'auto', mobile: 'auto' });
    const ok = applySettings(config, { permissionModes: { mobile: 'plan', direccion: 'manual' } });
    if ('error' in ok) throw new Error(ok.error);
    expect(ok.config.permissionModes).toEqual({ mobile: 'plan', direccion: 'manual' });
    const bad = applySettings(config, { permissionModes: { mobile: 'bypassPermissions', nada: 'auto' } });
    expect('error' in bad && bad.error).toContain('Modo de permisos no válido para mobile');
    expect('error' in bad && bad.error).toContain('"nada"');
    expect(normalizeConfig({ permissionModes: { mobile: 'plan', otra: 'turbo', 'Mal Slug': 'auto' } }).permissionModes).toEqual({ mobile: 'plan' });
  });
});
