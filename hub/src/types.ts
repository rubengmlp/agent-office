export type Stack = 'flutter' | 'laravel' | 'node' | 'generic';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// Text the hub shows in the panel. A string is raw text shown as is (commands, paths, names, what agents wrote,
// old recordings); an object is a key of the panel dictionary (ui/src/i18n) with its parameters, which may be
// HubText themselves. The panel translates it, so the same payload serves every language.
export type HubTextParams = {
  'hub.detail.waiting': undefined;
  'hub.detail.thinking': undefined;
  'hub.detail.permission': { tool: string };
  'hub.detail.starting': undefined;
  'hub.detail.finished': undefined;
  'hub.detail.end': undefined;
  'hub.detail.testsGreen': undefined;
  'hub.detail.testsRed': undefined;
  'hub.detail.testsInterrupted': undefined;
  'hub.detail.questionCancelled': undefined;
  'hub.detail.awaitingAnswer': undefined;
  'hub.detail.delegates': { what: HubText };
  'hub.detail.createsTask': { subject: string };
  'hub.detail.updatesTask': { id: string };
  'hub.detail.noAnswer': { detail: HubText };
  'hub.detail.blocked': undefined;
  'hub.detail.checking': undefined;
  'hub.detail.tests': undefined;
  'hub.detail.question': undefined;
  'hub.detail.delegatesTo': { who: HubText; what: string };
  'hub.detail.asks': { question: HubText };
  'hub.detail.answerReceived': undefined;
  'hub.detail.verdictApproved': undefined;
  'hub.detail.verdictImprove': undefined;
  'hub.detail.verdictNoAgreement': undefined;
  'hub.detail.waitingFor': { who: string; what: string };

  'hub.act.sessionStart': { source: string };
  'hub.act.newTurn': undefined;
  'hub.act.permission': { tool: string };
  'hub.act.subagentStart': { who: HubText };
  'hub.act.done': undefined;
  'hub.act.turnEnd': undefined;
  'hub.act.sessionEnd': { reason: string };
  'hub.act.teammateIdle': { who: HubText };
  'hub.act.taskCreated': { subject: string };
  'hub.act.tests': { command: string };
  'hub.act.check': { command: string };
  'hub.act.run': { command: string };
  'hub.act.edit': { name: string };
  'hub.act.read': { what: string };
  'hub.act.question': { text: HubText };
  'hub.act.message': { to: string; text: string };
  'hub.act.blockedMessage': { to: string; text: string };
  'hub.act.delegate': { who: HubText };
  'hub.act.taskCreate': { subject: string };
  'hub.act.taskUpdate': { id: string };
  'hub.act.ok': { what: string };
  'hub.act.testsGreen': { command: string };
  'hub.act.edited': { name: string };
  'hub.act.subagentRunning': undefined;
  'hub.act.taskCreatedId': { id: string };
  'hub.act.taskCreatedPlain': undefined;
  'hub.act.questionAnswered': undefined;
  'hub.act.testsInterrupted': { command: string };
  'hub.act.testsRed': { command: string };
  'hub.act.toolFailed': { tool: string; error: string };
  'hub.act.awaits': { message: string };
  'hub.act.awaitingUser': undefined;
  'hub.act.notice': { message: string };
  'hub.act.taskClosed': { subject: string };
  'hub.act.taskBlocked': { subject: string };
  'hub.act.doneAccepted': { text: string };
  'hub.act.doneBlocked': undefined;
  'hub.act.guardBlocked': { who: string; target: string };
  'hub.act.order': { text: string };
  'hub.act.planDiscarded': { path: string };
  'hub.act.sourcesReady': { slug: string; floors: string };
  'hub.act.sourcesForeign': { n: number; dirs: string };
  'hub.act.guardAlert.one': { level: HubText; n: number; floor: string; who: string };
  'hub.act.guardAlert.other': { level: HubText; n: number; floor: string; who: string };
  'hub.act.memoryDelivered': { lessons: number; reports: number };
  'hub.act.deliveryAccepted': { path: string };
  'hub.act.deliveryBlockedStale': { path: string };
  'hub.act.deliveryBlockedNoPath': undefined;
  'hub.act.reviewRequested': { path: string; round: HubText };
  'hub.act.verdictApproved': { path: string; round: HubText; score: HubText };
  'hub.act.verdictImprove': { path: string; round: HubText; score: HubText };
  'hub.act.verdictNoAgreement': { path: string; round: HubText; score: HubText };
  'hub.act.commitFailed': { path: string; root: string };
  'hub.act.lessonSaved': { role: HubText; floor: HubText };
  'hub.act.lessonDuplicate': undefined;
  'hub.act.lessonCap': { max: number };
  'hub.act.lessonEmpty': undefined;
  'hub.act.permissionWaiting': { detail: string };
  'hub.act.questionWaiting': undefined;
  'hub.act.floorRemoved': { slug: string };
  'hub.act.asks': { to: string; question: HubText };
  'hub.act.planExecuting': { path: string };
  'hub.act.planAnalysisSent': { path: string };
  'hub.act.planParked': { path: string };
  'hub.act.planClosed': { path: string };
  'hub.act.planNotice': { to: string; path: string };
  'hub.act.verdictIgnored': { who: string; path: string };
  'hub.act.retiredIgnored': { who: string };

  'hub.act.reviewBlockedOverMax': { path: string; round: number; max: number };
  'hub.act.reviewIgnoredOverMax': { path: string; round: number; max: number };
  'hub.act.reviewBlockedTooLong': { path: string; kb: number; max: number };
  'hub.act.reviewIgnoredTooLong': { path: string; kb: number; max: number };
  'hub.act.readCapReached': { who: string; n: number };
  'hub.act.splitRequested': { who: string; path: string };
  'hub.act.briefsCapped': { n: number; max: number };
  'hub.act.rulesReloaded': { who: string };
  'hub.act.relaunched': { who: string };
  'hub.act.waitingDeclared': { who: string; to: string; what: string };
  'hub.act.stalled': { who: string; minutes: number };
  'hub.act.statusRequested': { who: string };
  'hub.act.chatPost': { who: string; channel: string; text: string };
  'hub.act.chatClaim': { who: string; channel: string; files: string };
  'hub.act.chatRelease': { who: string; channel: string; files: string };
  'hub.act.chatUser': { channel: string; text: string };
  'hub.act.chatCommand': undefined;
  'hub.round': { n: number };
  'hub.score': { n: number };

  'hub.who.subagent': undefined;
  'hub.who.teammate': undefined;
  'hub.role.director': undefined;
  'hub.role.lead': undefined;
  'hub.role.dev': undefined;
  'hub.role.tester': undefined;
  'hub.role.reviewer': undefined;
  'hub.role.redactor': undefined;
  'hub.role.revisor-planes': undefined;
  'hub.role.artesano': undefined;
  'hub.role.revisor-skills': undefined;
  'hub.floor.direccion': undefined;
  'hub.floor.redaccion': undefined;
  'hub.floor.mantenimiento': undefined;
  'hub.floor.other': { slug: string };
  'hub.alertLevel.alerta': undefined;
  'hub.alertLevel.posible': undefined;

  'hub.permission.bash': { who: string };
  'hub.permission.edit': { who: string };
  'hub.permission.read': { who: string };
  'hub.permission.web': { who: string };
  'hub.permission.other': { who: string; tool: string };

  'hub.report.counts': { files: HubText; tests: HubText };
  'hub.report.files.one': { n: number };
  'hub.report.files.other': { n: number };
  'hub.report.tests.one': { n: number };
  'hub.report.tests.other': { n: number };
  'hub.report.lastMessage': { to: string; text: string };
  'hub.report.empty': undefined;

  'hub.settings.saved': undefined;
  'hub.settings.noChanges': undefined;
  'hub.settings.regenerateFailed': { slug: string; error: HubText };
  'hub.settings.unknownRole': { id: string };
  'hub.settings.badModel': { id: string };
  'hub.settings.badEffort': { id: string };
  'hub.settings.badDepartment': { key: string };
  'hub.settings.badRange': { key: string; min: number; max: number };
  'hub.settings.noFloor': { slug: string };
  'hub.settings.badBranch': { branch: string; slug: string };
  'hub.settings.noTarget': { slug: string };
  'hub.settings.badPermissionMode': { slug: string };
  'hub.settings.roleNotOnFloor': { id: string; slug: string };
  'hub.settings.badFloorRole': { id: string; slug: string };
  'hub.settings.badFloorModel': { id: string; slug: string };
  'hub.settings.badFloorEffort': { id: string; slug: string };

  'hub.api.questionClosed': undefined;
  'hub.api.answerMissing': undefined;
  'hub.api.orderFields': undefined;
  'hub.api.orderTooLong': undefined;
  'hub.api.sessionNotFound': undefined;
  'hub.api.sessionNotOffice': undefined;
  'hub.api.orderFailed': undefined;
  'hub.api.settingsUnavailable': undefined;
  'hub.api.floorsUnavailable': undefined;
  'hub.api.badMemoryTarget': undefined;
  'hub.api.badId': undefined;
  'hub.api.lessonNotFound': undefined;
  'hub.api.noReport': undefined;
  'hub.api.documentNotFound': undefined;
  'hub.api.pathRequired': undefined;
  'hub.api.planClosed': undefined;
  'hub.api.planNotFound': undefined;
  'hub.api.decisionFields': undefined;
  'hub.api.planBadState': undefined;
  'hub.api.directorClosed': undefined;
  'hub.api.directorUnreachable': undefined;
  'hub.api.floorRequired': undefined;
  'hub.api.roleInvalid': undefined;
  'hub.api.lessonEmpty': undefined;
  'hub.api.lessonDuplicate': undefined;
  'hub.api.lessonSaveFailed': undefined;
  'hub.api.chatFields': undefined;
  'hub.api.chatTooLong': undefined;
  'hub.api.chatKind': undefined;
  'hub.api.usageRange': undefined;
  'hub.api.chatAuthorUnknown': undefined;
  'hub.api.chatFloorUnknown': undefined;
  'hub.api.chatChannelUnknown': undefined;
  'hub.api.chatChannelForbidden': undefined;
  'hub.api.chatSessionUnknown': undefined;
  'hub.api.relaunchBusy': undefined;
  'hub.api.relaunchNoWindow': undefined;
  'hub.api.relaunchNoTmux': undefined;
  'hub.api.relaunchNoScript': undefined;
  'hub.api.relaunchFailed': undefined;
  'hub.api.panelLinkInvalid': undefined;

  'hub.doc.tooLarge': undefined;

  'hub.floors.pathRequired': undefined;
  'hub.floors.notFound': { slug: string };
  'hub.floors.conflictManaged': { path: string; slug: string };
  'hub.floors.inUse': { slug: string; sessions: string };
  'hub.floors.removing': { slug: string };
  'hub.floors.added': { slug: string; startCommand: string };
  'hub.floors.notGitRepo': { path: string };
  'hub.floors.insideRepo': { path: string; top: string };
  'hub.floors.slugInvalid': { slug: string };
  'hub.floors.slugReserved': { slug: string };
  'hub.floors.missing': { path: string };
  'hub.floors.notDir': { path: string };
  'hub.floors.liveCopy': { path: string };
  'hub.floors.slugTaken': { slug: string; path: string };
  'hub.floors.pathTaken': { path: string; other: string };
};

