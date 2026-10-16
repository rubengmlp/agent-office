import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES_DIR } from '../src/config';
import { realPath } from '../src/floors';
import { Office } from '../src/office';
import { loadProfiles } from '../src/profiles';
import type { AgentView, HookMeta } from '../src/types';
import { ev, floor, harness, loadFixture, type Harness } from './helpers';

const LEAD = '22222222-bbbb-4ccc-8ddd-000000000002';
const TEAM = 'session-22222222';
const leadMeta: HookMeta = { socket: null, token: null, role: 'office-lead-mobile', name: 'lead-mobile' };

let h: Harness;
afterEach(() => h?.cleanup());

const agent = (key: string): AgentView | undefined => h.office.snapshot().agents.find((a) => a.key === key);

function managedRepo(name = 'mobile'): string {
  const repo = join(h.root, name);
  mkdirSync(repo, { recursive: true });
  h.config.floors[name] = floor(repo);
  return repo;
}

function observedRepo(name = 'kapper'): string {
  const repo = join(h.root, name);
  mkdirSync(repo, { recursive: true });
  return repo;
}

describe('captured session', () => {
  test('every agent of the captured session ends done and the subagent hangs from the main one', () => {
    h = harness();
    const repo = observedRepo('repo');
    for (const e of loadFixture('session-basic.json', repo)) h.office.ingest(e);
    const main = agent('11111111-aaaa-4bbb-8ccc-000000000001');
    const sub = agent('a0f92699da9c839ef');
    expect(main?.state).toBe('done');
    expect(main?.endedAt).not.toBeNull();
    expect(main?.floor).toBe('repo');
    expect(sub?.state).toBe('done');
    expect(sub?.parentKey).toBe('11111111-aaaa-4bbb-8ccc-000000000001');
    expect(sub?.role).toBe('echoer');
    expect(sub?.roleKind).toBe('intern');
    const count = h.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM events').get();
    expect(count?.n).toBe(16);
  });
});

describe('privacy by floor kind', () => {
  test('an observed floor stores no tool input and shows no command', () => {
    h = harness();
    const repo = observedRepo();
    h.office.ingest(ev('obs-1', repo, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'cat secreto.txt' } }));
    const row = h.db.query<{ payload: string | null }, []>('SELECT payload FROM events').get();
    expect(row?.payload).toBeNull();
    expect(agent('obs-1')?.detail).toBe('Bash');
    expect(JSON.stringify(h.messages)).not.toContain('secreto');
  });

  test('a managed floor keeps the full event', () => {
    h = harness();
    const repo = managedRepo();
    h.office.ingest(ev('man-1', repo, 'PreToolUse', { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'flutter analyze' } }));
    const row = h.db.query<{ payload: string | null }, []>('SELECT payload FROM events').get();
    expect(row?.payload).toContain('flutter analyze');
    expect(agent('man-1')?.state).toBe('checking');
  });
});

