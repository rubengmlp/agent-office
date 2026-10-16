import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDocsRepo } from '../src/docs-repo';
import { realPath } from '../src/floors';
import { runGit, type GitRunner } from '../src/git';
import { docTypeOf, statusOf, type DocRow } from '../src/documents';
import { Office, type OfficeOptions } from '../src/office';
import { PROFILES_DIR } from '../src/config';
import { loadProfiles } from '../src/profiles';
import type { AgentView, HookMeta } from '../src/types';
import { ev, floor, git, harness, keyOf, originAndClone, pushCommit, useGitIdentity, type Harness } from './helpers';

useGitIdentity();

const LEAD = 'dddddddd-0000-4000-8000-000000000001';
const MANT = 'eeeeeeee-0000-4000-8000-000000000002';
const DEV_LEAD = '22222222-bbbb-4ccc-8ddd-000000000002';
const leadMeta: HookMeta = { socket: null, token: null, role: 'office-lead-redaccion', name: 'lead-redaccion' };
const mantMeta: HookMeta = { socket: null, token: null, role: 'office-lead-mantenimiento', name: 'lead-mantenimiento' };
const PLAN = 'redaccion/planes/login.md';

let h: Harness;
let docs = '';
afterEach(() => h?.cleanup());

const agent = (key: string): AgentView | undefined => h.office.snapshot().agents.find((a) => a.key === key);
const doc = (path: string) => h.office.documents().find((d) => d.path === path);

// The last list of documents the panel received, which is what its desktop notifications compare.
function emittedDoc(path: string) {
  const lists = h.messages.flatMap((msg) => (msg.type === 'documents' ? [msg.data] : []));
  return lists.at(-1)?.find((d) => d.path === path);
}

function office(git?: GitRunner, extra: Partial<OfficeOptions> = {}): void {
  h = harness({
    ...(git ? { git } : {}),
    ...extra,
    configure: (config) => {
      config.departments = { redaccion: true, mantenimiento: true };
      config.review = { maxRounds: 3 };
    },
  });
  docs = realPath(join(h.root, 'docs'));
  ensureDocsRepo(docs);
  h.office.refreshDocuments();
}

function spawn(session: string, cwd: string, name: string, type: string, toolUseId: string): void {
  h.office.ingest(ev(session, cwd, 'PreToolUse', { tool_name: 'Agent', tool_use_id: toolUseId, tool_input: { name, subagent_type: type, prompt: '…' } }));
}

function start(session: string, cwd: string, agentId: string, name: string): string | null {
  return h.office.ingest(ev(session, cwd, 'SubagentStart', { agent_id: agentId, agent_type: name }));
}

function say(session: string, cwd: string, agentId: string | null, name: string | null, to: string, message: string): void {
  const who = agentId ? { agent_id: agentId, agent_type: name ?? undefined } : {};
  h.office.ingest(ev(session, cwd, 'PreToolUse', { ...who, tool_name: 'SendMessage', tool_input: { to, message } }));
}

function gate(session: string, cwd: string, agentId: string | null, name: string | null, message: string) {
  const who = agentId ? { agent_id: agentId, agent_type: name ?? undefined } : {};
  return h.office.gateMessage(ev(session, cwd, 'PreToolUse', { ...who, tool_name: 'SendMessage', tool_input: { to: 'director', message } }));
}

function touch(file: string, msFromClock: number): void {
  const t = (h.clock.now + msFromClock) / 1000;
  utimesSync(file, t, t);
}

