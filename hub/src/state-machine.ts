import { basename } from 'node:path';
import type { AgentState, HookEvent, HubText } from './types';

export type Matchers = { test: RegExp; check: RegExp };

export type SpawnCall = {
  toolUseId: string;
  name: string | null;
  description: string | null;
  subagentType: string | null;
};

export type TaskInfo = {
  taskId: string | null;
  subject: string | null;
  owner: string | null;
  status: string | null;
};

export type TestPhase = 'start' | 'pass' | 'fail';

export type Classified = {
  event: string;
  agentKey: string;
  parentKey: string | null;
  role: string | null;
  state: AgentState | null;
  detail: HubText;
  tool: string | null;
  filePath: string | null;
  command: string | null;
  edit: string | null;
  test: TestPhase | null;
  message: { to: string; text: string } | null;
  blocked: string | null;
  unblock: boolean;
  ended: boolean;
  sessionEnded: boolean;
  spawnCall: SpawnCall | null;
  spawned: { toolUseId: string; agentId: string; teammate: boolean } | null;
  task: TaskInfo | null;
  teammate: string | null;
  team: string | null;
  question: string | null;
  summary: HubText;
};

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
export const READ_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'LS',
  'NotebookRead',
  'WebFetch',
  'WebSearch',
  'ToolSearch',
  'ListAgents',
  'TaskGet',
  'TaskList',
]);
export const SPAWN_TOOLS = new Set(['Agent', 'Task']);
export const BLOCK_PREFIX = /^\s*BLOQUEADO\s*:/i;
export const DONE_PREFIX = /^\s*HECHO\s*:/i;
export const QUESTION_PREFIX = /^\s*PREGUNTA\s*:/;
export const NEVER_FAILS = /\|\|\s*(?:true\b|:(?=\s|$|[;&)])|exit\s+0\b)|;\s*true\s*$/;
export const TEST_FAILED: readonly RegExp[] = [
  /^\s*[1-9]\d* fail\s*$/m,
  /^\s*Tests?:?\s.*\b[1-9]\d* failed\b/m,
  /^=+ .*\b[1-9]\d* failed\b/m,
  /^(--- )?FAIL\b/m,
  /^\d+:\d+ \+\d+.*: Some tests failed\.\s*$/m,
  /^(FAILURES|ERRORS)!$/m,
];

export function isTestCommand(command: string, m: Matchers): boolean {
  return m.test.test(command) && !NEVER_FAILS.test(command);
}

function testsRed(response: Record<string, unknown>): boolean {
  if (typeof response.exit_code === 'number' && response.exit_code !== 0) return true;
  const output = `${typeof response.stdout === 'string' ? response.stdout : ''}\n${typeof response.stderr === 'string' ? response.stderr : ''}`;
  return TEST_FAILED.some((pattern) => pattern.test(output));
}

export function questionText(body: string): string {
  return body.replace(QUESTION_PREFIX, '').split(/\s*[—–-]+\s*opciones\s*:/i)[0]?.trim() ?? '';
}

export function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function idText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return text(value);
}

