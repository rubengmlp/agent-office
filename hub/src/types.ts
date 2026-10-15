export type Stack = 'flutter' | 'laravel' | 'node' | 'generic';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type RoleId =
  | 'director'
  | 'lead'
  | 'dev'
  | 'tester'
  | 'reviewer'
  | 'redactor'
  | 'revisor-planes'
  | 'artesano'
  | 'revisor-skills';

export type RoleSettings = { model: string; effort: Effort };

export type Profile = {
  label: string;
  skill: string | null;
  testRegex: string;
  checkRegex: string;
  testCommand: string;
};

export type FloorConfig = { path: string; stack: Stack; managed: boolean; baseBranch: string };

export type DepartmentsConfig = { redaccion: boolean; mantenimiento: boolean };

export type ReviewConfig = { maxRounds: number };

export type MemoryConfig = { maxLessons: number; maxLessonsPerSession: number; maxContextChars: number };

export type OfficeConfig = {
  floors: Record<string, FloorConfig>;
  roles: Record<RoleId, RoleSettings>;
  docsRepo: string;
  departments: DepartmentsConfig;
  review: ReviewConfig;
  memory: MemoryConfig;
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
  session_title?: string;
  model?: string;
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

export type RoleKind =
  | 'director'
  | 'lead'
  | 'dev'
  | 'tester'
  | 'reviewer'
  | 'writer'
  | 'planReviewer'
  | 'skillwright'
  | 'skillReviewer'
  | 'intern';

export type FloorKind = 'direccion' | 'managed' | 'observed' | 'redaccion' | 'mantenimiento';

export type Building = 'principal' | 'mantenimiento';

export type TestResult = { ok: boolean; ts: number; command: string };

export type AgentView = {
  key: string;
  sessionId: string;
  parentKey: string | null;
  name: string | null;
  role: string | null;
  roleId: RoleId | null;
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
  building: Building;
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

export type VerdictKind = 'tests' | 'approved' | 'improve' | 'no-agreement';

export type LessonOrigin = 'agent' | 'user';

export type LessonView = {
  id: number;
  floor: string;
  role: RoleId;
  text: string;
  origin: LessonOrigin;
  agentKey: string | null;
  createdAt: number;
};

export type ReportView = {
  agentKey: string;
  name: string | null;
  role: string | null;
  roleId: RoleId | null;
  floor: string;
  startedAt: number;
  endedAt: number | null;
  live: boolean;
  summary: string;
  files: string[];
  tests: { ok: boolean; ts: number; command: string }[];
  verdicts: { kind: VerdictKind; ts: number; path: string | null; round: number | null; score: number | null }[];
  sent: { ts: number; to: string; text: string | null }[];
  received: { ts: number; from: string; text: string | null }[];
  questions: number;
  blocked: number;
  lessons: string[];
  closing: string | null;
};

export type DocumentKind = 'plan' | 'skill';

export type DocumentStatus = 'borrador' | 'revision' | 'aprobado' | 'sin-acuerdo' | 'cerrado' | 'descartado';

export type DocumentBase = { floor: string; ref: string; sha: string; date: string | null; stale: boolean };

export type DocumentAhead = { floor: string; commits: number; files: string[] };

export type DocumentView = {
  path: string;
  kind: DocumentKind;
  slug: string;
  title: string;
  status: DocumentStatus;
  round: number;
  score: number | null;
  updatedAt: number;
  base: DocumentBase[];
  ahead: DocumentAhead[];
  installedAt: string[];
};

export type GuardAlertLevel = 'alerta' | 'posible';

export type GuardAlert = {
  id: number;
  ts: number;
  level: GuardAlertLevel;
  floor: string;
  agentKey: string;
  files: string[];
};

export type SettingsView = {
  roles: Record<RoleId, RoleSettings>;
  departments: DepartmentsConfig;
  review: ReviewConfig;
  memory: MemoryConfig;
  docsRepo: string;
  port: number;
  floors: { slug: string; path: string; stack: Stack; managed: boolean; baseBranch: string }[];
};

export type SettingsUpdate = {
  roles?: Partial<Record<RoleId, Partial<RoleSettings>>>;
  departments?: Partial<DepartmentsConfig>;
  review?: Partial<ReviewConfig>;
  memory?: Partial<MemoryConfig>;
  floors?: Record<string, { baseBranch?: string }>;
};

export type SettingsResult = { ok: true; regenerated: number; note: string } | { ok: false; error: string };

export type MemoryView = { floor: string; role: RoleId; lessons: LessonView[]; reports: ReportView[] };

export type LessonCreate = { floor: string; role: RoleId; text: string };

export type DocumentContent = { path: string; kind: DocumentKind; markdown: string };

export type Snapshot = {
  now: number;
  floors: FloorView[];
  agents: AgentView[];
  sessions: SessionView[];
  questions: QuestionView[];
  messages: MessageView[];
  activity: ActivityView[];
  documents: DocumentView[];
  alerts: GuardAlert[];
};

export type ServerMessage =
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'floors'; data: FloorView[] }
  | { type: 'agent'; data: AgentView }
  | { type: 'session'; data: SessionView }
  | { type: 'question'; data: QuestionView }
  | { type: 'question-closed'; id: string; outcome: QuestionOutcome }
  | { type: 'message'; data: MessageView }
  | { type: 'activity'; data: ActivityView }
  | { type: 'documents'; data: DocumentView[] }
  | { type: 'alert'; data: GuardAlert }
  | { type: 'memory'; floor: string; role: RoleId }
  | { type: 'settings'; data: SettingsView };

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