function redaccionTeam(): string {
  office();
  const cwd = join(docs, 'redaccion');
  h.office.ingest(ev(LEAD, cwd, 'SessionStart', {}), leadMeta);
  spawn(LEAD, cwd, 'redactor-login', 'office-redactor', 'call-red');
  spawn(LEAD, cwd, 'revisor-planes-login-r1', 'office-revisor-planes', 'call-rev1');
  start(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1');
  start(LEAD, cwd, 'ared-1', 'redactor-login');
  return cwd;
}

describe('roles of the department teammates', () => {
  test('two teammates spawned in parallel get their own type from the spawn call by name', () => {
    redaccionTeam();
    expect(agent(LEAD)).toMatchObject({ role: 'office-lead-redaccion', roleId: 'lead', roleKind: 'lead', floor: 'redaccion' });
    expect(agent('ared-1')).toMatchObject({ role: 'office-redactor', roleId: 'redactor', roleKind: 'writer', name: 'redactor-login' });
    expect(agent('arev-1')).toMatchObject({ role: 'office-revisor-planes', roleKind: 'planReviewer', name: 'revisor-planes-login-r1' });
    expect(h.office.snapshot().floors.find((f) => f.slug === 'redaccion')).toMatchObject({ kind: 'redaccion', building: 'principal' });
    expect(h.office.snapshot().floors.find((f) => f.slug === 'mantenimiento')).toMatchObject({ kind: 'mantenimiento', building: 'mantenimiento' });
  });

  test('without spawn call or team config the name prefix decides', () => {
    office();
    const cwd = join(docs, 'taller');
    h.office.ingest(ev(MANT, cwd, 'SessionStart', {}), mantMeta);
    start(MANT, cwd, 'aart-1', 'artesano-pdf-tools');
    start(MANT, cwd, 'arsk-1', 'revisor-skills-pdf-tools-r1');
    expect(agent('aart-1')).toMatchObject({ role: 'office-artesano', roleKind: 'skillwright', name: 'artesano-pdf-tools', floor: 'mantenimiento' });
    expect(agent('arsk-1')).toMatchObject({ role: 'office-revisor-skills', roleKind: 'skillReviewer' });
  });

  test('the team config wins over a name that looks like another role', () => {
    office();
    const cwd = join(docs, 'redaccion');
    const teamDir = join(h.root, 'claude-home', 'teams', `session-${LEAD.slice(0, 8)}`);
    mkdirSync(teamDir, { recursive: true });
    writeFileSync(join(teamDir, 'config.json'), JSON.stringify({ members: [{ name: 'redactor-x', agentType: 'office-revisor-planes' }] }));
    h.office.ingest(ev(LEAD, cwd, 'SessionStart', {}), leadMeta);
    start(LEAD, cwd, 'ax-1', 'redactor-x');
    expect(agent('ax-1')?.role).toBe('office-revisor-planes');
  });
});

describe('Redacción review loop', () => {
  test('rounds, verdicts, commits per round and the approval gate on HECHO', async () => {
    const cwd = redaccionTeam();
    const file = join(docs, PLAN);
    git(docs, 'add', '.gitignore');
    writeFileSync(join(docs, 'ajeno.txt'), 'staging del usuario');
    git(docs, 'add', 'ajeno.txt');
    writeFileSync(file, '# Login con Apple\n\n## Contexto\nmobile develop @ abc1234\n');
    touch(file, -60_000);
    h.office.refreshDocuments();
    expect(doc(PLAN)).toMatchObject({ kind: 'plan', slug: 'login', title: 'Login con Apple', status: 'borrador', round: 0 });

    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 1`);
    expect(doc(PLAN)).toMatchObject({ status: 'revision', round: 1 });
    await h.office.idle();
    say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'redactor-login', `MEJORAR: ${PLAN} ronda 1 — nota 6/10\n1. bloqueante: falta el paso de migración\n2. menor: estilo`);
    say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'team-lead', `MEJORAR: ${PLAN} ronda 1 — nota 6/10`);
    expect(doc(PLAN)).toMatchObject({ status: 'revision', round: 1, score: 6 });
    expect(h.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM verdicts WHERE kind = 'improve'").get()?.n).toBe(1);

    const early = gate(LEAD, cwd, 'ared-1', 'redactor-login', `HECHO: ${PLAN} aprobado en 1 rondas — nada`);
    expect(early.pass).toBe(false);
    expect(early.reason).toContain('Falta aprobación');

    h.clock.advance(60_000);
    writeFileSync(file, '# Login con Apple\n\n## Contexto\nmobile develop @ abc1234\n\n## Pasos\n1. migración\n');
    touch(file, -1000);
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 2`);
    spawn(LEAD, cwd, 'revisor-planes-login-r2', 'office-revisor-planes', 'call-rev2');
    start(LEAD, cwd, 'arev-2', 'revisor-planes-login-r2');
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `APROBADO: ${PLAN} ronda 2 — nota 10/10 — me apruebo yo`);
    expect(doc(PLAN)?.status).toBe('revision');
    h.clock.advance(1000);
    say(LEAD, cwd, 'arev-2', 'revisor-planes-login-r2', 'redactor-login', `APROBADO: ${PLAN} ronda 2 — nota 9/10 — sin bloqueantes`);
    expect(doc(PLAN)).toMatchObject({ status: 'aprobado', round: 2, score: 9 });
    expect(emittedDoc(PLAN)).toMatchObject({ status: 'aprobado', round: 2 });

    expect(gate(LEAD, cwd, 'ared-1', 'redactor-login', 'HECHO: plan listo').reason).toContain('Falta la ruta');
    expect(gate(LEAD, cwd, 'ared-1', 'redactor-login', `HECHO: ${PLAN} aprobado en 2 rondas — listo`).pass).toBe(true);
    expect(doc(PLAN)?.status).toBe('aprobado');

    await h.office.idle();
    const log = git(docs, 'log', '--format=%s');
    expect(log).toContain('redaccion: login ronda 1');
    expect(log).toContain('redaccion: login ronda 2');
    expect(git(docs, 'show', '--name-only', '--format=', 'HEAD')).toBe(PLAN);
    expect(git(docs, 'diff', '--cached', '--name-only')).toBe('ajeno.txt');

    touch(file, 5000);
    const stale = gate(LEAD, cwd, null, null, `HECHO: ${PLAN} aprobado en 2 rondas — resumen`);
    expect(stale.pass).toBe(false);
    expect(stale.reason).toContain('cambió después');
    touch(file, -500);
    expect(gate(LEAD, cwd, null, null, `HECHO: ${PLAN} aprobado en 2 rondas — resumen`).pass).toBe(true);
    expect(doc(PLAN)).toMatchObject({ status: 'entregado', deliveredAt: h.clock.now, decidedAt: null });
  });

  test('the last round without agreement leaves the plan open as sin acuerdo', () => {
    const cwd = redaccionTeam();
    writeFileSync(join(docs, PLAN), '# Plan\n');
    touch(join(docs, PLAN), -60_000);
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 3`);
    say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'redactor-login', `SIN ACUERDO: ${PLAN} ronda 3 — falta la migración`);
    expect(doc(PLAN)).toMatchObject({ status: 'sin-acuerdo', round: 3 });
    expect(emittedDoc(PLAN)).toMatchObject({ status: 'sin-acuerdo', round: 3 });
    expect(gate(LEAD, cwd, null, null, `HECHO: ${PLAN} aprobado en 3 rondas — x`).pass).toBe(false);
  });

  test('a plan discarded from the panel cannot be discarded twice', async () => {
    const cwd = redaccionTeam();
    writeFileSync(join(docs, PLAN), '# Plan\n');
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 1`);
    await h.office.idle();
    expect(await h.office.discardDocument(PLAN)).toBe('ok');
    expect(doc(PLAN)?.status).toBe('descartado');
    await h.office.idle();
    expect(readFileSync(join(docs, PLAN), 'utf8')).toStartWith('> **Descartado** desde el panel de Agent Office el ');
    expect(git(docs, 'log', '-1', '--format=%s')).toBe('redaccion: login descartado');
    expect(await h.office.discardDocument(PLAN)).toBe('closed');
    expect(await h.office.discardDocument('redaccion/planes/otro.md')).toBe('not-found');
    expect(h.office.documentContent(PLAN)?.markdown).toContain('# Plan\n');
    expect(h.office.documentContent('../../etc/passwd')).toBeNull();
  });
});

