import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { classify, record, text, type Matchers } from '../src/state-machine';
import type { HookEvent, HookMeta, HubText } from '../src/types';
import { ev, floor, harness, loadFixture, type Harness } from './helpers';

const LEAD = '44444444-dddd-4eee-8fff-000000000004';
const leadMeta: HookMeta = { socket: null, token: null, role: 'office-lead-mobile', name: 'lead-mobile' };

// The words of the Spanish hub.detail.* and hub.act.* texts in ui/src/i18n/es.ts, plus the old fallbacks. A raw
// string that is not taken from a raw field of the hook and contains one of them means a branch went back to
// writing text instead of a key.
const WORDS = [
  'esperando', 'pensando', 'permiso', 'empieza', 'terminado', 'fin', 'verde', 'rojo', 'interrumpidos', 'pregunta',
  'cancelada', 'espera', 'respuesta', 'delega', 'crea', 'tarea', 'actualiza', 'sin respuesta', 'bloqueado', 'revisión',
  'sesión', 'iniciada', 'nuevo turno', 'pide', 'termina', 'terminada', 'queda libre', 'creada', 'revisa', 'ejecuta',
  'edita', 'editando', 'editado', 'lee', 'escribe', 'avisa', 'bloqueo', 'subagente', 'compañero', 'en marcha',
  'respondida', 'falla', 'aviso', 'usuario',
];
const SPANISH = new RegExp(`[áéíóúñ¿¡]|\\b(${WORDS.join('|')})\\b`);
const flutter: Matchers = { test: /\bflutter\s+test\b/, check: /\bflutter\s+analyze\b/ };

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
  'hub.detail.delegatesTo',
  'hub.detail.asks',
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
  'hub.act.asks',
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

// Every raw string in a hub text, nested parameters included.
function rawStrings(value: HubText, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  for (const param of Object.values(value.params ?? {})) {
    if (typeof param === 'string') out.push(param);
    else if (typeof param === 'object' && param !== null) rawStrings(param as HubText, out);
  }
}

function collectKeys(value: HubText, out: Set<string>): void {
  if (typeof value === 'string') return;
  out.add(value.key);
  for (const param of Object.values(value.params ?? {})) {
    if (typeof param === 'object' && param !== null) collectKeys(param as HubText, out);
  }
}