describe('blocked agents', () => {
  test('a BLOQUEADO message blocks until the agent works again', () => {
    h = harness();
    const repo = managedRepo();
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { source: 'startup' }), leadMeta);
    h.office.ingest(
      ev(LEAD, repo, 'PreToolUse', {
        agent_id: 'dev-1',
        agent_type: 'office-dev-mobile',
        tool_name: 'SendMessage',
        tool_input: { to: 'main', message: 'BLOQUEADO: falta el contrato de /trips — necesito status de backend' },
      }),
    );
    expect(agent('dev-1')?.state).toBe('blocked');
    expect(h.office.snapshot().messages.at(-1)?.toKey).toBe(LEAD);

    h.office.ingest(ev(LEAD, repo, 'TeammateIdle', { agent_id: 'dev-1', teammate_name: 'dev-mobile', team_name: TEAM }));
    expect(agent('dev-1')?.state).toBe('blocked');
    expect(agent('dev-1')?.name).toBe('dev-mobile');

    h.office.ingest(ev(LEAD, repo, 'PreToolUse', { agent_id: 'dev-1', tool_name: 'Read', tool_input: { file_path: join(repo, 'lib', 'a.dart') } }));
    expect(agent('dev-1')?.state).toBe('reading');
  });

  test('the panel receives the BLOQUEADO and HECHO messages it notifies about', () => {
    h = harness();
    const repo = managedRepo();
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { source: 'startup' }), leadMeta);
    h.office.ingest(
      ev(LEAD, repo, 'PreToolUse', {
        agent_id: 'adev-1',
        agent_type: 'office-dev-mobile',
        tool_name: 'SendMessage',
        tool_input: { to: 'main', message: 'BLOQUEADO: falta el contrato de /trips — necesito status de backend' },
      }),
    );
    expect(h.messages).toContainEqual({ type: 'message', data: expect.objectContaining({ fromKey: 'adev-1', text: expect.stringMatching(/^BLOQUEADO:/) }) });
    expect(h.messages).toContainEqual({ type: 'agent', data: expect.objectContaining({ key: 'adev-1', state: 'blocked' }) });

    h.office.ingest(
      ev(LEAD, repo, 'PreToolUse', {
        tool_name: 'SendMessage',
        tool_input: { to: 'director', message: 'HECHO: pantalla de viajes — validado por tester-mobile — pendiente: nada' },
      }),
      leadMeta,
    );
    expect(h.messages).toContainEqual({ type: 'message', data: expect.objectContaining({ fromKey: LEAD, text: expect.stringMatching(/^HECHO:/) }) });
    expect(h.messages).toContainEqual({ type: 'agent', data: expect.objectContaining({ key: LEAD, roleKind: 'lead' }) });
  });

  test('a question without answer turns into blocked after the configured minutes', () => {
    h = harness();
    const repo = managedRepo();
    h.office.ingest(
      ev(LEAD, repo, 'PreToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: '¿Seguimos?', options: [] }] } }),
    );
    expect(agent(LEAD)?.state).toBe('asking');
    h.clock.advance(5 * 60_000 + 1);
    h.office.tick();
    const last = h.messages.filter((m) => m.type === 'agent').at(-1);
    expect(last?.type === 'agent' && last.data.state).toBe('blocked');
  });

  test('a permission prompt is cleared when the tool finishes', () => {
    h = harness();
    const repo = managedRepo();
    h.office.ingest(ev(LEAD, repo, 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' }));
    expect(agent(LEAD)?.state).toBe('asking');
    h.office.ingest(ev(LEAD, repo, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }));
    expect(agent(LEAD)?.state).toBe('working');
  });
});

describe('test gate', () => {
  function team() {
    h = harness();
    const repo = managedRepo();
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { source: 'startup' }), leadMeta);
    h.office.ingest(
      ev(LEAD, repo, 'PreToolUse', {
        tool_name: 'Agent',
        tool_use_id: 'call-dev',
        tool_input: { name: 'dev-mobile', subagent_type: 'office-dev-mobile', description: 'pantalla de viajes', prompt: '...' },
      }),
    );
    h.office.ingest(ev(LEAD, repo, 'PostToolUse', { tool_name: 'Agent', tool_use_id: 'call-dev', tool_input: {}, tool_response: { agentId: 'dev-1' } }));
    return repo;
  }
  const edit = (repo: string) =>
    h.office.ingest(
      ev(LEAD, repo, 'PostToolUse', { agent_id: 'dev-1', agent_type: 'office-dev-mobile', tool_name: 'Edit', tool_input: { file_path: join(repo, 'lib', 'trips.dart') } }),
    );
  const runTests = (repo: string, agentId: string, agentType: string, ok = true) =>
    h.office.ingest(
      ev(LEAD, repo, ok ? 'PostToolUse' : 'PostToolUseFailure', {
        agent_id: agentId,
        agent_type: agentType,
        tool_name: 'Bash',
        tool_input: { command: 'flutter test test/trips_test.dart' },
        ...(ok ? {} : { error: 'Exit code 1', is_interrupt: false }),
      }),
    );
  const close = (repo: string) =>
    h.office.gate(ev(LEAD, repo, 'TaskCompleted', { task_id: '1', task_subject: 'Pantalla de viajes', team_name: TEAM }));

  test('the developer name comes from the Agent call', () => {
    const repo = team();
    edit(repo);
    expect(agent('dev-1')?.name).toBe('dev-mobile');
    expect(agent('dev-1')?.roleKind).toBe('dev');
  });

  test('the developer running tests is not enough; the tester is', () => {
    const repo = team();
    edit(repo);
    h.clock.advance(1000);
    runTests(repo, 'dev-1', 'office-dev-mobile');
    h.office.ingest(ev(LEAD, repo, 'PreToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: '1', owner: 'dev-mobile', status: 'in_progress' } }));
    h.clock.advance(1000);
    const blocked = close(repo);
    expect(blocked.pass).toBe(false);
    expect(blocked.reason).toContain('Falta tester');

    h.clock.advance(1000);
    runTests(repo, 'tester-1', 'office-tester-mobile', false);
    expect(close(repo).pass).toBe(false);

    h.clock.advance(1000);
    runTests(repo, 'tester-1', 'office-tester-mobile');
    expect(close(repo).pass).toBe(true);

    h.clock.advance(1000);
    edit(repo);
    expect(close(repo).pass).toBe(false);
  });

  test('a task without changes closes', () => {
    team();
    expect(close(join(h.root, 'mobile')).pass).toBe(true);
  });

  test('teams outside the office are never blocked', () => {
    h = harness();
    const repo = managedRepo();
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { source: 'startup' }));
    h.office.ingest(ev(LEAD, repo, 'PostToolUse', { agent_id: 'x-1', tool_name: 'Write', tool_input: { file_path: join(repo, 'a.txt') } }));
    const decision = h.office.gate(ev(LEAD, repo, 'TaskCompleted', { task_id: '7', team_name: TEAM }));
    expect(decision).toEqual({ pass: true, reason: 'fuera de la oficina' });
  });

  test('observed floors are never blocked', () => {
    h = harness();
    const repo = observedRepo();
    h.office.ingest(ev(LEAD, repo, 'SessionStart', {}), leadMeta);
    h.office.ingest(ev(LEAD, repo, 'PostToolUse', { agent_id: 'x-1', tool_name: 'Write', tool_input: { file_path: join(repo, 'a.txt') } }));
    expect(h.office.gate(ev(LEAD, repo, 'TaskCompleted', { task_id: '7', team_name: TEAM })).pass).toBe(true);
  });
});