export function short(value: string, max = 80): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function classify(e: HookEvent, m: Matchers): Classified {
  const base: Classified = {
    event: e.hook_event_name,
    agentKey: e.agent_id ?? e.session_id,
    parentKey: e.agent_id ? e.session_id : null,
    role: text(e.agent_type),
    state: null,
    detail: '',
    tool: text(e.tool_name),
    filePath: null,
    command: null,
    edit: null,
    test: null,
    message: null,
    blocked: null,
    unblock: false,
    ended: false,
    sessionEnded: false,
    spawnCall: null,
    spawned: null,
    task: null,
    teammate: null,
    team: text(e.team_name),
    question: null,
    summary: e.hook_event_name,
  };
  const input = record(e.tool_input);

  switch (e.hook_event_name) {
    case 'SessionStart':
      return {
        ...base,
        state: 'idle',
        detail: { key: 'hub.detail.waiting' },
        summary: { key: 'hub.act.sessionStart', params: { source: text(e.source) ?? 'startup' } },
      };
    case 'UserPromptSubmit':
      return { ...base, state: 'working', detail: { key: 'hub.detail.thinking' }, unblock: true, summary: { key: 'hub.act.newTurn' } };
    case 'PreToolUse':
      return preTool(base, e, input, m);
    case 'PostToolUse':
      return postTool(base, e, input, m);
    case 'PostToolUseFailure':
      return failedTool(base, e, input, m);
    case 'PermissionRequest':
      return {
        ...base,
        state: 'asking',
        detail: { key: 'hub.detail.permission', params: { tool: base.tool ?? '?' } },
        summary: { key: 'hub.act.permission', params: { tool: base.tool ?? '?' } },
      };
    case 'Notification':
      return notification(base, e);
    case 'SubagentStart':
      return {
        ...base,
        state: 'working',
        detail: { key: 'hub.detail.starting' },
        summary: { key: 'hub.act.subagentStart', params: { who: base.role ?? { key: 'hub.who.subagent' } } },
      };
    case 'SubagentStop': {
      const last = text(e.last_assistant_message);
      return {
        ...base,
        state: 'done',
        ended: true,
        detail: last ? short(last, 120) : { key: 'hub.detail.finished' },
        summary: { key: 'hub.act.done' },
      };
    }
    case 'Stop':
      return { ...base, state: 'idle', detail: { key: 'hub.detail.waiting' }, summary: { key: 'hub.act.turnEnd' } };
    case 'SessionEnd':
      return {
        ...base,
        state: 'done',
        ended: true,
        sessionEnded: true,
        detail: text(e.reason) ?? { key: 'hub.detail.end' },
        summary: { key: 'hub.act.sessionEnd', params: { reason: text(e.reason) ?? '?' } },
      };
    case 'TeammateIdle': {
      const name = text(e.teammate_name);
      const agentKey = e.agent_id ?? (name ? `${name}@${base.team ?? e.session_id}` : e.session_id);
      return {
        ...base,
        agentKey,
        parentKey: agentKey === e.session_id ? null : e.session_id,
        state: 'idle',
        detail: { key: 'hub.detail.waiting' },
        teammate: name,
        summary: { key: 'hub.act.teammateIdle', params: { who: name ?? { key: 'hub.who.teammate' } } },
      };
    }
    case 'TaskCreated':
      return {
        ...base,
        task: { taskId: idText(e.task_id), subject: text(e.task_subject), owner: null, status: 'pending' },
        teammate: text(e.teammate_name),
        summary: { key: 'hub.act.taskCreated', params: { subject: short(text(e.task_subject) ?? '', 60) } },
      };
    default:
      return base;
  }
}