// The fields the hub may pass through as raw text: what the hook sent, never text the hub wrote.
function rawFields(e: HookEvent): string[] {
  const input = record(e.tool_input);
  const file = text(input.file_path) ?? text(input.notebook_path);
  const questions = Array.isArray(input.questions) ? input.questions : [];
  return [
    text(input.command),
    file ? basename(file) : null,
    text(input.pattern),
    text(input.url),
    text(input.query),
    text(input.path),
    text(record(questions[0]).question),
    text(input.to),
    text(input.message),
    text(input.summary),
    text(e.last_assistant_message),
    text(e.reason),
    text(e.message),
    text(e.tool_name),
    text(e.agent_type),
    text(e.teammate_name),
    text(e.task_subject),
    text(e.source),
    text(e.error),
    text(input.subject),
    text(input.description),
    text(input.subagent_type),
    text(input.name),
    e.hook_event_name,
  ]
    .filter((value): value is string => value !== null)
    .map((value) => value.replace(/\s+/g, ' ').trim());
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
      pre('SendMessage', { to: 'director', message: 'PREGUNTA: Apple or Google? — opciones: Apple | Google' }),
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
    const officeOnly = [
      ev(LEAD, repo, 'TaskCompleted', { task_id: '7', task_subject: 'Trips screen' }),
      pre('SendMessage', { to: 'director', message: 'HECHO: trips screen - checked by tester-mobile - pending: none' }),
      ev(LEAD, repo, 'PermissionRequest', { tool_name: 'Edit', tool_input: { file_path: join(repo, 'b.dart') } }),
    ];
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

    // Raw values the office adds itself: agent names, keys and the permission detail.
    const sources = [...events, ...officeOnly].flatMap(rawFields).concat('lead-mobile', LEAD.slice(0, 8), join(repo, 'b.dart'));
    // short() keeps a prefix and may add an ellipsis; SendMessage details are "→ <to>".
    const isRaw = (value: string) => {
      const core = value.replace(/…$/, '').replace(/^→ /, '');
      return core === '' || sources.some((source) => source.startsWith(core));
    };
    for (const value of texts) {
      if (typeof value !== 'string') expect(value.key).toStartWith('hub.');
      const raw: string[] = [];
      rawStrings(value, raw);
      for (const item of raw) if (!isRaw(item)) expect(item).not.toMatch(SPANISH);
    }

    const seen = new Set<string>();
    for (const value of texts) collectKeys(value, seen);
    expect(CLASSIFY_KEYS.filter((key) => !seen.has(key))).toEqual([]);
  });

  test('branches that share a key or a fallback emit exactly the expected text', () => {
    const base = { session_id: LEAD, cwd: '/repo' };
    const tool = (hook: string, name: string, input: Record<string, unknown> = {}): HookEvent => ({ ...base, hook_event_name: hook, tool_name: name, tool_input: input });
    const waiting: HubText = { key: 'hub.detail.waiting' };
    const thinking: HubText = { key: 'hub.detail.thinking' };
    const subagent: HubText = { key: 'hub.who.subagent' };
    const cases: [HookEvent, { detail?: HubText; summary?: HubText }][] = [
      [{ ...base, hook_event_name: 'SessionStart' }, { detail: waiting, summary: { key: 'hub.act.sessionStart', params: { source: 'startup' } } }],
      [{ ...base, hook_event_name: 'Stop' }, { detail: waiting, summary: { key: 'hub.act.turnEnd' } }],
      [{ ...base, hook_event_name: 'TeammateIdle' }, { detail: waiting, summary: { key: 'hub.act.teammateIdle', params: { who: { key: 'hub.who.teammate' } } } }],
      [{ ...base, hook_event_name: 'Notification', notification_type: 'idle_prompt' }, { detail: waiting, summary: { key: 'hub.act.awaitingUser' } }],
      [{ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt' }, { detail: { key: 'hub.detail.awaitingAnswer' } }],
      [{ ...base, hook_event_name: 'UserPromptSubmit' }, { detail: thinking, summary: { key: 'hub.act.newTurn' } }],
      [tool('PostToolUse', 'AskUserQuestion'), { detail: thinking, summary: { key: 'hub.act.questionAnswered' } }],
      [tool('PostToolUseFailure', 'AskUserQuestion'), { detail: { key: 'hub.detail.questionCancelled' } }],
      [
        tool('PreToolUse', 'AskUserQuestion'),
        { detail: { key: 'hub.detail.question' }, summary: { key: 'hub.act.question', params: { text: { key: 'hub.detail.question' } } } },
      ],
      [tool('PostToolUse', 'Bash', { command: 'ls' }), { summary: { key: 'hub.act.ok', params: { what: 'ls' } } }],
      [tool('PostToolUse', 'Glob'), { summary: { key: 'hub.act.ok', params: { what: 'Glob' } } }],
      [{ ...base, hook_event_name: 'SubagentStart', agent_id: 'a1' }, { detail: { key: 'hub.detail.starting' }, summary: { key: 'hub.act.subagentStart', params: { who: subagent } } }],
      [
        tool('PreToolUse', 'Agent'),
        { detail: { key: 'hub.detail.delegates', params: { what: subagent } }, summary: { key: 'hub.act.delegate', params: { who: subagent } } },
      ],
      [{ ...base, hook_event_name: 'SubagentStop', agent_id: 'a1' }, { detail: { key: 'hub.detail.finished' }, summary: { key: 'hub.act.done' } }],
      [{ ...base, hook_event_name: 'SessionEnd' }, { detail: { key: 'hub.detail.end' }, summary: { key: 'hub.act.sessionEnd', params: { reason: '?' } } }],
    ];
    for (const [event, expected] of cases) {
      const c = classify(event, flutter);
      if (expected.detail !== undefined) expect([event.hook_event_name, c.detail]).toEqual([event.hook_event_name, expected.detail]);
      if (expected.summary !== undefined) expect([event.hook_event_name, c.summary]).toEqual([event.hook_event_name, expected.summary]);
    }
  });
});