describe('questions held for the panel', () => {
  const question = (repo: string, id: string, sessionId = LEAD) =>
    ev(sessionId, repo, 'PreToolUse', {
      tool_name: 'AskUserQuestion',
      tool_use_id: id,
      tool_input: {
        questions: [
          { question: '¿Qué endpoint?', header: 'API', options: [{ label: 'A', description: 'el viejo' }, { label: 'B' }], multiSelect: false },
        ],
        metadata: { source: 'test' },
      },
    });

  test('nobody watching: the question goes to the terminal at once', async () => {
    h = harness({ holdMs: 60_000 });
    const repo = managedRepo();
    expect(await h.office.ask(question(repo, 'q0'), leadMeta)).toBeNull();
  });

  test('answered from the panel with the official hook output', async () => {
    h = harness({ holdMs: 60_000 });
    const repo = managedRepo();
    h.office.heartbeat(true);
    const pending = h.office.ask(question(repo, 'q1'), leadMeta);
    expect(h.office.snapshot().questions.map((q) => q.id)).toEqual(['q1']);
    expect(h.office.answer('q1', {})).toBe('invalid');
    expect(h.office.answer('q1', { '¿Qué endpoint?': 'B' })).toBe('ok');
    const body = JSON.parse((await pending) ?? '{}');
    expect(body.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(body.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(body.hookSpecificOutput.updatedInput.answers).toEqual({ '¿Qué endpoint?': 'B' });
    expect(body.hookSpecificOutput.updatedInput.questions[0].options[0]).toEqual({ label: 'A', description: 'el viejo' });
    expect(body.hookSpecificOutput.updatedInput.metadata).toEqual({ source: 'test' });
    expect(h.office.answer('q1', { '¿Qué endpoint?': 'A' })).toBe('closed');
    expect(h.messages.some((m) => m.type === 'question-closed' && m.outcome === 'answered')).toBe(true);
  });

  test('released to the terminal from the panel', async () => {
    h = harness({ holdMs: 60_000 });
    const repo = managedRepo();
    h.office.heartbeat(true);
    const pending = h.office.ask(question(repo, 'q2'), leadMeta);
    expect(h.office.release('q2')).toBe('ok');
    expect(await pending).toBeNull();
    expect(h.office.release('q2')).toBe('closed');
  });

  test('released when the visible heartbeat stops', async () => {
    h = harness({ holdMs: 60_000 });
    const repo = managedRepo();
    h.office.heartbeat(true);
    const pending = h.office.ask(question(repo, 'q3'), leadMeta);
    h.clock.advance(31_000);
    h.office.tick();
    expect(await pending).toBeNull();
  });

  test('a hidden tab does not count as watching', async () => {
    h = harness({ holdMs: 60_000 });
    const repo = managedRepo();
    h.office.heartbeat(false);
    expect(await h.office.ask(question(repo, 'q4'), leadMeta)).toBeNull();
  });

  test('a hidden tab that can notify counts as watching', async () => {
    h = harness({ holdMs: 60_000 });
    const repo = managedRepo();
    h.office.heartbeat(false, 1);
    const pending = h.office.ask(question(repo, 'q4b'), leadMeta);
    expect(h.office.snapshot().questions.map((q) => q.id)).toEqual(['q4b']);
    h.office.heartbeat(false, 0);
    h.clock.advance(31_000);
    h.office.tick();
    expect(await pending).toBeNull();
    expect(h.messages).toContainEqual({ type: 'question-closed', id: 'q4b', outcome: 'released' });
  });

  test('observed floors and sessions outside the office are not held', async () => {
    h = harness({ holdMs: 60_000 });
    h.office.heartbeat(true);
    expect(await h.office.ask(question(observedRepo(), 'q5'), leadMeta)).toBeNull();
    expect(await h.office.ask(question(managedRepo(), 'q6', 'other-session'), { ...leadMeta, role: null })).toBeNull();
  });

  test('the director in its workspace is held', async () => {
    h = harness({ holdMs: 60_000 });
    h.office.heartbeat(true);
    const pending = h.office.ask(question(join(h.workspace, 'x'), 'q7', 'director-1'), { ...leadMeta, role: 'office:director', name: 'director' });
    expect(h.office.snapshot().questions[0]?.floor).toBe('direccion');
    h.office.release('q7');
    expect(await pending).toBeNull();
  });

  test('ending the session releases its questions', async () => {
    h = harness({ holdMs: 60_000 });
    const repo = managedRepo();
    h.office.heartbeat(true);
    const pending = h.office.ask(question(repo, 'q8'), leadMeta);
    h.office.ingest(ev(LEAD, repo, 'SessionEnd', { reason: 'other' }));
    expect(await pending).toBeNull();
  });
});

describe('orders from the panel', () => {
  test('delivered to the session socket with its token and the panel prefix', async () => {
    const sent: { socket: string; payload: string }[] = [];
    h = harness({
      deliverFn: async (socket, payload) => {
        sent.push({ socket, payload });
      },
    });
    const repo = managedRepo();
    const socket = join(h.root, 'lead.sock');
    writeFileSync(socket, '');
    h.office.ingest(ev(LEAD, repo, 'SessionStart', {}), { ...leadMeta, socket, token: 'tok-1' });
    expect(h.office.snapshot().sessions.find((s) => s.sessionId === LEAD)?.canReceive).toBe(true);
    expect(await h.office.order(LEAD, 'Prioriza el login')).toBe('ok');
    const lines = sent[0]!.payload.trim().split('\n').map((l) => JSON.parse(l));
    expect(sent[0]!.socket).toBe(socket);
    expect(lines[0]).toEqual({ type: 'auth', token: 'tok-1' });
    expect(lines[1].type).toBe('user');
    expect(lines[1].message.role).toBe('user');
    expect(lines[1].message.content).toStartWith('[Agent Office]');
    expect(lines[1].message.content).toContain('Prioriza el login');
  });

  test('unknown, unreachable and failing sessions', async () => {
    h = harness({
      deliverFn: async () => {
        throw new Error('refused');
      },
    });
    const repo = managedRepo();
    expect(await h.office.order('nope', 'x')).toBe('not-found');
    h.office.ingest(ev(LEAD, repo, 'SessionStart', {}), leadMeta);
    expect(await h.office.order(LEAD, 'x')).toBe('unreachable');
    const socket = join(h.root, 'lead.sock');
    writeFileSync(socket, '');
    h.office.ingest(ev(LEAD, repo, 'Stop', {}), { ...leadMeta, socket });
    expect(await h.office.order(LEAD, 'x')).toBe('failed');
  });
});

describe('configuration reload', () => {
  test('promoting an observed floor repaints its sessions and floors', () => {
    h = harness();
    const repo = observedRepo('repo');
    h.office.ingest(ev('s-1', repo, 'SessionStart', {}));
    expect(h.office.snapshot().floors.find((f) => f.slug === 'repo')?.kind).toBe('observed');
    h.office.reload(
      { ...h.config, floors: { repo: floor(realPath(repo)) } },
      loadProfiles(PROFILES_DIR),
    );
    expect(h.office.snapshot().floors.find((f) => f.slug === 'repo')?.kind).toBe('managed');
    const types = h.messages.map((m) => m.type);
    expect(types).toContain('floors');
    expect(types.at(-1) === 'settings' || types.at(-1) === 'documents').toBe(true);
  });
});

describe('message recipients', () => {
  test('a lead message to a teammate name points at that agent', () => {
    h = harness();
    const repo = managedRepo();
    h.office.ingest(ev(LEAD, repo, 'SessionStart', {}), leadMeta);
    h.office.ingest(ev(LEAD, repo, 'TeammateIdle', { agent_id: 'dev-1', teammate_name: 'dev-mobile', team_name: TEAM }));
    h.office.ingest(ev(LEAD, repo, 'PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'dev-mobile', message: 'Empieza por la tarea 1' } }));
    const message = h.office.snapshot().messages.at(-1);
    expect(message?.fromKey).toBe(LEAD);
    expect(message?.toKey).toBe('dev-1');
    expect(message?.text).toBe('Empieza por la tarea 1');
  });
});

describe('real agent team capture', () => {
  const REAL_LEAD = 'c3cfeeca-51b9-41c6-b0e7-ef76b63ccf96';
  const DEV = 'adev-office-sandbox-6cae7fd9efff0a59';
  const TESTER = 'atester-office-sandbox-0df0ed3ceca180ab';

  test('teammates get their office type, phantom forks are ignored and team-lead is the lead', () => {
    h = harness();
    const repo = managedRepo('office-sandbox');
    for (const e of loadFixture('team-sandbox.json', repo)) h.office.ingest(e);
    const agents = h.office.snapshot().agents;
    expect(agents.map((a) => a.key).sort()).toEqual([DEV, REAL_LEAD, TESTER].sort());
    expect(agent(REAL_LEAD)).toMatchObject({ role: 'office-lead-office-sandbox', roleKind: 'lead', name: 'lead-office-sandbox' });
    expect(agent(DEV)).toMatchObject({ role: 'office-dev-office-sandbox', roleKind: 'dev', name: 'dev-office-sandbox', parentKey: REAL_LEAD });
    expect(agent(TESTER)).toMatchObject({ role: 'office-tester-office-sandbox', roleKind: 'tester', state: 'idle', endedAt: null });
    expect(agent(DEV)?.state).toBe('blocked');
    const message = h.office.snapshot().messages.at(-1);
    expect(message).toMatchObject({ fromKey: DEV, toName: 'team-lead', toKey: REAL_LEAD });
  });

  test('without the spawn call the type comes from the team config', () => {
    h = harness();
    const repo = managedRepo();
    const teamDir = join(h.root, 'claude-home', 'teams', TEAM);
    mkdirSync(teamDir, { recursive: true });
    writeFileSync(
      join(teamDir, 'config.json'),
      JSON.stringify({ members: [{ name: 'team-lead', agentType: 'team-lead' }, { name: 'tester-mobile', agentType: 'office-tester-mobile' }] }),
    );
    h.office.ingest(ev(LEAD, repo, 'SessionStart', {}), leadMeta);
    h.office.ingest(ev(LEAD, repo, 'PreToolUse', { agent_id: 'atester-1', agent_type: 'tester-mobile', tool_name: 'Read', tool_input: { file_path: join(repo, 'a') } }));
    expect(agent('atester-1')).toMatchObject({ role: 'office-tester-mobile', roleKind: 'tester' });
  });
});

describe('completion gate on HECHO messages', () => {
  const done = (repo: string, extra: Record<string, unknown> = {}) =>
    ev(LEAD, repo, 'PreToolUse', {
      agent_type: 'office-lead-mobile',
      tool_name: 'SendMessage',
      tool_input: { to: 'director', message: 'HECHO: pantalla de viajes — validado por tester-mobile — pendiente: nada' },
      ...extra,
    });

  function teamWithEdit(): string {
    h = harness();
    const repo = managedRepo();
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { agent_type: 'office-lead-mobile' }), leadMeta);
    h.office.ingest(
      ev(LEAD, repo, 'PostToolUse', { agent_id: 'adev-1', agent_type: 'office-dev-mobile', tool_name: 'Write', tool_input: { file_path: join(repo, 'lib', 'a.dart') } }),
    );
    return repo;
  }

  test('blocks the lead report while the change has no green tester run, then lets it through', () => {
    const repo = teamWithEdit();
    h.clock.advance(1000);
    h.office.ingest(
      ev(LEAD, repo, 'PostToolUse', { agent_id: 'adev-1', agent_type: 'office-dev-mobile', tool_name: 'Bash', tool_input: { command: 'flutter test test/a_test.dart' } }),
    );
    const blocked = h.office.gateMessage(done(repo));
    expect(blocked.pass).toBe(false);
    expect(blocked.reason).toContain('Falta tester');
    h.clock.advance(1000);
    h.office.ingest(
      ev(LEAD, repo, 'PostToolUse', { agent_id: 'atester-1', agent_type: 'office-tester-mobile', tool_name: 'Bash', tool_input: { command: 'flutter test test/a_test.dart' } }),
    );
    expect(h.office.gateMessage(done(repo)).pass).toBe(true);
    const rows = h.db.query<{ decision: string }, []>('SELECT decision FROM gate_decisions ORDER BY id').all();
    expect(rows.map((r) => r.decision)).toEqual(['block', 'pass']);
  });

  test('only a HECHO message from a lead is checked', () => {
    const repo = teamWithEdit();
    expect(h.office.gateMessage(done(repo, { tool_input: { to: 'director', message: 'Voy por la mitad' } })).pass).toBe(true);
    expect(h.office.gateMessage(done(repo, { agent_id: 'adev-1', agent_type: 'office-dev-mobile' })).pass).toBe(true);
    expect(h.office.gateMessage(done(repo)).pass).toBe(false);
  });

  test('a report without changes passes', () => {
    h = harness();
    const repo = managedRepo();
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { agent_type: 'office-lead-mobile' }), leadMeta);
    expect(h.office.gateMessage(done(repo)).pass).toBe(true);
  });
});