function preTool(base: Classified, e: HookEvent, input: Record<string, unknown>, m: Matchers): Classified {
  const tool = base.tool ?? '?';
  const working = { ...base, unblock: true };

  if (tool === 'Bash') {
    const command = text(input.command) ?? '';
    if (isTestCommand(command, m)) {
      return { ...working, state: 'testing', command, test: 'start', detail: short(command), summary: { key: 'hub.act.tests', params: { command: short(command, 60) } } };
    }
    if (m.check.test(command)) {
      return { ...working, state: 'checking', command, detail: short(command), summary: { key: 'hub.act.check', params: { command: short(command, 60) } } };
    }
    return { ...working, state: 'working', command, detail: short(command), summary: { key: 'hub.act.run', params: { command: short(command, 60) } } };
  }

  if (EDIT_TOOLS.has(tool)) {
    const filePath = text(input.file_path) ?? text(input.notebook_path);
    const name = filePath ? basename(filePath) : tool;
    return { ...working, state: 'working', filePath, detail: name, summary: { key: 'hub.act.edit', params: { name } } };
  }

  if (READ_TOOLS.has(tool)) {
    const filePath = text(input.file_path) ?? text(input.path);
    const what = filePath ? basename(filePath) : (text(input.pattern) ?? text(input.url) ?? text(input.query) ?? tool);
    return { ...working, state: 'reading', filePath, detail: short(what), summary: { key: 'hub.act.read', params: { what: short(what, 60) } } };
  }

  if (tool === 'AskUserQuestion') {
    const questions = Array.isArray(input.questions) ? input.questions : [];
    const first = text(record(questions[0]).question);
    return {
      ...working,
      state: 'asking',
      detail: first ? short(first) : { key: 'hub.detail.question' },
      summary: { key: 'hub.act.question', params: { text: first ? short(first, 60) : { key: 'hub.detail.question' } } },
    };
  }

  if (tool === 'SendMessage') {
    const to = text(input.to) ?? '?';
    const body = text(input.message) ?? '';
    const blocked = BLOCK_PREFIX.test(body);
    if (!blocked && QUESTION_PREFIX.test(body)) {
      const question = questionText(body);
      return {
        ...base,
        state: 'asking',
        message: { to, text: body },
        question,
        unblock: true,
        detail: { key: 'hub.detail.asks', params: { question: question ? short(question, 120) : { key: 'hub.detail.question' } } },
        summary: { key: 'hub.act.asks', params: { to, question: question ? short(question, 60) : { key: 'hub.detail.question' } } },
      };
    }
    return {
      ...base,
      state: blocked ? 'blocked' : 'talking',
      message: { to, text: body },
      blocked: blocked ? short(body, 160) : null,
      unblock: !blocked,
      detail: `→ ${to}`,
      summary: { key: blocked ? 'hub.act.blockedMessage' : 'hub.act.message', params: { to, text: short(body || text(input.summary) || '', 60) } },
    };
  }

  if (SPAWN_TOOLS.has(tool)) {
    const spawnCall: SpawnCall = {
      toolUseId: e.tool_use_id ?? '',
      name: text(input.name),
      description: text(input.description),
      subagentType: text(input.subagent_type),
    };
    const who: HubText = spawnCall.name ?? spawnCall.subagentType ?? { key: 'hub.who.subagent' };
    return {
      ...working,
      state: 'working',
      spawnCall,
      detail: spawnCall.description
        ? { key: 'hub.detail.delegatesTo', params: { who, what: short(spawnCall.description, 60) } }
        : { key: 'hub.detail.delegates', params: { what: who } },
      summary: { key: 'hub.act.delegate', params: { who } },
    };
  }

  if (tool === 'TaskCreate' || tool === 'TaskUpdate') {
    const task: TaskInfo = {
      taskId: idText(input.taskId) ?? idText(input.task_id) ?? idText(input.id),
      subject: text(input.subject),
      owner: text(input.owner),
      status: text(input.status),
    };
    if (tool === 'TaskCreate') {
      const subject = short(task.subject ?? '', 50);
      return {
        ...working,
        state: 'working',
        task,
        detail: { key: 'hub.detail.createsTask', params: { subject } },
        summary: { key: 'hub.act.taskCreate', params: { subject } },
      };
    }
    const id = task.taskId ?? '';
    return {
      ...working,
      state: 'working',
      task,
      detail: { key: 'hub.detail.updatesTask', params: { id } },
      summary: { key: 'hub.act.taskUpdate', params: { id } },
    };
  }

  return { ...working, state: 'working', detail: tool, summary: tool };
}