describe('plan reviewers', () => {
  const verdictRows = () =>
    h.db.query<{ kind: string; score: number | null; agent_key: string }, []>("SELECT kind, score, agent_key FROM verdicts WHERE kind != 'tests' ORDER BY id").all();
  const summaries = () => h.office.snapshot().activity.map((a) => a.summary);

  test('a reviewer gives one verdict to the author, ignores the copies and leaves for good', () => {
    const cwd = redaccionTeam();
    writeFileSync(join(docs, PLAN), '# Plan\n');
    touch(join(docs, PLAN), -60_000);
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 1`);
    say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'team-lead', `MEJORAR: ${PLAN} ronda 1 — nota 5/10`);
    expect(verdictRows()).toEqual([]);
    expect(agent('arev-1')?.endedAt).toBeNull();

    say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'redactor-login', `MEJORAR: ${PLAN} ronda 1 — nota 6/10\n1. bloqueante: falta la migración`);
    expect(verdictRows()).toEqual([{ kind: 'improve', score: 6, agent_key: 'arev-1' }]);
    expect(agent('arev-1')).toMatchObject({ state: 'done', detail: { key: 'hub.detail.verdictImprove' }, endedAt: h.clock.now });

    say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'team-lead', `MEJORAR: ${PLAN} ronda 1 — nota 6/10`);
    h.office.ingest(ev(LEAD, cwd, 'SubagentStop', { agent_id: 'arev-1', agent_type: 'revisor-planes-login-r1' }));
    expect(verdictRows()).toHaveLength(1);
    expect(summaries().filter((s) => keyOf(s) === 'hub.act.verdictIgnored')).toEqual([]);

    h.clock.advance(1000);
    say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'redactor-login', `APROBADO: ${PLAN} ronda 1 — nota 9/10 — al final sí`);
    expect(verdictRows()).toHaveLength(1);
    expect(doc(PLAN)).toMatchObject({ status: 'revision', score: 6 });
    expect(summaries()).toContainEqual({ key: 'hub.act.verdictIgnored', params: { who: 'revisor-planes-login-r1', path: PLAN } });
    expect(summaries().filter((s) => keyOf(s) === 'hub.act.retiredIgnored')).toEqual([{ key: 'hub.act.retiredIgnored', params: { who: 'revisor-planes-login-r1' } }]);
    expect(agent('arev-1')).toMatchObject({ state: 'done', detail: { key: 'hub.detail.verdictImprove' } });

    h.clock.advance(11 * 60_000);
    h.office.tick();
    expect(agent('arev-1')).toBeUndefined();
    h.office.ingest(ev(LEAD, cwd, 'PreToolUse', { agent_id: 'arev-1', agent_type: 'revisor-planes-login-r1', tool_name: 'Read', tool_input: { file_path: join(docs, PLAN) } }));
    expect(agent('arev-1')?.state).toBe('done');
    expect(agent('arev-1')?.endedAt).not.toBeNull();
  });

  test('a reviewer with the same name and a new id after a discard is not retired and owns TeammateIdle by name', async () => {
    const cwd = redaccionTeam();
    writeFileSync(join(docs, PLAN), '# Plan\n');
    say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'redactor-login', `MEJORAR: ${PLAN} ronda 1 — nota 4/10`);
    expect(agent('arev-1')?.endedAt).not.toBeNull();
    await h.office.idle();
    expect(await h.office.discardDocument(PLAN)).toBe('ok');
    await h.office.idle();
    const team = `session-${LEAD.slice(0, 8)}`;
    h.office.ingest(ev(LEAD, cwd, 'TeammateIdle', { teammate_name: 'revisor-planes-login-r1', team_name: team }));
    expect(h.office.snapshot().agents.some((a) => a.key.includes('@'))).toBe(false);

    spawn(LEAD, cwd, 'revisor-planes-login-r1', 'office-revisor-planes', 'call-rev-new');
    start(LEAD, cwd, 'arev-9', 'revisor-planes-login-r1');
    expect(agent('arev-9')).toMatchObject({ roleKind: 'planReviewer', endedAt: null, state: 'working' });
    h.office.ingest(ev(LEAD, cwd, 'TeammateIdle', { teammate_name: 'revisor-planes-login-r1', team_name: team }));
    expect(agent('arev-9')).toMatchObject({ state: 'idle', endedAt: null });
    expect(agent('arev-1')).toMatchObject({ state: 'done', detail: { key: 'hub.detail.verdictImprove' } });
    expect(h.office.snapshot().agents.some((a) => a.key.includes('@'))).toBe(false);
  });

  test('the plan reviewer starts cold and leaves no memory, the skill reviewer keeps it', () => {
    office();
    const cwd = join(docs, 'redaccion');
    h.office.addLesson({ floor: 'redaccion', role: 'revisor-planes', text: 'Mira siempre las migraciones' });
    h.office.addLesson({ floor: 'redaccion', role: 'redactor', text: 'Cita la regla de layering' });
    h.office.ingest(ev(LEAD, cwd, 'SessionStart', {}), leadMeta);
    spawn(LEAD, cwd, 'revisor-planes-login-r1', 'office-revisor-planes', 'call-rev1');
    expect(start(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1')).toBeNull();
    spawn(LEAD, cwd, 'redactor-login', 'office-redactor', 'call-red');
    expect(start(LEAD, cwd, 'ared-1', 'redactor-login')).toContain('Cita la regla de layering');
    say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'team-lead', 'LECCIÓN: los planes de mobile olvidan el backfill');
    expect(h.office.memoryView('redaccion', 'revisor-planes').lessons.map((l) => l.text)).toEqual(['Mira siempre las migraciones']);
    expect(h.office.snapshot().activity.map((a) => a.summary)).toContainEqual({ key: 'hub.act.lessonIgnoredReviewer' });
    expect(h.office.snapshot().activity.some((a) => a.agentKey === 'arev-1' && keyOf(a.summary) === 'hub.act.memoryDelivered')).toBe(false);
    h.office.ingest(ev(LEAD, cwd, 'SubagentStop', { agent_id: 'arev-1', agent_type: 'revisor-planes-login-r1' }));
    h.office.ingest(ev(LEAD, cwd, 'SessionEnd', { reason: 'exit' }));
    expect(h.db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM reports WHERE agent_key = ?').get('arev-1')?.n).toBe(0);
    expect(h.db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM reports WHERE agent_key = ?').get('ared-1')?.n).toBe(1);

    const taller = join(docs, 'taller');
    h.office.addLesson({ floor: 'mantenimiento', role: 'revisor-skills', text: 'Lee siempre los scripts' });
    h.office.ingest(ev(MANT, taller, 'SessionStart', {}), mantMeta);
    expect(start(MANT, taller, 'arsk-1', 'revisor-skills-pdf-r1')).toContain('Lee siempre los scripts');
  });

  test('the round history lives outside the plan, is committed with its round and is never a plan', async () => {
    const cwd = redaccionTeam();
    writeFileSync(join(docs, PLAN), '# Plan\n');
    mkdirSync(join(docs, 'redaccion', 'historial'), { recursive: true });
    writeFileSync(join(docs, 'redaccion', 'historial', 'login.md'), '# Historial\n\n## Ronda 1\n');
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 1`);
    await h.office.idle();
    expect(git(docs, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['redaccion/historial/login.md', PLAN]);
    expect(git(docs, 'log', '-1', '--format=%s')).toBe('redaccion: login ronda 1');
    expect(h.office.documents().map((d) => d.path)).toEqual([PLAN]);
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', 'REVISAR: redaccion/historial/login.md ronda 2');
    expect(doc(PLAN)?.round).toBe(1);
  });
});

