import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES_DIR } from '../src/config';
import { realPath } from '../src/floors';
import { loadProfiles } from '../src/profiles';
import type { AgentView, HookMeta } from '../src/types';
import { ev, harness, loadFixture, type Harness } from './helpers';

const LEAD = '22222222-bbbb-4ccc-8ddd-000000000002';
const TEAM = 'session-22222222';
const leadMeta: HookMeta = { socket: null, token: null, role: 'office-lead-mobile', name: 'lead-mobile' };

let h: Harness;
afterEach(() => h?.cleanup());

const agent = (key: string): AgentView | undefined => h.office.snapshot().agents.find((a) => a.key === key);

function managedRepo(name = 'mobile'): string {
  const repo = join(h.root, name);
  mkdirSync(repo, { recursive: true });
  h.config.floors[name] = { path: repo, stack: 'flutter', managed: true };
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
      { ...h.config, floors: { repo: { path: realPath(repo), stack: 'flutter', managed: true } } },
      loadProfiles(PROFILES_DIR),
    );
    expect(h.office.snapshot().floors.find((f) => f.slug === 'repo')?.kind).toBe('managed');
    expect(h.messages.at(-1)?.type).toBe('floors');
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
