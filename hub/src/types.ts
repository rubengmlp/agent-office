export type Stack = 'flutter' | 'laravel' | 'node' | 'generic';

export type Profile = {
  label: string;
  skill: string | null;
  testRegex: string;
  checkRegex: string;
  testCommand: string;
};

export type FloorConfig = { path: string; stack: Stack; managed: boolean };

export type OfficeConfig = {
  floors: Record<string, FloorConfig>;
  blockedAfterMinutes: number;
  retentionDays: number;
  port: number;
};

export type HookEvent = {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  transcript_path?: string;
  permission_mode?: string;
  agent_id?: string;
  agent_type?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown;
  tool_use_id?: string;
  error?: string;
  is_interrupt?: boolean;
  source?: string;
  reason?: string;
  prompt?: string;
  message?: string;
  notification_type?: string;
  last_assistant_message?: string;
  teammate_name?: string;
  team_name?: string;
  task_id?: string;
  task_subject?: string;
  task_description?: string;
  [key: string]: unknown;
};

export type HookMeta = {
  socket: string | null;
  token: string | null;
  role: string | null;
  name: string | null;
};

export type AgentState =
  | 'idle'
  | 'working'
  | 'reading'
  | 'testing'
  | 'checking'
  | 'asking'
  | 'talking'
  | 'blocked'
  | 'done'
  | 'failed';

export type RoleKind = 'director' | 'lead' | 'dev' | 'tester' | 'reviewer' | 'intern';

export type FloorKind = 'direccion' | 'managed' | 'observed';

export type TestResult = { ok: boolean; ts: number; command: string };

export type AgentView = {
  key: string;
  sessionId: string;
  parentKey: string | null;
  name: string | null;
  role: string | null;
  roleKind: RoleKind;
  floor: string;
  touchedFloor: string | null;
  state: AgentState;
  detail: string;
  tool: string | null;
  lastTest: TestResult | null;
  stateSince: number;
  updatedAt: number;
  endedAt: number | null;
};

export type FloorView = {
  slug: string;
  label: string;
  path: string | null;
  stack: Stack;
  kind: FloorKind;
};

export type AskOption = { label: string; description?: string };

export type AskQuestion = {
  question: string;
  header?: string;
  options: AskOption[];
  multiSelect?: boolean;
};

export type QuestionView = {
  id: string;
  agentKey: string;
  sessionId: string;
  floor: string;
  questions: AskQuestion[];
  createdAt: number;
  expiresAt: number;
};

export type QuestionOutcome = 'answered' | 'released' | 'expired';

export type MessageView = {
  id: number;
  ts: number;
  fromKey: string;
  toName: string;
  toKey: string | null;
  text: string | null;
  floor: string;
};

export type SessionView = {
  sessionId: string;
  agentKey: string;
  name: string | null;
  role: string | null;
  floor: string;
  canReceive: boolean;
  endedAt: number | null;
};

export type ActivityView = {
  ts: number;
  agentKey: string;
  event: string;
  tool: string | null;
  state: AgentState | null;
  summary: string;
};

export type Snapshot = {
  now: number;
  floors: FloorView[];
  agents: AgentView[];
  sessions: SessionView[];
  questions: QuestionView[];
  messages: MessageView[];
  activity: ActivityView[];
};

export type ServerMessage =
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'floors'; data: FloorView[] }
  | { type: 'agent'; data: AgentView }
  | { type: 'session'; data: SessionView }
  | { type: 'question'; data: QuestionView }
  | { type: 'question-closed'; id: string; outcome: QuestionOutcome }
  | { type: 'message'; data: MessageView }
  | { type: 'activity'; data: ActivityView };

export type ClientMessage =
  | { type: 'auth'; key: string }
  | { type: 'heartbeat'; visible: boolean };

export type Recording = {
  version: 1;
  startedAt: number;
  messages: { t: number; msg: ServerMessage }[];
};

export type AnswerRequest = { answers: Record<string, string> } | { release: true };

export type OrderRequest = { sessionId: string; text: string };