describe('Redacción sources through the hub', () => {
  test('the fetch after an approval runs in the background, HECHO retires the sources and BLOQUEADO keeps them', async () => {
    let armed = false;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    office(async (cwd, args, timeout) => {
      if (armed && args[0] === 'fetch') await held;
      return runGit(cwd, args, timeout);
    });
    const mobile = originAndClone(h.root, 'mobile');
    h.config.floors.mobile = floor(mobile.repo);
    const cwd = join(docs, 'redaccion');
    h.office.ingest(ev(LEAD, cwd, 'SessionStart', {}), leadMeta);
    spawn(LEAD, cwd, 'redactor-login', 'office-redactor', 'c1');
    start(LEAD, cwd, 'ared-1', 'redactor-login');
    spawn(LEAD, cwd, 'revisor-planes-login-r1', 'office-revisor-planes', 'c2');
    start(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1');
    const synced = await h.office.syncSources({ slug: 'login', floors: ['mobile'] });
    expect(synced.ok).toBe(true);
    const sources = join(docs, 'redaccion', '.fuentes', 'login', 'mobile');
    expect(existsSync(join(sources, 'README.md'))).toBe(true);
    writeFileSync(join(docs, PLAN), '# Login\n');
    touch(join(docs, PLAN), -60_000);
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 1`);
    await h.office.idle();
    expect(doc(PLAN)?.base).toEqual([{ floor: 'mobile', ref: 'develop', sha: expect.any(String), date: expect.any(String), stale: false }]);

    armed = true;
    pushCommit(mobile.seed, mobile.origin, 'nuevo.dart', 'x', 'feat: nuevo');
    say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'redactor-login', `APROBADO: ${PLAN} ronda 1 — nota 9/10 — ok`);
    expect(doc(PLAN)?.status).toBe('aprobado');
    let settled = false;
    const idle = h.office.idle().then(() => {
      settled = true;
    });
    await Bun.sleep(50);
    expect(settled).toBe(false);
    release();
    await idle;
    expect(doc(PLAN)?.ahead).toEqual([{ floor: 'mobile', commits: 1, files: ['nuevo.dart'] }]);

    say(LEAD, cwd, null, null, 'director', `BLOQUEADO: ${PLAN} sin acuerdo — necesito decisión`);
    await h.office.idle();
    expect(existsSync(sources)).toBe(true);
    expect(gate(LEAD, cwd, null, null, `HECHO: ${PLAN} aprobado en 1 rondas — resumen`).pass).toBe(true);
    await h.office.idle();
    expect(existsSync(sources)).toBe(false);
    expect(git(mobile.repo, 'worktree', 'list', '--porcelain')).not.toContain('.fuentes');
    expect(doc(PLAN)?.status).toBe('entregado');
    expect(doc(PLAN)?.base).toEqual([{ floor: 'mobile', ref: 'develop', sha: expect.any(String), date: expect.any(String), stale: false }]);
    expect(h.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM sync_worktrees').get()?.n).toBe(0);
  });
});

describe('delivered plans', () => {
  const DIRECTOR = 'ffffffff-0000-4000-8000-000000000003';
  const sent: { socket: string; payload: string }[] = [];

  async function deliveredPlan(): Promise<string> {
    sent.length = 0;
    office(undefined, {
      deliverFn: async (socket, payload) => {
        sent.push({ socket, payload });
      },
    });
    const mobile = originAndClone(h.root, 'mobile');
    h.config.floors.mobile = floor(mobile.repo);
    const cwd = join(docs, 'redaccion');
    h.office.ingest(ev(LEAD, cwd, 'SessionStart', {}), leadMeta);
    spawn(LEAD, cwd, 'redactor-login', 'office-redactor', 'c1');
    start(LEAD, cwd, 'ared-1', 'redactor-login');
    spawn(LEAD, cwd, 'revisor-planes-login-r1', 'office-revisor-planes', 'c2');
    start(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1');
    expect((await h.office.syncSources({ slug: 'login', floors: ['mobile'] })).ok).toBe(true);
    writeFileSync(join(docs, PLAN), '# Login con Apple\n\n## Pasos\n1. migración\n');
    touch(join(docs, PLAN), -60_000);
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `REVISAR: ${PLAN} ronda 1`);
    say(LEAD, cwd, 'arev-1', 'revisor-planes-login-r1', 'redactor-login', `APROBADO: ${PLAN} ronda 1 — nota 9/10 — listo`);
    say(LEAD, cwd, null, null, 'lead-mobile', `PLAN: ${PLAN} — login con Apple en mobile — léelo y espera la orden del director`);
    expect(gate(LEAD, cwd, null, null, `HECHO: ${PLAN} aprobado en 1 rondas — resumen`).pass).toBe(true);
    await h.office.idle();
    return cwd;
  }

  function director(socket: string | null): void {
    if (socket) writeFileSync(socket, '');
    h.office.ingest(ev(DIRECTOR, h.workspace, 'SessionStart', {}), { socket, token: 'tok', role: 'office-director', name: 'director' });
  }

  test('statusOf: discarded, closed, executing, parked and delivered win over the verdicts in that order', () => {
    const row = (over: Partial<DocRow>): DocRow => ({
      path: PLAN,
      round: 1,
      requested_at: 1,
      closed_at: null,
      discarded_at: null,
      delivered_at: null,
      decision: null,
      decided_at: null,
      delivered_base: null,
      ...over,
    });
    const approved = { kind: 'approved', ts: 10, round: 1, score: 9 };
    expect(statusOf(row({ discarded_at: 5, closed_at: 5, decision: 'ejecutar', delivered_at: 5 }), approved, 1)).toBe('descartado');
    expect(statusOf(row({ closed_at: 5, decision: 'ejecutar', delivered_at: 5 }), approved, 1)).toBe('cerrado');
    expect(statusOf(row({ decision: 'ejecutar', delivered_at: 5 }), approved, 1)).toBe('ejecutando');
    expect(statusOf(row({ decision: 'aparcar', delivered_at: 5 }), approved, 1)).toBe('aparcado');
    expect(statusOf(row({ delivered_at: 5 }), approved, 100)).toBe('entregado');
    expect(statusOf(row({}), approved, 1)).toBe('aprobado');
    expect(statusOf(row({}), approved, 100)).toBe('revision');
  });

  test('the lead HECHO delivers, keeps the floors and the panel parks, executes through the director and closes', async () => {
    await deliveredPlan();
    expect(h.office.snapshot().activity.map((a) => a.summary)).toContainEqual({ key: 'hub.act.planNotice', params: { to: 'lead-mobile', path: PLAN } });
    expect(doc(PLAN)).toMatchObject({ status: 'entregado', base: [{ floor: 'mobile', ref: 'develop' }] });
    expect(existsSync(join(docs, 'redaccion', '.fuentes', 'login'))).toBe(false);

    expect(await h.office.decidePlan(PLAN, 'cerrar')).toBe('invalid-state');
    expect(await h.office.decidePlan('redaccion/planes/otro.md', 'aparcar')).toBe('not-found');
    expect(await h.office.decidePlan(PLAN, 'aparcar')).toBe('ok');
    expect(doc(PLAN)).toMatchObject({ status: 'aparcado', decidedAt: h.clock.now });
    expect(await h.office.decidePlan(PLAN, 'aparcar')).toBe('invalid-state');

    expect(await h.office.decidePlan(PLAN, 'ejecutar')).toBe('no-director');
    director(join(h.root, 'sin-socket.sock'));
    h.office.tick();
    director(null);
    expect(doc(PLAN)?.status).toBe('aparcado');
    const socket = join(h.root, 'director.sock');
    director(socket);
    expect(await h.office.decidePlan(PLAN, 'ejecutar')).toBe('ok');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.socket).toBe(socket);
    expect(sent[0]?.payload).toContain('[Agent Office] Orden del usuario');
    expect(sent[0]?.payload).toContain('Ejecuta el plan redaccion/planes/login.md');
    expect(sent[0]?.payload).toContain('Login con Apple');
    expect(sent[0]?.payload).toContain('Plantas: mobile.');
    expect(sent[0]?.payload).toContain('lead-mobile');
    expect(sent[0]?.payload).toContain(`${docs}/${PLAN}`);
    expect(doc(PLAN)?.status).toBe('ejecutando');
    expect(h.office.snapshot().activity.map((a) => a.summary)).toContainEqual({ key: 'hub.act.planExecuting', params: { path: PLAN } });

    expect(await h.office.discardDocument(PLAN)).toBe('closed');
    expect(await h.office.decidePlan(PLAN, 'aparcar')).toBe('ok');
    expect(doc(PLAN)?.status).toBe('aparcado');
    expect(await h.office.decidePlan(PLAN, 'ejecutar')).toBe('ok');
    expect(sent).toHaveLength(2);
    expect(await h.office.decidePlan(PLAN, 'cerrar')).toBe('ok');
    expect(doc(PLAN)).toMatchObject({ status: 'cerrado', base: [{ floor: 'mobile' }] });
    expect(await h.office.decidePlan(PLAN, 'ejecutar')).toBe('invalid-state');
    expect(await h.office.discardDocument(PLAN)).toBe('closed');
  });

  test('the document type comes from the line after the title: accents, case and English accepted, implementation by default', () => {
    const type = (text: string, kind: 'plan' | 'skill' = 'plan') => docTypeOf(kind, text);
    expect(type('# T\n> Tipo: análisis\n')).toBe('analisis');
    expect(type('# T\n\n> tipo: ANALISIS\n')).toBe('analisis');
    expect(type('# T\r\n> Type: Analysis\r\n')).toBe('analisis');
    expect(type('# T\n> Tipo: implementación\n')).toBe('implementacion');
    expect(type('# T\n> Type: implementation\n')).toBe('implementacion');
    expect(type('# T\n\n## Contexto\n> Tipo: análisis\n')).toBe('implementacion');
    expect(type('# T\n> Tipo: otra cosa\n')).toBe('implementacion');
    expect(type('# T\n')).toBe('implementacion');
    expect(docTypeOf('plan', null)).toBe('implementacion');
    expect(type('# T\n> Tipo: análisis\n', 'skill')).toBe('implementacion');
  });

  test('a delivered analysis goes to the director as an order to ask the user first, an implementation plan keeps the old order', async () => {
    await deliveredPlan();
    expect(doc(PLAN)?.docType).toBe('implementacion');
    writeFileSync(join(docs, PLAN), '# Auditoría de login\n> Tipo: análisis\n\n## Pasos\n1. encargar plan de migración\n');
    h.office.refreshDocuments();
    expect(doc(PLAN)).toMatchObject({ docType: 'analisis', title: 'Auditoría de login', status: 'entregado' });

    director(join(h.root, 'director.sock'));
    expect(await h.office.decidePlan(PLAN, 'ejecutar')).toBe('ok');
    expect(sent).toHaveLength(1);
    const payload = sent[0]?.payload ?? '';
    expect(payload).toContain(`Analiza el documento \`${PLAN}\` («Auditoría de login») que te ha entregado Redacción.`);
    expect(payload).toContain(`Léelo en \`${docs}/${PLAN}\``);
    expect(payload).toContain('pregúntame con AskUserQuestion qué planes de implementación quieres que encargue a Redacción y en qué orden');
    expect(payload).not.toContain('Ejecuta el plan');
    expect(doc(PLAN)?.status).toBe('ejecutando');
    expect(h.office.snapshot().activity.map((a) => a.summary)).toContainEqual({ key: 'hub.act.planAnalysisSent', params: { path: PLAN } });
  });

  test('an unreachable director leaves the plan as it was, and a delivered plan can be discarded', async () => {
    await deliveredPlan();
    const socket = join(h.root, 'director.sock');
    director(socket);
    rmSync(socket);
    expect(await h.office.decidePlan(PLAN, 'ejecutar')).toBe('unreachable');
    expect(sent).toEqual([]);
    expect(doc(PLAN)?.status).toBe('entregado');
    expect(await h.office.discardDocument(PLAN)).toBe('ok');
    expect(doc(PLAN)?.status).toBe('descartado');
  });

  test('a restart reads the floors of a delivered plan from the database and keeps its sources removed', async () => {
    await deliveredPlan();
    const restarted = new Office({
      db: h.db,
      config: h.config,
      profiles: loadProfiles(PROFILES_DIR),
      workspaceDir: h.workspace,
      claudeHome: join(h.root, 'claude-home'),
      gitRoot: (cwd) => cwd,
      now: () => h.clock.now,
    });
    expect(restarted.documents().find((d) => d.path === PLAN)).toMatchObject({ status: 'entregado', base: [{ floor: 'mobile', ref: 'develop' }] });
  });
});