describe('session liveness', () => {
  test('a session whose socket disappears is ended on the next tick', () => {
    h = harness();
    const repo = managedRepo();
    const socket = join(h.root, 'lead.sock');
    writeFileSync(socket, '');
    h.office.ingest(ev(LEAD, repo, 'SessionStart', {}), { ...leadMeta, socket });
    h.office.tick();
    expect(h.office.snapshot().sessions.find((s) => s.sessionId === LEAD)?.endedAt).toBeNull();
    rmSync(socket);
    h.office.tick();
    expect(h.office.snapshot().sessions.find((s) => s.sessionId === LEAD)?.endedAt).not.toBeNull();
    expect(agent(LEAD)?.state).toBe('done');
  });

  test('a restart only restores sessions whose socket still exists', () => {
    h = harness();
    const repo = managedRepo();
    const live = join(h.root, 'live.sock');
    writeFileSync(live, '');
    h.office.ingest(ev('live-1', repo, 'SessionStart', {}), { ...leadMeta, socket: live });
    h.office.ingest(ev('dead-1', repo, 'SessionStart', {}), { ...leadMeta, socket: join(h.root, 'gone.sock') });
    const restarted = new Office({
      db: h.db,
      config: h.config,
      profiles: loadProfiles(PROFILES_DIR),
      workspaceDir: h.workspace,
      claudeHome: join(h.root, 'claude-home'),
      gitRoot: (cwd) => cwd,
      now: () => h.clock.now,
    });
    expect(restarted.snapshot().sessions.map((s) => s.sessionId)).toEqual(['live-1']);
    expect(restarted.snapshot().agents).toMatchObject([
      { key: 'live-1', name: 'lead-mobile', role: 'office-lead-mobile', roleKind: 'lead', state: 'idle', floor: 'mobile', endedAt: null },
    ]);
  });
});
