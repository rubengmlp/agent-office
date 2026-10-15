import { basename } from 'node:path';
import type { AgentState, HookEvent } from './types';

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
  detail: string;
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
  spawned: { toolUseId: string; agentId: string } | null;
  task: TaskInfo | null;
  teammate: string | null;
  team: string | null;
  summary: string;
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
    summary: e.hook_event_name,
  };
  const input = record(e.tool_input);

  switch (e.hook_event_name) {
    case 'SessionStart':
      return { ...base, state: 'idle', detail: 'esperando', summary: `sesión iniciada (${text(e.source) ?? 'startup'})` };
    case 'UserPromptSubmit':
      return { ...base, state: 'working', detail: 'pensando', unblock: true, summary: 'nuevo turno' };
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
        detail: `permiso: ${base.tool ?? '?'}`,
        summary: `pide permiso para ${base.tool ?? '?'}`,
      };
    case 'Notification':
      return notification(base, e);
    case 'SubagentStart':
      return { ...base, state: 'working', detail: 'empieza', summary: `empieza ${base.role ?? 'subagente'}` };
    case 'SubagentStop':
      return {
        ...base,
        state: 'done',
        ended: true,
        detail: short(text(e.last_assistant_message) ?? 'terminado', 120),
        summary: 'termina',
      };
    case 'Stop':
      return { ...base, state: 'idle', detail: 'esperando', summary: 'fin de turno' };
    case 'SessionEnd':
      return {
        ...base,
        state: 'done',
        ended: true,
        sessionEnded: true,
        detail: text(e.reason) ?? 'fin',
        summary: `sesión terminada (${text(e.reason) ?? '?'})`,
      };
    case 'TeammateIdle': {
      const name = text(e.teammate_name);
      const agentKey = e.agent_id ?? (name ? `${name}@${base.team ?? e.session_id}` : e.session_id);
      return {
        ...base,
        agentKey,
        parentKey: agentKey === e.session_id ? null : e.session_id,
        state: 'idle',
        detail: 'esperando',
        teammate: name,
        summary: `${name ?? 'compañero'} queda libre`,
      };
    }
    case 'TaskCreated':
      return {
        ...base,
        task: { taskId: idText(e.task_id), subject: text(e.task_subject), owner: null, status: 'pending' },
        teammate: text(e.teammate_name),
        summary: `tarea creada: ${short(text(e.task_subject) ?? '', 60)}`,
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
    if (m.test.test(command)) {
      return { ...working, state: 'testing', command, test: 'start', detail: short(command), summary: `tests: ${short(command, 60)}` };
    }
    if (m.check.test(command)) {
      return { ...working, state: 'checking', command, detail: short(command), summary: `revisa: ${short(command, 60)}` };
    }
    return { ...working, state: 'working', command, detail: short(command), summary: `ejecuta: ${short(command, 60)}` };
  }

  if (EDIT_TOOLS.has(tool)) {
    const filePath = text(input.file_path) ?? text(input.notebook_path);
    const name = filePath ? basename(filePath) : tool;
    return { ...working, state: 'working', filePath, detail: name, summary: `edita ${name}` };
  }

  if (READ_TOOLS.has(tool)) {
    const filePath = text(input.file_path) ?? text(input.path);
    const what = filePath ? basename(filePath) : (text(input.pattern) ?? text(input.url) ?? text(input.query) ?? tool);
    return { ...working, state: 'reading', filePath, detail: short(what), summary: `lee ${short(what, 60)}` };
  }

  if (tool === 'AskUserQuestion') {
    const questions = Array.isArray(input.questions) ? input.questions : [];
    const first = text(record(questions[0]).question) ?? 'pregunta';
    return { ...working, state: 'asking', detail: short(first), summary: `pregunta: ${short(first, 60)}` };
  }

  if (tool === 'SendMessage') {
    const to = text(input.to) ?? '?';
    const body = text(input.message) ?? '';
    const blocked = BLOCK_PREFIX.test(body);
    return {
      ...base,
      state: blocked ? 'blocked' : 'talking',
      message: { to, text: body },
      blocked: blocked ? short(body, 160) : null,
      unblock: !blocked,
      detail: `→ ${to}`,
      summary: `${blocked ? 'avisa de un bloqueo' : 'escribe'} a ${to}: ${short(body || text(input.summary) || '', 60)}`,
    };
  }

  if (SPAWN_TOOLS.has(tool)) {
    const spawnCall: SpawnCall = {
      toolUseId: e.tool_use_id ?? '',
      name: text(input.name),
      description: text(input.description),
      subagentType: text(input.subagent_type),
    };
    const who = spawnCall.name ?? spawnCall.subagentType ?? 'subagente';
    return {
      ...working,
      state: 'working',
      spawnCall,
      detail: `delega: ${short(spawnCall.description ?? who, 60)}`,
      summary: `delega en ${who}`,
    };
  }

  if (tool === 'TaskCreate' || tool === 'TaskUpdate') {
    const task: TaskInfo = {
      taskId: idText(input.taskId) ?? idText(input.task_id) ?? idText(input.id),
      subject: text(input.subject),
      owner: text(input.owner),
      status: text(input.status),
    };
    const label = tool === 'TaskCreate' ? `crea tarea: ${short(task.subject ?? '', 50)}` : `actualiza tarea ${task.taskId ?? ''}`;
    return { ...working, state: 'working', task, detail: label.trim(), summary: label.trim() };
  }

  return { ...working, state: 'working', detail: tool, summary: tool };
}