describe('questions through the lead', () => {
  function writerTeam(): string {
    const cwd = redaccionTeam();
    h.office.ingest(
      ev(LEAD, cwd, 'PostToolUse', {
        tool_name: 'Agent',
        tool_use_id: 'call-red',
        tool_input: { name: 'redactor-login', subagent_type: 'office-redactor' },
        tool_response: { status: 'teammate_spawned', agentId: 'ared-1' },
      }),
    );
    return cwd;
  }

  test('PREGUNTA keeps the writer asking until the lead answers, and turns into blocked when nobody does', () => {
    const cwd = writerTeam();
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', 'PREGUNTA: ¿Apple antes que Google? — opciones: Apple | Google');
    expect(agent('ared-1')).toMatchObject({ state: 'asking', detail: { key: 'hub.detail.asks', params: { question: '¿Apple antes que Google?' } } });
    h.office.ingest(ev(LEAD, cwd, 'PostToolUse', { agent_id: 'ared-1', agent_type: 'redactor-login', tool_name: 'SendMessage', tool_input: { to: 'team-lead', message: 'PREGUNTA: x' } }));
    h.office.ingest(ev(LEAD, cwd, 'SubagentStop', { agent_id: 'ared-1', agent_type: 'redactor-login', last_assistant_message: 'Espero respuesta' }));
    h.office.ingest(ev(LEAD, cwd, 'TeammateIdle', { agent_id: 'ared-1', teammate_name: 'redactor-login' }));
    expect(agent('ared-1')).toMatchObject({ state: 'asking', detail: { key: 'hub.detail.asks', params: { question: '¿Apple antes que Google?' } }, endedAt: null });

    h.clock.advance(h.config.blockedAfterMinutes * 60_000 + 1000);
    expect(agent('ared-1')).toMatchObject({ state: 'blocked', detail: { key: 'hub.detail.noAnswer', params: { detail: { key: 'hub.detail.asks', params: { question: '¿Apple antes que Google?' } } } } });

    say(LEAD, cwd, null, null, 'redactor-login', 'El usuario dice: Apple primero');
    expect(agent('ared-1')).toMatchObject({ state: 'working', detail: { key: 'hub.detail.answerReceived' } });
    h.office.ingest(ev(LEAD, cwd, 'SubagentStop', { agent_id: 'ared-1', agent_type: 'redactor-login' }));
    expect(agent('ared-1')).toMatchObject({ state: 'idle', detail: { key: 'hub.detail.waiting' } });
  });

  test('the next tool call of the writer also ends the wait', () => {
    const cwd = writerTeam();
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', 'PREGUNTA: ¿Incluyo el registro? — opciones: sí | no');
    h.office.ingest(ev(LEAD, cwd, 'PreToolUse', { agent_id: 'ared-1', agent_type: 'redactor-login', tool_name: 'Read', tool_input: { file_path: join(docs, PLAN) } }));
    expect(agent('ared-1')?.state).toBe('reading');
    h.office.ingest(ev(LEAD, cwd, 'PostToolUse', { agent_id: 'ared-1', agent_type: 'redactor-login', tool_name: 'Read', tool_input: { file_path: join(docs, PLAN) } }));
    h.office.ingest(ev(LEAD, cwd, 'SubagentStop', { agent_id: 'ared-1', agent_type: 'redactor-login' }));
    expect(agent('ared-1')?.state).toBe('idle');
  });
});

