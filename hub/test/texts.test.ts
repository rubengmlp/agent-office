import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HookEvent, HookMeta, HubText } from '../src/types';
import { ev, floor, harness, loadFixture, type Harness } from './helpers';

const LEAD = '44444444-dddd-4eee-8fff-000000000004';
const leadMeta: HookMeta = { socket: null, token: null, role: 'office-lead-mobile', name: 'lead-mobile' };

// Words the hub used to write itself in Spanish. A raw string that is not a slice of what the hook sent and
// contains one of them means a branch went back to writing text instead of a key.
const SPANISH =
  /[áéíóúñ¿¡]|\b(esperando|pensando|empieza|termina|terminado|sesión|permiso|pregunta|tarea|lección|fichero|tests en|delega|edita|editando|editado|lee|ejecuta|revisa|escribe|avisa|espera|aviso|orden|entrega|guardia|alerta|memoria|fuentes|nuevo turno|queda libre|fin de turno|plan descartado)\b/;

// Keys that classify emits (state-machine.ts), including the nested hub.who.* fallbacks.
const CLASSIFY_KEYS = [
  'hub.detail.waiting',
  'hub.detail.thinking',
  'hub.detail.permission',
  'hub.detail.starting',
  'hub.detail.finished',
  'hub.detail.end',
  'hub.detail.testsGreen',
  'hub.detail.testsRed',
  'hub.detail.testsInterrupted',
  'hub.detail.questionCancelled',
  'hub.detail.awaitingAnswer',
  'hub.detail.delegates',
  'hub.detail.createsTask',
  'hub.detail.updatesTask',
  'hub.detail.question',
  'hub.act.sessionStart',
  'hub.act.newTurn',
  'hub.act.permission',
  'hub.act.subagentStart',
  'hub.act.done',
  'hub.act.turnEnd',
  'hub.act.sessionEnd',
  'hub.act.teammateIdle',
  'hub.act.taskCreated',
  'hub.act.tests',
  'hub.act.check',
  'hub.act.run',
  'hub.act.edit',
  'hub.act.read',
  'hub.act.question',
  'hub.act.message',
  'hub.act.blockedMessage',
  'hub.act.delegate',
  'hub.act.taskCreate',
  'hub.act.taskUpdate',
  'hub.act.ok',
  'hub.act.testsGreen',
  'hub.act.edited',
  'hub.act.subagentRunning',
  'hub.act.taskCreatedId',
  'hub.act.taskCreatedPlain',
  'hub.act.questionAnswered',
  'hub.act.testsInterrupted',
  'hub.act.testsRed',
  'hub.act.toolFailed',
  'hub.act.awaits',
  'hub.act.awaitingUser',
  'hub.act.notice',
  'hub.who.subagent',
  'hub.who.teammate',
];

let h: Harness;
afterEach(() => h?.cleanup());

function collectKeys(value: HubText, out: Set<string>): void {
  if (typeof value === 'string') return;
  out.add(value.key);
  for (const param of Object.values(value.params ?? {})) {
    if (typeof param === 'object' && param !== null) collectKeys(param as HubText, out);
  }
}

function strings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value.replace(/\s+/g, ' ').trim());
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, out);
}