function postTool(base: Classified, e: HookEvent, input: Record<string, unknown>, m: Matchers): Classified {
  const tool = base.tool ?? '?';

  if (tool === 'Bash') {
    const command = text(input.command) ?? '';
    if (isTestCommand(command, m)) {
      const response = record(e.tool_response);
      if (input.run_in_background === true || response.interrupted === true) {
        return { ...base, state: 'working', command, summary: { key: 'hub.act.ok', params: { what: short(command, 60) } } };
      }
      if (testsRed(response)) {
        return {
          ...base,
          state: 'working',
          command,
          test: 'fail',
          detail: { key: 'hub.detail.testsRed' },
          summary: { key: 'hub.act.testsRed', params: { command: short(command, 60) } },
        };
      }
      return {
        ...base,
        state: 'working',
        command,
        test: 'pass',
        detail: { key: 'hub.detail.testsGreen' },
        summary: { key: 'hub.act.testsGreen', params: { command: short(command, 60) } },
      };
    }
    return { ...base, command, summary: { key: 'hub.act.ok', params: { what: short(command, 60) } } };
  }

  if (EDIT_TOOLS.has(tool)) {
    const filePath = text(input.file_path) ?? text(input.notebook_path);
    return { ...base, filePath, edit: filePath ?? '', summary: { key: 'hub.act.edited', params: { name: filePath ? basename(filePath) : tool } } };
  }

  if (SPAWN_TOOLS.has(tool)) {
    const response = record(e.tool_response);
    const agentId = idText(response.agentId) ?? idText(response.agent_id);
    return {
      ...base,
      spawned: agentId && e.tool_use_id ? { toolUseId: e.tool_use_id, agentId, teammate: response.status === 'teammate_spawned' } : null,
      summary: { key: 'hub.act.subagentRunning' },
    };
  }

  if (tool === 'TaskCreate') {
    const response = record(e.tool_response);
    const taskId = idText(response.taskId) ?? idText(record(response.task).id) ?? idText(response.id);
    return {
      ...base,
      task: { taskId, subject: text(input.subject), owner: text(input.owner), status: 'pending' },
      summary: taskId ? { key: 'hub.act.taskCreatedId', params: { id: taskId } } : { key: 'hub.act.taskCreatedPlain' },
    };
  }

  if (tool === 'AskUserQuestion') {
    return { ...base, state: 'working', detail: { key: 'hub.detail.thinking' }, summary: { key: 'hub.act.questionAnswered' } };
  }

  return { ...base, summary: { key: 'hub.act.ok', params: { what: tool } } };
}

function failedTool(base: Classified, e: HookEvent, input: Record<string, unknown>, m: Matchers): Classified {
  const tool = base.tool ?? '?';

  if (tool === 'Bash') {
    const command = text(input.command) ?? '';
    if (isTestCommand(command, m) && input.run_in_background !== true) {
      if (e.is_interrupt === true) {
        return {
          ...base,
          state: 'working',
          command,
          detail: { key: 'hub.detail.testsInterrupted' },
          summary: { key: 'hub.act.testsInterrupted', params: { command: short(command, 60) } },
        };
      }
      return {
        ...base,
        state: 'working',
        command,
        test: 'fail',
        detail: { key: 'hub.detail.testsRed' },
        summary: { key: 'hub.act.testsRed', params: { command: short(command, 60) } },
      };
    }
  }

  if (tool === 'AskUserQuestion') {
    return { ...base, state: 'working', detail: { key: 'hub.detail.questionCancelled' }, summary: { key: 'hub.detail.questionCancelled' } };
  }

  return { ...base, summary: { key: 'hub.act.toolFailed', params: { tool, error: short(text(e.error) ?? '', 60) } } };
}

function notification(base: Classified, e: HookEvent): Classified {
  const message = text(e.message) ?? '';
  switch (e.notification_type) {
    case 'permission_prompt':
    case 'elicitation_dialog':
      return {
        ...base,
        state: 'asking',
        detail: message ? short(message) : { key: 'hub.detail.awaitingAnswer' },
        summary: { key: 'hub.act.awaits', params: { message: short(message, 60) } },
      };
    case 'idle_prompt':
      return { ...base, state: 'idle', detail: { key: 'hub.detail.waiting' }, summary: { key: 'hub.act.awaitingUser' } };
    default:
      return { ...base, summary: { key: 'hub.act.notice', params: { message: short(message, 60) } } };
  }
}