describe('hub restarts', () => {
  test('a restart keeps the sources of a plan in progress and removes those of a finished plan', async () => {
    office();
    const mobile = originAndClone(h.root, 'mobile');
    h.config.floors.mobile = floor(mobile.repo);
    expect((await h.office.syncSources({ slug: 'en-curso', floors: ['mobile'] })).ok).toBe(true);
    expect((await h.office.syncSources({ slug: 'cerrado', floors: ['mobile'] })).ok).toBe(true);
    writeFileSync(join(docs, 'redaccion', 'planes', 'cerrado.md'), '# Cerrado\n');
    h.office.refreshDocuments();
    expect(await h.office.discardDocument('redaccion/planes/cerrado.md')).toBe('ok');
    const restarted = new Office({
      db: h.db,
      config: h.config,
      profiles: loadProfiles(PROFILES_DIR),
      workspaceDir: h.workspace,
      claudeHome: join(h.root, 'claude-home'),
      gitRoot: (cwd) => cwd,
      now: () => h.clock.now,
    });
    restarted.start();
    await restarted.idle();
    restarted.stop();
    expect(existsSync(join(docs, 'redaccion', '.fuentes', 'en-curso', 'mobile', 'README.md'))).toBe(true);
    expect(existsSync(join(docs, 'redaccion', '.fuentes', 'cerrado'))).toBe(false);
  });
});