describe('hub texts', () => {
  test('every detail and summary the hub emits is a key or raw text without Spanish', async () => {
    h = harness({ holdMs: 60_000 });
    const repo = join(h.root, 'mobile');
    mkdirSync(repo, { recursive: true });
    h.config.floors.mobile = floor(repo);

    const pre = (tool: string, input: Record<string, unknown>, extra: Partial<HookEvent> = {}) => ev(LEAD, repo, 'PreToolUse', { tool_name: tool, tool_input: input, ...extra });
    const post = (tool: string, input: Record<string, unknown>, extra: Partial<HookEvent> = {}) => ev(LEAD, repo, 'PostToolUse', { tool_name: tool, tool_input: input, ...extra });
    const fail = (tool: string, input: Record<string, unknown>, extra: Partial<HookEvent> = {}) =>
      ev(LEAD, repo, 'PostToolUseFailure', { tool_name: tool, tool_input: input, ...extra });
    const events: HookEvent[] = [
      ...loadFixture('session-basic.json', repo),
      ...loadFixture('team-sandbox.json', repo),
      ev(LEAD, repo, 'SessionStart', { source: 'startup' }),
      ev(LEAD, repo, 'UserPromptSubmit'),
      pre('Edit', { file_path: join(repo, 'lib', 'a.dart') }),
      post('Edit', { file_path: join(repo, 'lib', 'a.dart') }),
      pre('Read', { file_path: join(repo, 'lib', 'a.dart') }),
      pre('Grep', { pattern: 'TODO' }),
      pre('AskUserQuestion', { questions: [{ question: 'Which endpoint?', options: [{ label: 'A' }] }] }),
      post('AskUserQuestion', { questions: [{ question: 'Which endpoint?', options: [{ label: 'A' }] }] }),
      pre('AskUserQuestion', {}),
      fail('AskUserQuestion', {}),
      pre('TaskCreate', { subject: 'Trips screen' }),
      post('TaskCreate', { subject: 'Trips screen' }, { tool_response: { task: { id: '7' } } }),
      post('TaskCreate', { subject: 'Trips screen' }),
      pre('TaskUpdate', { taskId: '7', status: 'completed' }),
      pre('Bash', { command: 'flutter test' }),
      post('Bash', { command: 'flutter test' }),
      fail('Bash', { command: 'flutter test' }),
      fail('Bash', { command: 'flutter test' }, { is_interrupt: true }),
      pre('Bash', { command: 'flutter analyze' }),
      pre('Bash', { command: 'ls' }),
      post('Bash', { command: 'ls' }),
      fail('Glob', { pattern: '*' }, { error: 'boom' }),
      post('Glob', { pattern: '*' }),
      pre('Agent', { description: 'Trips developer', subagent_type: 'office-dev-mobile' }),
      pre('Agent', {}),
      pre('SendMessage', { to: 'director', message: 'hello' }),
      ev(LEAD, repo, 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' }),
      ev(LEAD, repo, 'Notification', { notification_type: 'permission_prompt' }),
      ev(LEAD, repo, 'Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting' }),
      ev(LEAD, repo, 'Notification', { notification_type: 'auth_success', message: 'Logged in' }),
      ev(LEAD, repo, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }),
      ev(LEAD, repo, 'TaskCreated', { task_id: '8', task_subject: 'Login' }),
      // After the notifications and permissions: a block hides the details that follow until the agent works again.
      pre('SendMessage', { to: 'director', message: 'BLOQUEADO: missing key - need the backend key' }),
      ev(LEAD, repo, 'SubagentStart', { agent_id: 'sub-1' }),
      ev(LEAD, repo, 'SubagentStop', { agent_id: 'sub-1' }),
      ev(LEAD, repo, 'TeammateIdle', {}),
      ev(LEAD, repo, 'Stop'),
    ];
    for (const event of events) h.office.ingest(event, event.session_id === LEAD ? leadMeta : undefined);
    h.office.gate(ev(LEAD, repo, 'TaskCompleted', { task_id: '7', task_subject: 'Trips screen' }));
    h.office.gateMessage(pre('SendMessage', { to: 'director', message: 'HECHO: trips screen - checked by tester-mobile - pending: none' }));
    h.office.heartbeat(true);
    const pending = h.office.permission(ev(LEAD, repo, 'PermissionRequest', { tool_name: 'Edit', tool_input: { file_path: join(repo, 'b.dart') } }), leadMeta);
    h.office.ingest(ev(LEAD, repo, 'SessionEnd', {}), leadMeta);
    h.office.release(h.office.snapshot().questions[0]?.id ?? '');
    await pending;

    const texts: HubText[] = [];
    for (const msg of h.messages) {
      if (msg.type === 'agent') texts.push(msg.data.detail);
      if (msg.type === 'activity') texts.push(msg.data.summary);
    }
    const snapshot = h.office.snapshot();
    for (const agent of snapshot.agents) texts.push(agent.detail);
    for (const entry of snapshot.activity) texts.push(entry.summary);
    for (const question of snapshot.questions) if (question.prompt) texts.push(question.prompt);

    const sources: string[] = [];
    strings(events, sources);
    const isRaw = (value: string) => {
      const core = value.replace(/…$/, '').replace(/^→ /, '');
      return core === '' || sources.some((source) => source.includes(core));
    };
    for (const value of texts) {
      if (typeof value === 'string') {
        if (!isRaw(value)) expect(value).not.toMatch(SPANISH);
      } else {
        expect(value.key).toStartWith('hub.');
      }
    }

    const seen = new Set<string>();
    for (const value of texts) collectKeys(value, seen);
    expect(CLASSIFY_KEYS.filter((key) => !seen.has(key))).toEqual([]);
  });
});