function postTool(base: Classified, e: HookEvent, input: Record<string, unknown>, m: Matchers): Classified {
  const tool = base.tool ?? '?';

  if (tool === 'Bash') {
    const command = text(input.command) ?? '';
    if (m.test.test(command)) {
      return { ...base, state: 'working', command, test: 'pass', detail: 'tests en verde', summary: `tests en verde: ${short(command, 60)}` };
    }
    return { ...base, command, summary: `ok: ${short(command, 60)}` };
  }

  if (EDIT_TOOLS.has(tool)) {
    const filePath = text(input.file_path) ?? text(input.notebook_path);
    return { ...base, filePath, edit: filePath ?? '', summary: `editado ${filePath ? basename(filePath) : tool}` };
  }

  if (SPAWN_TOOLS.has(tool)) {
    const response = record(e.tool_response);
    const agentId = idText(response.agentId) ?? idText(response.agent_id);
    return {
      ...base,
      spawned: agentId && e.tool_use_id ? { toolUseId: e.tool_use_id, agentId } : null,
      summary: 'subagente en marcha',
    };
  }

  if (tool === 'TaskCreate') {
    const response = record(e.tool_response);
    const taskId = idText(response.taskId) ?? idText(record(response.task).id) ?? idText(response.id);
    return {
      ...base,
      task: { taskId, subject: text(input.subject), owner: text(input.owner), status: 'pending' },
      summary: taskId ? `tarea ${taskId} creada` : 'tarea creada',
    };
  }

  if (tool === 'AskUserQuestion') {
    return { ...base, state: 'working', detail: 'pensando', summary: 'pregunta respondida' };
  }

  return { ...base, summary: `ok: ${tool}` };
}

function failedTool(base: Classified, e: HookEvent, input: Record<string, unknown>, m: Matchers): Classified {
  const tool = base.tool ?? '?';

  if (tool === 'Bash') {
    const command = text(input.command) ?? '';
    if (m.test.test(command)) {
      if (e.is_interrupt === true) {
        return { ...base, state: 'working', command, detail: 'tests interrumpidos', summary: `tests interrumpidos: ${short(command, 60)}` };
      }
      return { ...base, state: 'working', command, test: 'fail', detail: 'tests en rojo', summary: `tests en rojo: ${short(command, 60)}` };
    }
  }

  if (tool === 'AskUserQuestion') {
    return { ...base, state: 'working', detail: 'pregunta cancelada', summary: 'pregunta cancelada' };
  }

  return { ...base, summary: `falla ${tool}: ${short(text(e.error) ?? '', 60)}` };
}

function notification(base: Classified, e: HookEvent): Classified {
  const message = text(e.message) ?? '';
  switch (e.notification_type) {
    case 'permission_prompt':
    case 'elicitation_dialog':
      return { ...base, state: 'asking', detail: short(message || 'espera respuesta'), summary: `espera: ${short(message, 60)}` };
    case 'idle_prompt':
      return { ...base, state: 'idle', detail: 'esperando', summary: 'esperando al usuario' };
    default:
      return { ...base, summary: `aviso: ${short(message, 60)}` };
  }
}