describe('Mantenimiento skills', () => {
  test('a skill counts as changed when any of its files changes, evals and workspaces aside', () => {
    office();
    const cwd = join(docs, 'taller');
    const skill = join(docs, 'taller', 'skills', 'pdf-tools');
    mkdirSync(join(skill, 'scripts'), { recursive: true });
    mkdirSync(join(skill, 'evals'), { recursive: true });
    mkdirSync(join(docs, 'taller', 'skills', 'pdf-tools-workspace'), { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: pdf-tools\ndescription: x\n---\n');
    writeFileSync(join(skill, 'scripts', 'run.sh'), 'echo hola\n');
    writeFileSync(join(skill, 'evals', 'evals.json'), '{}');
    writeFileSync(join(docs, 'taller', 'skills', 'pdf-tools-workspace', 'notes.md'), 'x');
    for (const f of [join(skill, 'SKILL.md'), join(skill, 'scripts', 'run.sh'), join(skill, 'evals', 'evals.json')]) touch(f, -60_000);
    h.office.ingest(ev(MANT, cwd, 'SessionStart', {}), mantMeta);
    start(MANT, cwd, 'aart-1', 'artesano-pdf-tools');
    start(MANT, cwd, 'arsk-1', 'revisor-skills-pdf-tools-r1');
    say(MANT, cwd, 'aart-1', 'artesano-pdf-tools', 'team-lead', 'REVISAR: taller/skills/pdf-tools/SKILL.md ronda 1');
    say(MANT, cwd, 'arsk-1', 'revisor-skills-pdf-tools-r1', 'artesano-pdf-tools', 'APROBADO: taller/skills/pdf-tools ronda 1 — nota 8/10 — ok');
    expect(h.office.documents().map((d) => d.path)).toEqual(['taller/skills/pdf-tools']);
    expect(h.office.documents()[0]).toMatchObject({ kind: 'skill', title: 'pdf-tools', status: 'aprobado', installedAt: [] });
    const done = `HECHO: taller/skills/pdf-tools aprobado en 1 rondas — instalada`;
    expect(gate(MANT, cwd, null, null, done).pass).toBe(true);

    touch(join(skill, 'evals', 'evals.json'), 30_000);
    expect(gate(MANT, cwd, 'aart-1', 'artesano-pdf-tools', done).pass).toBe(true);
    touch(join(skill, 'scripts', 'run.sh'), 30_000);
    expect(gate(MANT, cwd, 'aart-1', 'artesano-pdf-tools', done).reason).toContain('cambió después');
  });

  test('installed skills show where they live', () => {
    office();
    const skill = join(docs, 'taller', 'skills', 'pdf-tools');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: pdf-tools\n---\n');
    const repo = join(h.root, 'mobile');
    mkdirSync(join(repo, '.claude', 'skills', 'pdf-tools'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'skills', 'pdf-tools', 'SKILL.md'), 'x');
    h.config.floors.mobile = floor(repo);
    mkdirSync(join(h.root, 'claude-home', 'skills', 'pdf-tools'), { recursive: true });
    writeFileSync(join(h.root, 'claude-home', 'skills', 'pdf-tools', 'SKILL.md'), 'x');
    h.office.refreshDocuments();
    expect(h.office.documents()[0]?.installedAt).toEqual(['~/.claude/skills', 'mobile: .claude/skills']);
  });
});

describe('guard alerts', () => {
  test('a skill installed in a floor while another department agent works raises no alert', async () => {
    office();
    const repo = realPath(join(h.root, 'sandbox'));
    mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'a.ts'), 'a');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'inicio');
    h.config.floors.sandbox = floor(repo, true, 'node');
    const cwd = join(docs, 'redaccion');
    h.office.ingest(ev(LEAD, cwd, 'SessionStart', {}), leadMeta);
    spawn(LEAD, cwd, 'redactor-login', 'office-redactor', 'c1');
    start(LEAD, cwd, 'ared-1', 'redactor-login');
    await h.office.idle();
    mkdirSync(join(repo, '.claude', 'skills', 'pdf'), { recursive: true });
    writeFileSync(join(repo, '.claude', 'skills', 'pdf', 'SKILL.md'), '---\nname: pdf\n---\n');
    h.office.ingest(ev(LEAD, cwd, 'SubagentStop', { agent_id: 'ared-1', agent_type: 'redactor-login' }));
    await h.office.idle();
    expect(h.office.snapshot().alerts).toEqual([]);

    h.office.ingest(ev(LEAD, cwd, 'PreToolUse', { agent_id: 'ared-1', agent_type: 'redactor-login', tool_name: 'Read', tool_input: { file_path: join(docs, PLAN) } }));
    await h.office.idle();
    writeFileSync(join(repo, 'a.ts'), 'un cambio que nadie de la planta hizo con Edit');
    h.office.ingest(ev(LEAD, cwd, 'SubagentStop', { agent_id: 'ared-1', agent_type: 'redactor-login' }));
    await h.office.idle();
    expect(h.office.snapshot().alerts.map((a) => [a.level, a.floor, a.files])).toEqual([['alerta', 'sandbox', [join(repo, 'a.ts')]]]);
    expect(h.messages).toContainEqual({
      type: 'alert',
      data: expect.objectContaining({ level: 'alerta', floor: 'sandbox', agentKey: 'ared-1', files: [join(repo, 'a.ts')] }),
    });
  });
});

describe('department floors have no tests', () => {
  test('a command that mentions "test" in a department is not a test run', () => {
    const cwd = redaccionTeam();
    h.office.ingest(ev(LEAD, cwd, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'office-sync.sh flow-test-otp mobile' } }));
    h.office.ingest(ev(LEAD, cwd, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'office-sync.sh flow-test-otp mobile' } }));
    expect(agent(LEAD)?.lastTest).toBeNull();
    expect(agent(LEAD)?.state).not.toBe('testing');
    expect(h.db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM verdicts WHERE kind = 'tests'").get()?.n).toBe(0);
    expect(h.office.report('ared-1')?.summary).toBe('Todavía sin ficheros, tests ni mensajes');
    expect(h.office.report('ared-1')?.summaryText).toEqual({ key: 'hub.report.empty' });
  });

  test('a document over MAX_CONTENT_BYTES answers with a notice', () => {
    redaccionTeam();
    writeFileSync(join(docs, PLAN), 'x'.repeat(1_000_001));
    h.office.refreshDocuments();
    expect(h.office.documentContent(PLAN)).toEqual({ path: PLAN, kind: 'plan', markdown: '', notice: { key: 'hub.doc.tooLarge' } });
  });
});