export type HubTextKey = keyof HubTextParams;

type HubTextOf<K extends HubTextKey> = HubTextParams[K] extends undefined ? { key: K; params?: undefined } : { key: K; params: HubTextParams[K] };

export type HubText = string | { [K in HubTextKey]: HubTextOf<K> }[HubTextKey];

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

export type PermissionMode = 'auto' | 'manual' | 'acceptEdits' | 'plan' | 'dontAsk';

export type Profile = {
  label: string;
  skill: string | null;
  testRegex: string;
  checkRegex: string;
  testCommand: string;
};

export type FloorConfig = { path: string; stack: Stack; managed: boolean; baseBranch: string };

export type DepartmentsConfig = { redaccion: boolean; mantenimiento: boolean };

export type ReviewConfig = { maxRounds: number; maxPlanBytes: number; maxReviewerReads: number };

export type LimitsConfig = { maxBriefsPerOrder: number; stalledAfterMinutes: number };

export type MemoryConfig = { maxLessons: number; maxLessonsPerSession: number; maxContextChars: number };

export type FloorRoles = Record<string, Partial<Record<RoleId, RoleSettings>>>;

export type OfficeConfig = {
  configVersion: number;
  floors: Record<string, FloorConfig>;
  roles: Record<RoleId, RoleSettings>;
  floorRoles: FloorRoles;
  docsRepo: string;
  departments: DepartmentsConfig;
  review: ReviewConfig;
  memory: MemoryConfig;
  limits: LimitsConfig;
  permissionModes: Record<string, PermissionMode>;
  blockedAfterMinutes: number;
  leaveAfterMinutes: number;
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
  detail: HubText;
  tool: string | null;
  lastTest: TestResult | null;
  stateSince: number;
  updatedAt: number;
  endedAt: number | null;
  file: string | null;
  task: string | null;
  away: boolean;
  tokens: TokenTotals | null;
  waiting: { who: string; what: string; since: number } | null;
  stalledSince: number | null;
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

export type QuestionKind = 'ask' | 'permission';

export type QuestionView = {
  id: string;
  kind?: QuestionKind;
  detail?: string;
  tool?: string;
  // What the panel shows above the options (permissions); questions[0].question stays the answer key.
  prompt?: HubText;
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

export type ChatKind = 'texto' | 'toca' | 'listo' | 'pregunta';

export type ChatOrigin = 'agent' | 'user';

export type ChatMessageView = {
  id: number;
  ts: number;
  channel: string;
  floor: string;
  authorKey: string;
  authorName: string;
  role: string | null;
  roleId: RoleId | null;
  origin: ChatOrigin;
  kind: ChatKind;
  text: string;
  files: string[];
};

export type ChatClaimView = { file: string; authorKey: string; authorName: string; ts: number; id: number };

export type ChatPostRequest = { channel: string; kind?: ChatKind; text: string; files?: string[]; from?: string; cwd?: string };

export type ChatPostResult = { ok: true; message: ChatMessageView; warnings: ChatClaimView[] } | { ok: false; status: 400 | 403 | 404; error: HubText };

export type ChatUserResult = { message: ChatMessageView; delivered: number };

export type SessionView = {
  sessionId: string;
  agentKey: string;
  name: string | null;
  role: string | null;
  floor: string;
  canReceive: boolean;
  endedAt: number | null;
  needsRelaunch: boolean;
  rulesPending: boolean;
  canRelaunch: boolean;
  relaunchResumes: boolean;
  office: boolean;
};

export type ActivityView = {
  ts: number;
  agentKey: string;
  event: string;
  tool: string | null;
  state: AgentState | null;
  summary: HubText;
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
  // summary is what agents read (Spanish); summaryText is the same in panel form, or null when it is agent text.
  summary: string;
  summaryText?: HubText | null;
  files: string[];
  tests: { ok: boolean; ts: number; command: string }[];
  verdicts: { kind: VerdictKind; ts: number; path: string | null; round: number | null; score: number | null }[];
  sent: { ts: number; to: string; text: string | null }[];
  received: { ts: number; from: string; text: string | null }[];
  questions: number;
  blocked: number;
  lessons: string[];
  closing: string | null;
  tokens: TokenTotals | null;
};

export type DocumentKind = 'plan' | 'skill';

export type DocumentType = 'implementacion' | 'analisis';

export type DocumentStatus =
  | 'borrador'
  | 'revision'
  | 'aprobado'
  | 'sin-acuerdo'
  | 'entregado'
  | 'aparcado'
  | 'ejecutando'
  | 'cerrado'
  | 'descartado';

export type PlanDecision = 'ejecutar' | 'aparcar' | 'cerrar';

export type DocumentBase = { floor: string; ref: string; sha: string; date: string | null; stale: boolean };

export type DocumentAhead = { floor: string; commits: number; files: string[] };

export type DocumentView = {
  path: string;
  kind: DocumentKind;
  slug: string;
  title: string;
  docType: DocumentType;
  status: DocumentStatus;
  round: number;
  maxRounds: number;
  score: number | null;
  updatedAt: number;
  deliveredAt: number | null;
  decidedAt: number | null;
  base: DocumentBase[];
  ahead: DocumentAhead[];
  installedAt: string[];
  tokens: TokenTotals | null;
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

export type SettingsTarget = { id: string; label: string; stack: Stack | null; roles: RoleId[] };

export type SettingsView = {
  roles: Record<RoleId, RoleSettings>;
  floorRoles: FloorRoles;
  targets: SettingsTarget[];
  departments: DepartmentsConfig;
  review: ReviewConfig;
  memory: MemoryConfig;
  limits: LimitsConfig;
  docsRepo: string;
  port: number;
  permissionModes: Record<string, PermissionMode>;
  leaveAfterMinutes: number;
  floors: { slug: string; path: string; stack: Stack; managed: boolean; baseBranch: string }[];
};

export type SettingsUpdate = {
  roles?: Partial<Record<RoleId, Partial<RoleSettings>>>;
  floorRoles?: Record<string, Partial<Record<RoleId, Partial<RoleSettings> | null>>>;
  departments?: Partial<DepartmentsConfig>;
  review?: Partial<ReviewConfig>;
  memory?: Partial<MemoryConfig>;
  limits?: Partial<LimitsConfig>;
  floors?: Record<string, { baseBranch?: string }>;
  permissionModes?: Record<string, PermissionMode>;
  leaveAfterMinutes?: number;
};

export type SettingsResult = { ok: true; regenerated: number; note: HubText[] } | { ok: false; error: HubText[] };

export type FloorAddRequest = { path: string; slug?: string };

export type FloorErrorStatus = 400 | 404 | 409 | 500;

export type FloorFailure = { ok: false; status: FloorErrorStatus; error: HubText };

export type FloorAddResult = { ok: true; slug: string; path: string; stack: Stack; startCommand: string; note: HubText } | FloorFailure;

export type FloorRemoveResult = { ok: true; slug: string; removed: { files: number; rows: number; worktrees: number } } | FloorFailure;

export type MemoryView = { floor: string; role: RoleId; lessons: LessonView[]; reports: ReportView[] };

export type LessonCreate = { floor: string; role: RoleId; text: string };

export type DocumentContent = { path: string; kind: DocumentKind; markdown: string; notice?: HubText };

export type UsageWindow = { usedPct: number; resetsAt: number };

export type UsageView = { fiveHour: UsageWindow | null; sevenDay: UsageWindow | null; at: number | null };

export type TokenTotals = { turns: number; input: number; cacheRead: number; cacheCreate: number; output: number };

export type TokenRow = { key: string; tokens: TokenTotals; agents: number };

export type UsageRange = 'today' | 'week';

export type UsageSummary = {
  range: UsageRange;
  from: string;
  to: string;
  total: { tokens: TokenTotals; agents: number };
  byRole: TokenRow[];
  byModel: TokenRow[];
  byFloor: TokenRow[];
  byPlan: TokenRow[];
};

export type TokensEvent = { agentKey: string; tokens: TokenTotals; plan: { slug: string; tokens: TokenTotals } | null };

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
  usage: UsageView;
  chat: ChatMessageView[];
};

export type ServerMessage =
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'floors'; data: FloorView[] }
  | { type: 'agent'; data: AgentView }
  | { type: 'agent-gone'; key: string }
  | { type: 'session'; data: SessionView }
  | { type: 'question'; data: QuestionView }
  | { type: 'question-closed'; id: string; outcome: QuestionOutcome }
  | { type: 'message'; data: MessageView }
  | { type: 'activity'; data: ActivityView }
  | { type: 'documents'; data: DocumentView[] }
  | { type: 'alert'; data: GuardAlert }
  | { type: 'memory'; floor: string; role: RoleId }
  | { type: 'settings'; data: SettingsView }
  | { type: 'usage'; data: UsageView }
  | { type: 'tokens'; data: TokensEvent }
  | { type: 'chat'; data: ChatMessageView };

export type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'heartbeat'; visible: boolean };

export type Recording = {
  version: 1;
  startedAt: number;
  messages: { t: number; msg: ServerMessage }[];
};

export type AnswerRequest = { answers: Record<string, string> } | { release: true };

export type OrderRequest = { sessionId: string; text: string };

export type PlanDecisionRequest = { path: string; decision: PlanDecision };