describe('guard through the hub', () => {
  test('department writes outside their folder are blocked and other floors are left alone', () => {
    const cwd = redaccionTeam();
    const repo = join(h.root, 'mobile');
    mkdirSync(repo, { recursive: true });
    h.config.floors.mobile = floor(repo);
    const write = (session: string, at: string, agentId: string | null, name: string | null, file: string) =>
      h.office.guard(
        ev(session, at, 'PreToolUse', {
          ...(agentId ? { agent_id: agentId, agent_type: name ?? undefined } : {}),
          tool_name: 'Write',
          tool_input: { file_path: file, content: 'x' },
        }),
      );
    expect(write(LEAD, cwd, 'ared-1', 'redactor-login', join(docs, PLAN)).pass).toBe(true);
    expect(write(LEAD, cwd, 'ared-1', 'redactor-login', join(docs, 'redaccion', '.fuentes', 'login', 'mobile', 'a.dart')).pass).toBe(false);
    const blocked = write(LEAD, cwd, null, null, join(repo, 'lib', 'main.dart'));
    expect(blocked.pass).toBe(false);
    expect(h.office.snapshot().activity.at(-1)?.summary).toMatchObject({ key: 'hub.act.guardBlocked' });
    h.office.ingest(ev(DEV_LEAD, repo, 'SessionStart', {}), { socket: null, token: null, role: 'office-lead-mobile', name: 'lead-mobile' });
    expect(write(DEV_LEAD, repo, null, null, join(docs, PLAN)).pass).toBe(true);
    const mantCwd = join(docs, 'taller');
    h.office.ingest(ev(MANT, mantCwd, 'SessionStart', {}), mantMeta);
    expect(write(MANT, mantCwd, null, null, join(h.root, 'claude-home', 'skills', 'pdf', 'SKILL.md')).pass).toBe(true);
    start(MANT, mantCwd, 'aart-1', 'artesano-pdf');
    expect(write(MANT, mantCwd, 'aart-1', 'artesano-pdf', join(h.root, 'claude-home', 'skills', 'pdf', 'SKILL.md')).pass).toBe(false);
  });
});

describe('memory through the hub', () => {
  test('a lesson sent to the lead is stored once and handed to the next agent of that post', () => {
    const cwd = redaccionTeam();
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', 'LECCIÓN: Los planes de mobile tienen que citar la regla de layering');
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', 'lección: los planes de mobile tienen que citar la regla de layering.');
    expect(h.office.memoryView('redaccion', 'redactor').lessons.map((l) => l.text)).toEqual([
      'Los planes de mobile tienen que citar la regla de layering',
    ]);
    expect(h.messages.some((m) => m.type === 'memory' && m.floor === 'redaccion' && m.role === 'redactor')).toBe(true);

    h.office.ingest(ev(LEAD, cwd, 'SubagentStop', { agent_id: 'arev-1', agent_type: 'revisor-planes-login-r1', last_assistant_message: 'Veredicto enviado' }));
    spawn(LEAD, cwd, 'redactor-otro', 'office-redactor', 'call-red-2');
    const out = start(LEAD, cwd, 'ared-2', 'redactor-otro');
    const context = JSON.parse(out ?? '{}').hookSpecificOutput;
    expect(context.hookEventName).toBe('SubagentStart');
    expect(context.additionalContext).toContain('puesto redactor en Redacción');
    expect(context.additionalContext).toContain('citar la regla de layering');

    const leadOut = h.office.ingest(ev(LEAD, cwd, 'SessionStart', { source: 'resume' }), leadMeta);
    expect(leadOut).toBeNull();
    const user = h.office.addLesson({ floor: 'redaccion', role: 'lead', text: 'Pide siempre la rama base' });
    expect(user.ok).toBe(true);
    const again = JSON.parse(h.office.ingest(ev(LEAD, cwd, 'SessionStart', { source: 'resume' }), leadMeta) ?? '{}');
    expect(again.hookSpecificOutput).toMatchObject({ hookEventName: 'SessionStart' });
    expect(again.hookSpecificOutput.additionalContext).toContain('Pide siempre la rama base');
    expect(h.office.addLesson({ floor: 'redaccion', role: 'lead', text: 'pide siempre la rama base' })).toMatchObject({ ok: false, status: 409 });
    expect(h.office.addLesson({ floor: 'redaccion', role: 'nadie', text: 'x' })).toMatchObject({ ok: false, status: 400 });
  });

  test('an agent on an observed floor gets no memory and its lessons are not captured', () => {
    office();
    const repo = join(h.root, 'kapper');
    mkdirSync(repo, { recursive: true });
    h.office.ingest(ev('obs-1', repo, 'SessionStart', {}), { socket: null, token: null, role: 'office-lead-kapper', name: 'x' });
    say('obs-1', repo, null, null, 'x', 'LECCIÓN: algo privado');
    expect(h.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM lessons').get()?.n).toBe(0);
  });

  test('the report of an agent is live while it works and saved when it stops', () => {
    const cwd = redaccionTeam();
    say(LEAD, cwd, 'ared-1', 'redactor-login', 'team-lead', `HECHO: ${PLAN} aprobado en 1 rondas — resumen corto`);
    const live = h.office.report('ared-1');
    expect(live).toMatchObject({ agentKey: 'ared-1', name: 'redactor-login', roleId: 'redactor', live: true });
    expect(live?.summary).toContain('HECHO:');
    h.office.ingest(ev(LEAD, cwd, 'SubagentStop', { agent_id: 'ared-1', agent_type: 'redactor-login', last_assistant_message: 'Plan entregado' }));
    const saved = h.office.memoryView('redaccion', 'redactor').reports;
    expect(saved.map((r) => r.agentKey)).toContain('ared-1');
    expect(h.office.report('nadie')).toBeNull();
  });
});
