import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { CHAT_SCRIPT, managedFloors } from './agents';
import { ChatDesk, GLOBAL_CHANNEL, READ_LIMIT, SNAPSHOT_LIMIT, USER_NAME, isChatKind, normalizeChatPath, type ChatAuthor, type ChatError, type ChatUnread } from './chat';
import { CHAT_PREFIX, chatInboxText, deliver, encodeInbox, ORDER_LEAD, ORDER_PREFIX, orderText } from './courier';
import { commitDocument } from './docs-repo';
import { DocumentDesk } from './documents';
import { FloorInUseError, purgeFloorData } from './floor-data';
import {
  DIRECCION,
  FloorResolver,
  MANTENIMIENTO,
  REDACCION,
  isInside,
  memoryRegistry,
  realPath,
  type FloorRegistry,
  type GitRootFn,
  type ResolvedFloor,
} from './floors';
import { decideDocumentGate, decideGate, decideReviewGate, type GateDecision } from './gate';
import { GitQueue, runGit, type GitRunner } from './git';
import { GUARDED_TOOLS, GuardWatch, guardDecision, tokenize, zonesFor, type GuardContext, type GuardFinding } from './guard';
import { captureLesson, cleanLesson, deleteLesson, isRoleId, listLessons, memoryContext } from './memory';
import { isPrivate, publicDetail, publicSummary, publicText, storedPayload } from './privacy';
import { detectStack, profileFor, type Profiles } from './profiles';
import { docRef, parseProtocol, type DocRef } from './protocol';
import { PERMISSION_ALLOW, PERMISSION_DENY, QuestionDesk, parseQuestions } from './questions';
import { buildReport, saveReport, savedReport, savedReports } from './reports';
import {
  canonicalRole,
  contextFree,
  departmentOf,
  inOfficeScope,
  isAuthorRole,
  isDepartmentFloor,
  isLeadRole,
  isOfficeRole,
  isVerdictRole,
  remembers,
  roleFromName,
  roleIdOf,
  roleKind,
} from './scope';
import { settingsView } from './settings';
import {
  DONE_PREFIX,
  EDIT_TOOLS,
  classify,
  idText,
  record,
  short,
  text,
  type Classified,
  type Matchers,
  type SpawnCall,
} from './state-machine';
import { SyncDesk, type SyncResult } from './sync';
import { floorText, plural, roleText, roundText, scoreText } from './texts';
import { UsageDesk } from './usage';
import type {
  ActivityView,
  AgentState,
  AgentView,
  ChatMessageView,
  ChatPostRequest,
  ChatPostResult,
  ChatUserResult,
  DocumentContent,
  DocumentStatus,
  DocumentView,
  FloorKind,
  GuardAlert,
  HookEvent,
  HookMeta,
  HubText,
  LessonView,
  MemoryView,
  MessageView,
  OfficeConfig,
  PlanDecision,
  QuestionOutcome,
  QuestionView,
  ReportView,
  RoleId,
  ServerMessage,
  SessionView,
  Snapshot,
  Stack,
  TestResult,
  VerdictKind,
} from './types';

type AgentRuntime = {
  key: string;
  sessionId: string;
  parentKey: string | null;
  name: string | null;
  role: string | null;
  spawnType: string | null;
  teammate: boolean;
  team: string | null;
  floor: string;
  floorKind: FloorKind;
  touchedFloor: string | null;
  state: AgentState;
  stateSince: number;
  detail: HubText;
  tool: string | null;
  blockedReason: HubText | null;
  lastTest: TestResult | null;
  startedAt: number;
  closing: string | null;
  updatedAt: number;
  endedAt: number | null;
  sentState: AgentState | null;
  retiredAt: number | null;
  retiredAwake: boolean;
  awaitingAnswer: boolean;
  file: string | null;
  task: string | null;
  away: boolean;
};

type SessionRuntime = {
  sessionId: string;
  cwd: string | null;
  floor: string;
  floorKind: FloorKind;
  stack: Stack;
  role: string | null;
  name: string | null;
  socket: string | null;
  token: string | null;
  team: string | null;
  startedAt: number;
  updatedAt: number;
  endedAt: number | null;
};

type SessionRow = {
  session_id: string;
  cwd: string | null;
  role: string | null;
  name: string | null;
  socket: string | null;
  token: string | null;
  team: string | null;
  started_at: number;
  updated_at: number;
};

type TaskRow = { owner: string | null; status: string | null };

type AlertRow = { id: number; ts: number; level: string; floor: string; agent_key: string; files: string };

export type OrderResult = 'ok' | 'not-found' | 'unreachable' | 'failed';

export type LessonResult = { ok: true; lesson: LessonView } | { ok: false; status: number; error: HubText };

export type DiscardResult = 'ok' | 'not-found' | 'closed';

export type DecideResult = 'ok' | 'not-found' | 'invalid-state' | 'no-director' | 'unreachable' | 'failed';

const DECISION_FROM: Record<PlanDecision, readonly DocumentStatus[]> = {
  aparcar: ['entregado', 'ejecutando'],
  ejecutar: ['entregado', 'aparcado'],
  cerrar: ['ejecutando'],
};

const NOT_DISCARDABLE: ReadonlySet<DocumentStatus> = new Set<DocumentStatus>(['ejecutando', 'cerrado', 'descartado']);

export type OfficeOptions = {
  db: Database;
  config: OfficeConfig;
  profiles: Profiles;
  workspaceDir: string;
  claudeHome: string;
  registry?: FloorRegistry;
  gitRoot?: GitRootFn;
  stackOf?: (dir: string) => Stack;
  git?: GitRunner;
  rawDir?: string | null;
  holdMs?: number;
  now?: () => number;
  deliverFn?: typeof deliver;
  // Id of this hub, written in the marker of its snapshots in redaccion/.fuentes.
  hubId: string;
};

const MAX_ACTIVITY = 300;
const MAX_MESSAGES = 200;
const MAX_ALERTS = 50;
const FORGET_ENDED_MS = 10 * 60_000;
const RESTORE_WINDOW_MS = 24 * 60 * 60_000;
const MAX_SPAWNS = 500;
const TEAM_CACHE_MS = 5000;
const DAY_MS = 86_400_000;
const EMPTY_META: HookMeta = { socket: null, token: null, role: null, name: null };
const NO_TESTS: Matchers = { test: /(?!)/, check: /(?!)/ };
const NOT_PERMISSIONS: ReadonlySet<string> = new Set(['AskUserQuestion', 'ExitPlanMode']);
const TURN_OVER: ReadonlySet<string> = new Set(['SubagentStop', 'Stop', 'TeammateIdle', 'SessionEnd']);
const HOLDS_QUESTION: ReadonlySet<string> = new Set(['SubagentStop', 'Stop', 'TeammateIdle', 'Notification', 'PostToolUse', 'PostToolUseFailure']);
const ANSWERS_QUESTION: ReadonlySet<string> = new Set(['PreToolUse', 'UserPromptSubmit', 'SubagentStart']);
const NEW_TURN: ReadonlySet<string> = new Set(['UserPromptSubmit', 'SubagentStart']);
const FILE_TOOLS: ReadonlySet<string> = new Set([...EDIT_TOOLS, 'Read', 'NotebookRead']);
const LEAD_BUSY: ReadonlySet<AgentState> = new Set<AgentState>(['working', 'reading', 'testing', 'checking', 'talking']);
const TASK_MAX = 120;
const VERDICT_DETAILS: Record<Exclude<VerdictKind, 'tests'>, HubText> = {
  approved: { key: 'hub.detail.verdictApproved' },
  improve: { key: 'hub.detail.verdictImprove' },
  'no-agreement': { key: 'hub.detail.verdictNoAgreement' },
};
export const DISCARDED_MARK = '> **Descartado**';

export const ROLE_LABELS: Record<RoleId, string> = {
  director: 'director',
  lead: 'jefe',
  dev: 'desarrollador',
  tester: 'tester',
  reviewer: 'revisor de código',
  redactor: 'redactor',
  'revisor-planes': 'revisor de planes',
  artesano: 'artesano de skills',
  'revisor-skills': 'revisor de skills',
};

export function isHookEvent(value: unknown): value is HookEvent {
  const r = record(value);
  return typeof r.session_id === 'string' && r.session_id.length > 0 && typeof r.hook_event_name === 'string';
}

export function teamOfSession(sessionId: string): string {
  return `session-${sessionId.slice(0, 8)}`;
}

export function floorLabel(slug: string): string {
  if (slug === DIRECCION) return 'Dirección';
  if (slug === REDACCION) return 'Redacción';
  if (slug === MANTENIMIENTO) return 'Mantenimiento';
  return `la planta ${slug}`;
}

function isoDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export class Office {
  readonly desk: QuestionDesk;
  private config: OfficeConfig;
  private profiles: Profiles;
  private readonly floors: FloorResolver;
  private readonly agents = new Map<string, AgentRuntime>();
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly spawnCalls = new Map<string, SpawnCall>();
  private readonly spawnCallsByName = new Map<string, SpawnCall>();
  private readonly spawnedAgents = new Map<string, SpawnCall>();
  private readonly teammateIds = new Map<string, true>();
  private readonly activity: ActivityView[] = [];
  private readonly messages: MessageView[] = [];
  private readonly listeners = new Set<(msg: ServerMessage) => void>();
  private readonly teamCache = new Map<string, { at: number; members: Record<string, unknown>[] }>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly permissionHolds = new Map<string, { agentKey: string; match: string }>();
  private readonly docsQueue = new GitQueue();
  private readonly now: () => number;
  private readonly deliverFn: typeof deliver;
  private readonly git: GitRunner;
  private readonly sql: ReturnType<typeof prepare>;
  private readonly docs: DocumentDesk;
  private readonly sync: SyncDesk;
  private readonly watch: GuardWatch;
  private readonly usage: UsageDesk;
  readonly chat: ChatDesk;
  private readonly chatNudged = new Set<string>();
  private readonly chatWarned = new Set<string>();

  constructor(private readonly opts: OfficeOptions) {
    this.config = opts.config;
    this.profiles = opts.profiles;
    this.now = opts.now ?? Date.now;
    this.deliverFn = opts.deliverFn ?? deliver;
    this.git = opts.git ?? runGit;
    this.floors = new FloorResolver(
      () => this.config,
      opts.workspaceDir,
      opts.registry ?? memoryRegistry(),
      opts.gitRoot,
      opts.stackOf ?? detectStack,
    );
    this.sql = prepare(opts.db);
    this.desk = new QuestionDesk(
      {
        opened: (view) => this.questionOpened(view),
        closed: (id, outcome) => this.questionClosed(id, outcome),
      },
      opts.holdMs,
      this.now,
    );
    this.sync = new SyncDesk({
      db: opts.db,
      git: this.git,
      root: () => this.docsRoot(),
      floors: () => this.config.floors,
      now: this.now,
      onChange: () => this.refreshDocuments(),
      id: opts.hubId,
      onForeign: (dirs) =>
        this.pushActivity({
          ts: this.now(),
          agentKey: 'redaccion',
          event: 'Sync',
          tool: null,
          state: null,
          summary: { key: 'hub.act.sourcesForeign', params: { n: dirs.length, dirs: dirs.join(', ') } },
        }),
    });
    this.docs = new DocumentDesk({
      db: opts.db,
      root: () => this.docsRoot(),
      enabled: () => this.config.departments,
      installTargets: () => this.installTargets(),
      base: (slug) => this.sync.base(slug),
      ahead: (slug) => this.sync.ahead(slug),
      onChange: (docs) => this.emit({ type: 'documents', data: docs }),
      maxRounds: () => this.config.review.maxRounds,
    });
    this.watch = new GuardWatch({
      git: this.git,
      floors: () => this.guardFloors(),
      now: this.now,
      attributed: (floor, from, to) => this.attributedFiles(floor, from, to),
      active: (floor, from, to) => this.sql.floorActive.get(floor, from, to) !== null,
      exempt: (agentKey) => {
        const agent = this.agents.get(agentKey);
        const own = agent ? (zonesFor(agent.role, this.guardContext())?.allowed ?? []) : [];
        return [...own, ...this.installTargets().map((target) => realPath(target.dir))];
      },
      report: (finding) => this.recordAlert(finding),
    });
    this.usage = new UsageDesk(this.now, (view) => this.emit({ type: 'usage', data: view }));
    this.chat = new ChatDesk({
      db: opts.db,
      now: this.now,
      channels: () => [GLOBAL_CHANNEL, ...managedFloors(this.config).map(([slug]) => slug)],
      roleLabel: (role) => {
        const id = roleIdOf(role);
        return id ? ROLE_LABELS[id] : null;
      },
      onMessage: (message) => this.emit({ type: 'chat', data: message }),
    });
    this.restoreSessions();
    this.docs.refresh();
  }

  start(): void {
    this.docs.watch();
    this.refreshDocuments();
    this.background(this.sync.cleanup(this.docs.finishedPlanSlugs()));
  }

  stop(): void {
    this.docs.unwatch();
  }

  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  subscribe(listener: (msg: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): Snapshot {
    const now = this.now();
    return {
      now,
      floors: this.floors.views(),
      agents: [...this.agents.values()].map((a) => this.view(a, now)),
      sessions: [...this.sessions.values()].map((s) => this.sessionView(s)),
      questions: this.desk.list(),
      messages: this.messages.slice(-100),
      activity: this.activity.slice(-MAX_ACTIVITY),
      documents: this.docs.list(),
      alerts: this.alerts(),
      usage: this.usage.view(),
      chat: this.chat.recent(SNAPSHOT_LIMIT),
    };
  }

  ingestUsage(raw: unknown): string {
    return this.usage.ingest(raw);
  }

  ingest(e: HookEvent, meta: HookMeta = EMPTY_META): string | null {
    if (!isHookEvent(e)) return null;
    const now = this.now();
    this.dumpRaw(e, now);
    const session = this.touchSession(e, meta, now);
    const kind = session.floorKind;
    const matchers = isDepartmentFloor(kind) ? NO_TESTS : profileFor(this.profiles, session.stack);
    const c = withoutChatCalls(classify(e, matchers), e, matchers);
    const byName = c.event === 'TeammateIdle' && !e.agent_id && c.agentKey !== e.session_id && !this.agents.has(c.agentKey);
    const owner = byName ? this.liveTeammate(c.teammate, c.team ?? session.team ?? teamOfSession(e.session_id), e.session_id) : null;
    if (owner) c.agentKey = owner.key;
    if ((c.event === 'SubagentStop' || byName) && !this.agents.has(c.agentKey)) {
      this.sql.insertEvent.run(now, e.session_id, c.agentKey, session.floor, c.event, null, null, null, storedPayload(e, kind));
      return null;
    }
    const agent = this.touchAgent(e, c, session, now);
    if (this.isRetired(agent)) {
      this.ingestRetired(e, c, agent, session, now);
      return null;
    }

    let nextState = c.state;
    let ended = c.ended;
    if (c.event === 'SubagentStop' && agent.teammate) {
      nextState = 'idle';
      ended = false;
    }
    if (c.question !== null) agent.awaitingAnswer = true;
    else if (agent.awaitingAnswer && ANSWERS_QUESTION.has(c.event)) agent.awaitingAnswer = false;
    const holding = agent.awaitingAnswer && !ended && HOLDS_QUESTION.has(c.event);
    if (holding) nextState = null;
    if (
      nextState === null &&
      (c.event === 'PostToolUse' || c.event === 'PostToolUseFailure') &&
      agent.state === 'asking' &&
      !agent.awaitingAnswer
    ) {
      nextState = 'working';
    }
    if (ended) {
      agent.endedAt = now;
      this.forgetChatNotes(new Set([agent.key]));
    }
    else if (agent.endedAt !== null) agent.endedAt = null;
    if (nextState && nextState !== agent.state) {
      agent.state = nextState;
      agent.stateSince = now;
    }
    if (!holding) {
      if (c.event === 'SubagentStop' && agent.teammate) agent.detail = { key: 'hub.detail.waiting' };
      else if (c.detail) agent.detail = publicDetail(c, kind);
    }
    if (c.tool && c.event === 'PreToolUse') agent.tool = c.tool;
    if (c.blocked) agent.blockedReason = kind === 'observed' ? { key: 'hub.detail.blocked' } : c.blocked;
    else if (c.unblock) agent.blockedReason = null;
    if (c.filePath) agent.touchedFloor = this.touchedFloor(c.filePath, agent.floor);
    agent.away = false;
    if (NEW_TURN.has(c.event)) agent.file = null;
    if (c.event === 'PreToolUse' && c.filePath && FILE_TOOLS.has(c.tool ?? '')) agent.file = this.fileLabel(c.filePath, session);
    if (c.event === 'UserPromptSubmit' && agent.key === session.sessionId) {
      const task = taskLine(publicText(text(e.prompt), kind));
      if (task) agent.task = task;
    }
    const closing = text(e.last_assistant_message);
    if (closing && remembers(kind) && (c.event === 'SubagentStop' || c.event === 'Stop')) agent.closing = closing;
    agent.updatedAt = now;

    if (c.edit !== null) this.sql.insertEdit.run(now, agent.key, session.floor, publicText(c.edit, kind) ?? '');
    if (c.test === 'pass' || c.test === 'fail') {
      const ok = c.test === 'pass';
      const command = publicText(c.command, kind) ?? '';
      this.sql.insertVerdict.run(now, agent.key, agent.role, session.floor, 'tests', ok ? 1 : 0, command, null, null, null);
      agent.lastTest = { ok, ts: now, command };
    }
    if (c.task) this.recordTask(e, c, agent, session, now);

    this.sql.insertEvent.run(
      now,
      e.session_id,
      agent.key,
      session.floor,
      c.event,
      c.tool,
      nextState,
      c.filePath,
      storedPayload(e, kind),
    );
    this.persistAgent(agent);
    this.emitAgent(agent, now);
    if (c.message) this.recordMessage(c.message, agent, session, now);
    this.pushActivity({ ts: now, agentKey: agent.key, event: c.event, tool: c.tool, state: nextState, summary: publicSummary(c, kind) });
    this.trackDepartment(agent, c.event, ended);
    this.settlePermissions(agent.key, c.event, c.tool, e.tool_input);
    if (c.event === 'SubagentStop' || c.event === 'Stop' || c.event === 'SessionEnd') this.storeReport(agent, now);

    if (c.sessionEnded) this.endSession(session, now);
    if (c.event === 'SubagentStart' || c.event === 'SessionStart' || c.event === 'UserPromptSubmit') return this.injection(c.event, agent, session);
    if (c.event === 'PreToolUse' && c.tool && EDIT_TOOLS.has(c.tool) && c.filePath) return this.chatReminder(agent, session, c.filePath, now);
    return null;
  }

  async ask(e: HookEvent, meta: HookMeta = EMPTY_META, signal?: AbortSignal): Promise<string | null> {
    if (!isHookEvent(e) || e.tool_name !== 'AskUserQuestion') return null;
    const now = this.now();
    const session = this.touchSession(e, meta, now);
    if (!this.desk.someoneWatching() || !this.inScope(e, session)) return null;
    const input = record(e.tool_input);
    const questions = parseQuestions(input.questions);
    if (!questions) return null;
    const id = text(e.tool_use_id) ?? randomUUID();
    if (this.desk.has(id)) return null;
    return this.desk.hold(
      { id, agentKey: e.agent_id ?? e.session_id, sessionId: e.session_id, floor: session.floor, questions, createdAt: now },
      input,
      signal,
    );
  }

  async permission(e: HookEvent, meta: HookMeta = EMPTY_META, signal?: AbortSignal): Promise<string | null> {
    if (!isHookEvent(e) || e.hook_event_name !== 'PermissionRequest') return null;
    if (NOT_PERMISSIONS.has(e.tool_name ?? '')) return null;
    const now = this.now();
    const session = this.touchSession(e, meta, now);
    if (!this.desk.someoneWatching() || !this.inScope(e, session)) return null;
    const tool = text(e.tool_name) ?? '?';
    const input = record(e.tool_input);
    const key = e.agent_id ?? e.session_id;
    const who = this.agents.get(key)?.name ?? (key === e.session_id ? session.name : null) ?? key.slice(0, 8);
    const id = `permiso-${randomUUID()}`;
    this.permissionHolds.set(id, { agentKey: key, match: permissionMatch(tool, input) });
    return this.desk.hold(
      {
        id,
        kind: 'permission',
        detail: permissionDetail(tool, input),
        tool: text(e.tool_name) ?? undefined,
        prompt: permissionPrompt(tool, who),
        agentKey: key,
        sessionId: e.session_id,
        floor: session.floor,
        questions: [{ question: 'permiso', options: [{ label: PERMISSION_ALLOW }, { label: PERMISSION_DENY }] }],
        createdAt: now,
      },
      input,
      signal,
    );
  }

  answer(id: string, answers: unknown): 'ok' | 'closed' | 'invalid' {
    return this.desk.answer(id, answers);
  }

  release(id: string): 'ok' | 'closed' {
    return this.desk.release(id);
  }

  heartbeat(visible: boolean): void {
    this.desk.heartbeat(visible);
  }

  panelConnected(): void {
    this.desk.connect();
  }

  panelDisconnected(): void {
    this.desk.disconnect();
  }

  gate(e: HookEvent): GateDecision {
    if (!isHookEvent(e)) return { pass: true, reason: 'evento no válido' };
    const now = this.now();
    const session = this.touchSession(e, EMPTY_META, now);
    const scope = text(e.team_name) ?? session.team ?? teamOfSession(e.session_id);
    const lead = this.leadSession(scope) ?? session;
    const leadRole = lead.role ?? this.agents.get(lead.sessionId)?.role ?? null;
    const taskId = idText(e.task_id);
    const task = taskId ? this.sql.getTask.get(scope, taskId) : null;
    const owner = task?.owner ?? text(e.teammate_name);
    const keys = this.ownerKeys(owner, scope, lead);
    const decision = decideGate({
      officeTeam: isLeadRole(leadRole),
      floorManaged: lead.floorKind === 'managed',
      owner,
      lastOwnerEdit: this.lastEdit(lead.floor, keys),
      lastTesterGreen: this.sql.lastTesterGreen.get(lead.floor)?.ts ?? null,
    });
    this.sql.insertGate.run(now, scope, taskId, decision.pass ? 'pass' : 'block', decision.reason);
    if (taskId) {
      this.sql.upsertTask.run(scope, taskId, text(e.task_subject), null, decision.pass ? 'completed' : 'blocked', now);
    }
    const subject = short(text(e.task_subject) ?? taskId ?? '', 60);
    this.pushActivity({
      ts: now,
      agentKey: e.agent_id ?? lead.sessionId,
      event: 'TaskCompleted',
      tool: null,
      state: null,
      summary: { key: decision.pass ? 'hub.act.taskClosed' : 'hub.act.taskBlocked', params: { subject } },
    });
    return decision;
  }

  gateMessage(e: HookEvent): GateDecision {
    if (!isHookEvent(e) || e.tool_name !== 'SendMessage') return { pass: true, reason: 'no es un mensaje' };
    const body = text(record(e.tool_input).message) ?? '';
    const parsed = parseProtocol(body);
    const review = parsed?.kind === 'review' ? parsed : null;
    if (!review && !DONE_PREFIX.test(body)) return { pass: true, reason: 'no es un aviso de fin' };
    const now = this.now();
    const session = this.touchSession(e, EMPTY_META, now);
    const senderRole = this.roleForEvent(e, session);
    if (review) {
      if (isDepartmentFloor(session.floorKind) && isAuthorRole(senderRole)) return this.gateReview(e, review, session, now);
      return { pass: true, reason: 'solo cuenta el REVISAR de un redactor o artesano' };
    }
    if (isDepartmentFloor(session.floorKind) && departmentOf(senderRole)) {
      return this.gateDocument(e, body, senderRole, session, now);
    }
    if (!isLeadRole(senderRole)) return { pass: true, reason: 'solo cuenta el aviso de un jefe de planta' };
    const team = teamOfSession(session.sessionId);
    const decision = decideGate({
      officeTeam: true,
      floorManaged: session.floorKind === 'managed',
      owner: null,
      lastOwnerEdit: this.lastEdit(session.floor, this.ownerKeys(null, team, session)),
      lastTesterGreen: this.sql.lastTesterGreen.get(session.floor)?.ts ?? null,
    });
    this.sql.insertGate.run(now, team, null, decision.pass ? 'pass' : 'block', decision.reason);
    this.pushActivity({
      ts: now,
      agentKey: e.agent_id ?? session.sessionId,
      event: 'GateMessage',
      tool: 'SendMessage',
      state: null,
      summary: decision.pass ? { key: 'hub.act.doneAccepted', params: { text: short(body, 60) } } : { key: 'hub.act.doneBlocked' },
    });
    return decision;
  }

  guard(e: HookEvent, meta: HookMeta = EMPTY_META): GateDecision {
    if (!isHookEvent(e) || !GUARDED_TOOLS.has(e.tool_name ?? '')) return { pass: true, reason: 'herramienta sin guardia' };
    const now = this.now();
    const session = this.touchSession(e, meta, now);
    const role = this.roleForEvent(e, session);
    if (!departmentOf(role)) return { pass: true, reason: 'fuera de los departamentos' };
    const decision = guardDecision(
      { tool: e.tool_name ?? '', input: record(e.tool_input), cwd: text(e.cwd) ?? session.cwd, role, name: this.agents.get(e.agent_id ?? e.session_id)?.name ?? null },
      this.guardContext(),
    );
    if (!decision.pass) {
      this.sql.insertGate.run(now, 'guardia', null, 'block', decision.reason);
      const key = e.agent_id ?? e.session_id;
      this.pushActivity({
        ts: now,
        agentKey: key,
        event: 'Guard',
        tool: e.tool_name ?? null,
        state: null,
        summary: { key: 'hub.act.guardBlocked', params: { who: this.agents.get(key)?.name ?? role ?? key.slice(0, 8), target: decision.target ?? '?' } },
      });
    }
    return decision;
  }

  async order(sessionId: string, body: string): Promise<OrderResult> {
    const session = this.sessions.get(sessionId);
    if (!session || session.endedAt !== null) return 'not-found';
    if (!session.socket || !existsSync(session.socket)) return 'unreachable';
    try {
      await this.deliverFn(session.socket, encodeInbox(session.token, orderText(body)));
    } catch {
      return 'failed';
    }
    this.pushActivity({
      ts: this.now(),
      agentKey: session.sessionId,
      event: 'Order',
      tool: null,
      state: null,
      summary: { key: 'hub.act.order', params: { text: short(body, 60) } },
    });
    const main = this.agents.get(sessionId);
    const task = taskLine(publicText(body, session.floorKind));
    if (main && main.retiredAt === null && task) {
      main.task = task;
      main.away = false;
      this.emitAgent(main, this.now());
    }
    return 'ok';
  }

  postChat(raw: ChatPostRequest, meta: HookMeta): ChatPostResult {
    const kind = raw.kind ?? 'texto';
    if (!isChatKind(kind)) return { ok: false, status: 400, error: { key: 'hub.api.chatKind' } };
    const found = this.chatAuthor(raw, meta);
    if ('error' in found) return { ok: false, ...found };
    const { author, root, cwd } = found;
    const channel = raw.channel?.trim() || author.floor;
    // Paths are relative to the root of the floor, as fileLabel shows them, wherever the script ran from.
    const files = (raw.files ?? []).map((file) => {
      const abs = realPath(resolve(cwd, file));
      return abs !== root && isInside(abs, root) ? relative(root, abs) : normalizeChatPath(file);
    });
    const input = { channel, kind, text: raw.text ?? '', files };
    const error = this.chat.check(input);
    if (error) return { ok: false, ...error };
    if (channel !== GLOBAL_CHANNEL && channel !== author.floor) return { ok: false, status: 403, error: { key: 'hub.api.chatChannelForbidden' } };
    const { message, warnings } = this.chat.post({ ...input, author });
    this.chatActivity(message);
    return { ok: true, message, warnings };
  }

  // The user writes from the panel: the message goes to the channel and, through the inbox, to the leads that
  // read it, after the lines of their team they had not seen yet.
  async userChat(channel: string, body: string): Promise<({ ok: true } & ChatUserResult) | Extract<ChatPostResult, { ok: false }>> {
    const input = { channel, kind: 'texto' as const, text: body, files: [] };
    const error = this.chat.check(input);
    if (error) return { ok: false, ...error };
    const author: ChatAuthor = { key: 'panel', name: USER_NAME, role: null, floor: channel === GLOBAL_CHANNEL ? DIRECCION : channel, origin: 'user' };
    const { message } = this.chat.post({ ...input, author });
    this.chatActivity(message);
    let delivered = 0;
    for (const session of this.chatLeads(channel)) {
      if (!session.socket || !existsSync(session.socket)) continue;
      const channels = [session.floor, GLOBAL_CHANNEL];
      const pending = this.chat.unread(session.sessionId, channels);
      const lines = this.chatLines({ messages: pending.messages.filter((m) => m.id !== message.id), hidden: pending.hidden }, session.floor) ?? '';
      // Seen before the delivery: the turn it starts may reach the hub before deliver returns, and must not get
      // these lines again. If it fails, the lead has not seen them.
      const before = this.chat.seenMark(session.sessionId);
      this.chat.markSeen(session.sessionId, pending.last, channels);
      try {
        await this.deliverFn(session.socket, encodeInbox(session.token, chatInboxText(channel, lines, message.text)));
      } catch {
        this.chat.restoreSeen(session.sessionId, before);
        continue;
      }
      delivered += 1;
    }
    return { ok: true, message, delivered };
  }

  async readChat(
    channel: string,
    afterId: number | null,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<{ afterId: number | null; messages: ChatMessageView[] } | 'no-channel'> {
    if (!this.chat.isChannel(channel)) return 'no-channel';
    if (waitMs > 0) {
      // Without desde, waiting means waiting for what comes next, not getting the latest ones at once.
      const after = afterId ?? this.chat.lastId(channel);
      return { afterId: after, messages: await this.chat.wait(channel, after, waitMs, signal) };
    }
    if (afterId === null) return { afterId: null, messages: this.chat.before(channel, null, READ_LIMIT) };
    return { afterId, messages: this.chat.since(channel, afterId) };
  }

  chatHistory(channel: string, beforeId: number | null): ChatMessageView[] | 'no-channel' {
    if (!this.chat.isChannel(channel)) return 'no-channel';
    return this.chat.before(channel, beforeId);
  }

  memoryView(floor: string, role: RoleId): MemoryView {
    return { floor, role, lessons: listLessons(this.opts.db, floor, role), reports: savedReports(this.opts.db, floor, role, 10) };
  }

  addLesson(raw: unknown): LessonResult {
    const body = record(raw);
    const floor = text(body.floor);
    const role = body.role;
    const lessonText = text(body.text);
    if (!floor || floor.length > 80) return { ok: false, status: 400, error: { key: 'hub.api.floorRequired' } };
    if (!isRoleId(role)) return { ok: false, status: 400, error: { key: 'hub.api.roleInvalid' } };
    if (!lessonText || !cleanLesson(lessonText)) return { ok: false, status: 400, error: { key: 'hub.api.lessonEmpty' } };
    const result = captureLesson(
      this.opts.db,
      { floor, role, text: lessonText, origin: 'user', agentKey: null, now: this.now() },
      this.config.memory,
    );
    if (result.status === 'saved') {
      this.emit({ type: 'memory', floor, role });
      return { ok: true, lesson: result.lesson };
    }
    if (result.status === 'duplicate') return { ok: false, status: 409, error: { key: 'hub.api.lessonDuplicate' } };
    return { ok: false, status: 400, error: { key: 'hub.api.lessonSaveFailed' } };
  }

  removeLesson(id: number): boolean {
    const removed = deleteLesson(this.opts.db, id);
    if (!removed) return false;
    this.emit({ type: 'memory', floor: removed.floor, role: removed.role });
    return true;
  }

  report(agentKey: string): ReportView | null {
    const agent = this.agents.get(agentKey);
    if (agent) return this.buildReportFor(agent);
    return savedReport(this.opts.db, agentKey);
  }

  documents(): DocumentView[] {
    return this.docs.list();
  }

  documentContent(path: string): DocumentContent | null {
    return this.docs.content(path);
  }

  async discardDocument(path: string): Promise<DiscardResult> {
    const doc = this.docs.find(path);
    if (!doc || doc.kind !== 'plan') return 'not-found';
    if (NOT_DISCARDABLE.has(doc.status)) return 'closed';
    const now = this.now();
    const ref: DocRef = { path: doc.path, kind: doc.kind, slug: doc.slug };
    this.docs.markDiscarded(ref, now);
    this.markDiscardedFile(ref, now);
    this.refreshDocuments();
    this.pushActivity({ ts: now, agentKey: 'panel', event: 'Discard', tool: null, state: null, summary: { key: 'hub.act.planDiscarded', params: { path: doc.path } } });
    await this.sync.remove(doc.slug);
    return 'ok';
  }

  async decidePlan(path: string, decision: PlanDecision): Promise<DecideResult> {
    const doc = this.docs.find(path);
    if (!doc || doc.kind !== 'plan') return 'not-found';
    if (!DECISION_FROM[decision].includes(doc.status)) return 'invalid-state';
    if (decision === 'ejecutar') {
      const director = this.directorSession();
      if (!director) return 'no-director';
      const text = doc.docType === 'analisis' ? analysisOrderText(doc, this.docsRoot()) : executeOrderText(doc, this.docsRoot());
      const sent = await this.order(director.sessionId, text);
      if (sent === 'not-found') return 'no-director';
      if (sent !== 'ok') return sent;
    }
    const now = this.now();
    this.docs.markDecision({ path: doc.path, kind: doc.kind, slug: doc.slug }, decision, now);
    this.refreshDocuments();
    const summary: HubText =
      decision === 'ejecutar'
        ? { key: doc.docType === 'analisis' ? 'hub.act.planAnalysisSent' : 'hub.act.planExecuting', params: { path: doc.path } }
        : decision === 'aparcar'
          ? { key: 'hub.act.planParked', params: { path: doc.path } }
          : { key: 'hub.act.planClosed', params: { path: doc.path } };
    this.pushActivity({ ts: now, agentKey: 'panel', event: 'Decision', tool: null, state: null, summary });
    return 'ok';
  }

  async syncSources(raw: unknown): Promise<SyncResult> {
    const result = await this.sync.sync(raw);
    if (result.ok) {
      this.pushActivity({
        ts: this.now(),
        agentKey: 'redaccion',
        event: 'Sync',
        tool: null,
        state: null,
        summary: { key: 'hub.act.sourcesReady', params: { slug: result.slug, floors: result.floors.map((f) => f.floor).join(', ') } },
      });
    }
    return result;
  }

  async expireSources(): Promise<string[]> {
    const cutoff = this.now() - this.config.retentionDays * DAY_MS;
    return this.sync.expire(cutoff, (slug) => {
      const doc = this.docs.list().find((d) => d.kind === 'plan' && d.slug === slug);
      return doc?.updatedAt ?? 0;
    });
  }

  tick(): void {
    const now = this.now();
    this.desk.sweep();
    for (const agent of [...this.agents.values()]) {
      if (agent.endedAt !== null && now - agent.endedAt > FORGET_ENDED_MS) {
        this.agents.delete(agent.key);
        this.emit({ type: 'agent-gone', key: agent.key });
        continue;
      }
      if (this.goesHome(agent, now)) {
        agent.away = true;
        this.emitAgent(agent, now);
        continue;
      }
      if (this.view(agent, now).state !== agent.sentState) this.emitAgent(agent, now);
    }
    for (const session of [...this.sessions.values()]) {
      if (session.endedAt === null && session.socket && !existsSync(session.socket)) this.endSession(session, now);
      if (session.endedAt !== null && now - session.endedAt > FORGET_ENDED_MS) this.sessions.delete(session.sessionId);
    }
  }

  floorInUse(slug: string): string[] {
    return [...this.sessions.values()]
      .filter((session) => session.floor === slug && session.endedAt === null)
      .map((session) => session.name ?? session.sessionId.slice(0, 8));
  }

  async forgetFloor(slug: string, path: string): Promise<{ rows: number; worktrees: number }> {
    const worktrees = await this.sync.removeFloor(slug);
    // A session may have opened on the floor while git was working.
    const open = this.floorInUse(slug);
    if (open.length > 0) throw new FloorInUseError(slug, open);
    const keys = new Set([...this.agents.values()].filter((agent) => agent.floor === slug).map((agent) => agent.key));
    const sessionIds = new Set([...this.sessions.values()].filter((session) => session.floor === slug).map((session) => session.sessionId));

    for (const q of this.desk.list()) if (sessionIds.has(q.sessionId)) this.desk.release(q.id);
    for (const [id, hold] of this.permissionHolds) if (keys.has(hold.agentKey)) this.permissionHolds.delete(id);
    for (const key of keys) this.agents.delete(key);
    this.forgetChatNotes(keys);
    for (const id of sessionIds) this.sessions.delete(id);
    const keptMessages = this.messages.filter((message) => message.floor !== slug);
    this.messages.splice(0, this.messages.length, ...keptMessages);
    const keptActivity = this.activity.filter((entry) => !keys.has(entry.agentKey));
    this.activity.splice(0, this.activity.length, ...keptActivity);

    this.chat.forgetFloor(slug);
    const rows = purgeFloorData(this.opts.db, slug, path);
    const now = this.now();
    this.pushActivity({ ts: now, agentKey: 'panel', event: 'FloorRemoved', tool: null, state: null, summary: { key: 'hub.act.floorRemoved', params: { slug } } });
    this.emit({ type: 'snapshot', data: this.snapshot() });
    return { rows, worktrees };
  }

  reload(config: OfficeConfig, profiles: Profiles): void {
    this.config = config;
    this.profiles = profiles;
    const now = this.now();
    for (const session of this.sessions.values()) {
      const floor = this.floors.resolve(session.cwd);
      if (floor.slug === session.floor && floor.kind === session.floorKind && floor.stack === session.stack) continue;
      this.applyFloor(session, floor);
      this.emit({ type: 'session', data: this.sessionView(session) });
      for (const agent of this.agents.values()) {
        if (agent.sessionId !== session.sessionId) continue;
        agent.floor = session.floor;
        agent.floorKind = session.floorKind;
        this.emitAgent(agent, now);
      }
    }
    this.emit({ type: 'floors', data: this.floors.views() });
    this.emit({ type: 'settings', data: settingsView(config) });
    this.docs.watch();
    this.refreshDocuments();
  }

  private background(task: Promise<unknown>): void {
    const tracked = task.catch((error: unknown) => {
      console.error(`Agent Office: tarea en segundo plano fallida: ${(error as Error).message}`);
    });
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }

  private docsRoot(): string {
    return this.floors.docsRoot();
  }

  refreshDocuments(): void {
    this.docs.refresh();
  }

  private guardFloors(): { slug: string; path: string }[] {
    return managedFloors(this.config)
      .map(([slug, floor]) => ({ slug, path: realPath(floor.path) }))
      .filter((f) => existsSync(f.path));
  }

  private guardContext(): GuardContext {
    return { docsRoot: this.docsRoot(), claudeHome: realPath(this.opts.claudeHome), floors: this.guardFloors() };
  }

  private installTargets(): { label: string; dir: string }[] {
    return [
      { label: '~/.claude/skills', dir: join(this.opts.claudeHome, 'skills') },
      ...managedFloors(this.config).map(([slug, floor]) => ({ label: `${slug}: .claude/skills`, dir: join(floor.path, '.claude', 'skills') })),
    ];
  }

  private attributedFiles(floor: string, from: number, to: number): Set<string> {
    const out = new Set<string>();
    for (const row of this.sql.editsBetween.all(floor, from, to)) if (row.path) out.add(realPath(row.path));
    return out;
  }

  private recordAlert(finding: GuardFinding): void {
    const id = Number(this.sql.insertAlert.run(finding.ts, finding.level, finding.floor, finding.agentKey, JSON.stringify(finding.files)).lastInsertRowid);
    const alert: GuardAlert = { id, ...finding };
    this.emit({ type: 'alert', data: alert });
    const who = this.agents.get(finding.agentKey)?.name ?? finding.agentKey;
    this.pushActivity({
      ts: finding.ts,
      agentKey: finding.agentKey,
      event: 'GuardAlert',
      tool: null,
      state: null,
      summary: plural('hub.act.guardAlert', finding.files.length, {
        level: { key: finding.level === 'alerta' ? 'hub.alertLevel.alerta' : 'hub.alertLevel.posible' },
        floor: finding.floor,
        who,
      }),
    });
  }

  private alerts(): GuardAlert[] {
    return this.sql.recentAlerts
      .all(MAX_ALERTS)
      .reverse()
      .map((row: AlertRow) => ({
        id: row.id,
        ts: row.ts,
        level: row.level === 'posible' ? 'posible' : 'alerta',
        floor: row.floor,
        agentKey: row.agent_key,
        files: parseList(row.files),
      }));
  }

  private trackDepartment(agent: AgentRuntime, event: string, ended: boolean): void {
    if (!departmentOf(agent.role)) return;
    if (event === 'SubagentStop' || event === 'Stop' || event === 'SessionEnd') {
      if (this.watch.watching(agent.key)) this.background(this.watch.finish(agent.key));
      return;
    }
    if (event === 'SessionStart' || event === 'Notification' || event === 'TeammateIdle') return;
    if (!ended && agent.endedAt === null && !this.watch.watching(agent.key)) {
      this.watch.start(agent.key);
      this.background(this.watch.ready(agent.key));
    }
  }

  private settlePermissions(agentKey: string, event: string, tool: string | null, input: unknown): void {
    if (this.permissionHolds.size === 0) return;
    const turnOver = event === 'Stop' || event === 'SubagentStop' || event === 'SessionEnd' || event === 'UserPromptSubmit';
    const ran = (event === 'PostToolUse' || event === 'PostToolUseFailure') && tool ? permissionMatch(tool, record(input)) : null;
    if (!turnOver && !ran) return;
    for (const [id, hold] of [...this.permissionHolds]) {
      if (hold.agentKey !== agentKey) continue;
      if (turnOver || hold.match === ran) this.desk.release(id);
    }
  }

  private storeReport(agent: AgentRuntime, now: number): void {
    if (!remembers(agent.floorKind) || contextFree(roleKind(agent.role))) return;
    saveReport(this.opts.db, this.buildReportFor(agent), now);
  }

  private buildReportFor(agent: AgentRuntime): ReportView {
    return buildReport(
      this.opts.db,
      {
        key: agent.key,
        name: agent.name,
        role: agent.role,
        roleId: roleIdOf(agent.role),
        floor: agent.floor,
        startedAt: agent.startedAt,
        endedAt: agent.endedAt,
        closing: agent.closing,
      },
      (key) => this.agents.get(key)?.name ?? this.sessions.get(key)?.name ?? key,
    );
  }

  // Memory on start only, and the chat lines the agent has not seen yet on start and on every turn.
  private injection(event: string, agent: AgentRuntime, session: SessionRuntime): string | null {
    const blocks = [event === 'UserPromptSubmit' ? null : this.memoryBlock(agent, session), this.chatBlock(agent, session)].filter(
      (block): block is string => block !== null,
    );
    if (blocks.length === 0) return null;
    return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: blocks.join('\n\n') } });
  }

  private memoryBlock(agent: AgentRuntime, session: SessionRuntime): string | null {
    const roleId = roleIdOf(agent.role);
    if (contextFree(roleKind(agent.role))) return null;
    if (!roleId || !remembers(session.floorKind) || !inOfficeScope({ floorKind: session.floorKind, sessionRole: agent.role, leadRole: null })) {
      return null;
    }
    const lessons = listLessons(this.opts.db, agent.floor, roleId);
    const reports = savedReports(this.opts.db, agent.floor, roleId, 3, agent.key).map((r) => ({
      date: isoDate(r.endedAt ?? r.startedAt),
      name: r.name,
      summary: r.summary,
    }));
    const context = memoryContext({
      roleLabel: ROLE_LABELS[roleId],
      floorLabel: floorLabel(agent.floor),
      lessons,
      reports,
      maxChars: this.config.memory.maxContextChars,
    });
    if (!context) return null;
    this.pushActivity({
      ts: this.now(),
      agentKey: agent.key,
      event: 'Memory',
      tool: null,
      state: null,
      summary: { key: 'hub.act.memoryDelivered', params: { lessons: lessons.length, reports: reports.length } },
    });
    return context;
  }

  private chatBlock(agent: AgentRuntime, session: SessionRuntime): string | null {
    const channels = this.chatChannelsOf(agent, session);
    if (!channels) return null;
    const lines = this.chatLines(this.chat.unreadFor(agent.key, channels), channels[0] ?? GLOBAL_CHANNEL);
    if (!lines) return null;
    return `Chat de Agent Office. Mensajes nuevos en ${channels.map((channel) => `#${channel}`).join(' y ')}:\n${lines}`;
  }

  private chatChannelsOf(agent: AgentRuntime, session: SessionRuntime): string[] | null {
    const roleId = roleIdOf(agent.role);
    if (session.floorKind === 'managed' && (roleId === 'lead' || roleId === 'dev' || roleId === 'tester') && this.chat.isChannel(agent.floor)) {
      return [agent.floor, GLOBAL_CHANNEL];
    }
    if (session.floorKind === 'direccion' && roleId === 'director') return [GLOBAL_CHANNEL];
    return null;
  }

  private chatLines(unread: ChatUnread, channel: string): string | null {
    if (unread.messages.length === 0) return null;
    const lines = [this.chat.digest(unread.messages)];
    if (unread.hidden > 0) lines.push(`Hay ${unread.hidden} anteriores sin mostrar: ${CHAT_SCRIPT} ${channel} leer`);
    return lines.join('\n');
  }

  // A developer about to edit a file: a reminder to claim it, once per file, or a warning per claim of someone else.
  private chatReminder(agent: AgentRuntime, session: SessionRuntime, filePath: string, now: number): string | null {
    if (session.floorKind !== 'managed' || roleKind(agent.role) !== 'dev' || !this.chat.isChannel(agent.floor)) return null;
    const slug = agent.floor;
    const rel = this.fileLabel(filePath, session);
    const from = agent.name ? ` --de ${agent.name}` : '';
    const claims = this.chat.claimsOn(slug, rel);
    const others = claims.filter((claim) => claim.authorKey !== agent.key);
    let context: string;
    if (others.length > 0) {
      const fresh = others.find((claim) => !this.chatWarned.has(`${agent.key}|${rel}|${claim.id}`));
      if (!fresh) return null;
      this.chatWarned.add(`${agent.key}|${rel}|${fresh.id}`);
      const minutes = Math.max(0, Math.round((now - fresh.ts) / 60_000));
      context = `Chat de la planta: ${fresh.authorName} anunció ${fresh.file} hace ${minutes} min (#${fresh.id}). Acordadlo en #${slug} antes de editar: ${CHAT_SCRIPT} ${slug} pregunta "…"${from}`;
    } else {
      const nudge = `${agent.key}|${rel}`;
      if (claims.length > 0 || this.chatNudged.has(nudge)) return null;
      this.chatNudged.add(nudge);
      context = `Chat de la planta: no has anunciado ${rel} en #${slug}. Anúncialo antes de seguir: ${CHAT_SCRIPT} ${slug} toca ${rel}${from}`;
    }
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: context } });
  }

  private roleForEvent(e: HookEvent, session: SessionRuntime): string | null {
    const key = e.agent_id ?? e.session_id;
    const known = this.agents.get(key)?.role ?? null;
    if (isOfficeRole(known)) return canonicalRole(known);
    const type = text(e.agent_type);
    if (isOfficeRole(type)) return canonicalRole(type);
    if (key === e.session_id) return canonicalRole(session.role ?? known);
    if (!type) return null;
    const team = text(e.team_name) ?? session.team ?? teamOfSession(e.session_id);
    const resolved =
      this.teamMemberType(team, type) ??
      this.spawnCallsByName.get(`${e.session_id}:${type}`)?.subagentType ??
      roleFromName(type, session.floor, session.floorKind);
    return canonicalRole(resolved);
  }

  // REVISAR: over the effective round cap. Only a block is recorded: a REVISAR: that passes already shows in the
  // activity when ingest processes it.
  private gateReview(e: HookEvent, review: { target: string | null; round: number | null }, session: SessionRuntime, now: number): GateDecision {
    // session.cwd, as handleProtocol: touchSession has already taken the cwd of this event.
    const ref = docRef(review.target, this.docsRoot(), session.cwd);
    if (!ref) return { pass: true, reason: 'sin documento: handleProtocol tampoco lo cuenta' };
    const cap = this.docs.roundCap(ref);
    const decision = decideReviewGate({ path: ref.path, round: review.round, cap, maxRounds: this.config.review.maxRounds });
    if (decision.pass || review.round === null) return decision;
    this.sql.insertGate.run(now, teamOfSession(session.sessionId), ref.path, 'block', decision.reason);
    this.pushActivity({
      ts: now,
      agentKey: e.agent_id ?? session.sessionId,
      event: 'GateMessage',
      tool: 'SendMessage',
      state: null,
      summary: { key: 'hub.act.reviewBlockedOverMax', params: { path: ref.path, round: review.round, max: cap } },
    });
    return decision;
  }

  private gateDocument(e: HookEvent, body: string, role: string | null, session: SessionRuntime, now: number): GateDecision {
    const parsed = parseProtocol(body);
    const ref = docRef(parsed?.target ?? null, this.docsRoot(), text(e.cwd) ?? session.cwd);
    const decision = decideDocumentGate({
      raw: parsed?.target ?? null,
      path: ref?.path ?? null,
      changedAt: ref ? this.docs.changedAt(ref) : null,
      approvedAt: ref ? (this.sql.lastApproved.get(ref.path)?.ts ?? null) : null,
    });
    const scope = teamOfSession(session.sessionId);
    this.sql.insertGate.run(now, scope, ref?.path ?? null, decision.pass ? 'pass' : 'block', decision.reason);
    this.pushActivity({
      ts: now,
      agentKey: e.agent_id ?? session.sessionId,
      event: 'GateMessage',
      tool: 'SendMessage',
      state: null,
      summary: decision.pass
        ? { key: 'hub.act.deliveryAccepted', params: { path: ref?.path ?? short(body, 60) } }
        : ref
          ? { key: 'hub.act.deliveryBlockedStale', params: { path: ref.path } }
          : { key: 'hub.act.deliveryBlockedNoPath' },
    });
    if (decision.pass && ref && isLeadRole(role)) {
      if (ref.kind === 'plan') {
        this.docs.markDelivered(ref, this.sync.base(ref.slug), now);
        this.refreshDocuments();
        this.background(this.sync.remove(ref.slug));
      } else {
        this.docs.markClosed(ref, now);
        this.refreshDocuments();
      }
    }
    return decision;
  }

  private handleProtocol(message: { to: string; toKey: string | null; text: string }, from: AgentRuntime, session: SessionRuntime, now: number): void {
    if (!remembers(session.floorKind)) return;
    const parsed = parseProtocol(message.text);
    if (!parsed) return;
    if (parsed.kind === 'lesson') {
      if (contextFree(roleKind(from.role))) {
        this.pushActivity({
          ts: now,
          agentKey: from.key,
          event: 'Lesson',
          tool: 'SendMessage',
          state: null,
          summary: { key: 'hub.act.lessonIgnoredReviewer' },
        });
        return;
      }
      this.captureAgentLesson(from, parsed.rest, now);
      return;
    }
    if (!isDepartmentFloor(session.floorKind)) return;
    const ref = docRef(parsed.target, this.docsRoot(), session.cwd);
    if (!ref) return;
    if (parsed.kind === 'plan') {
      if (ref.kind === 'plan' && isLeadRole(from.role)) {
        this.pushActivity({ ts: now, agentKey: from.key, event: 'Plan', tool: 'SendMessage', state: null, summary: { key: 'hub.act.planNotice', params: { to: message.to, path: ref.path } } });
      }
      return;
    }
    const round = parsed.round;
    if (parsed.kind === 'review' && isAuthorRole(from.role)) {
      // gate.sh blocks it, but emit.sh runs in the same PreToolUse: no round opens over the cap.
      const cap = this.docs.roundCap(ref);
      if (round !== null && round > cap) {
        this.pushActivity({
          ts: now,
          agentKey: from.key,
          event: 'Review',
          tool: 'SendMessage',
          state: null,
          summary: { key: 'hub.act.reviewIgnoredOverMax', params: { path: ref.path, round, max: cap } },
        });
        return;
      }
      this.docs.markRequested(ref, round, now);
      this.commitRound(ref, round);
      this.refreshDocuments();
      this.pushActivity({
        ts: now,
        agentKey: from.key,
        event: 'Review',
        tool: 'SendMessage',
        state: null,
        summary: { key: 'hub.act.reviewRequested', params: { path: ref.path, round: roundText(round) } },
      });
      return;
    }
    const verdict: Exclude<VerdictKind, 'tests'> | null =
      parsed.kind === 'improve' ? 'improve' : parsed.kind === 'approved' ? 'approved' : parsed.kind === 'no-agreement' ? 'no-agreement' : null;
    if (!verdict || !isVerdictRole(from.role) || !this.toAuthor(message, ref)) return;
    if (this.sql.agentVerdict.get(from.key, ref.path)) {
      this.pushActivity({
        ts: now,
        agentKey: from.key,
        event: 'Verdict',
        tool: 'SendMessage',
        state: null,
        summary: { key: 'hub.act.verdictIgnored', params: { who: from.name ?? from.key, path: ref.path } },
      });
      return;
    }
    // A SIN ACUERDO: counts at most at the round the document had: without a round the cap still renews, and a
    // wrong "ronda 40" does not lift it.
    const docRound = this.docs.find(ref.path)?.round ?? 0;
    const stored = verdict !== 'no-agreement' || docRound <= 0 ? round : Math.min(round ?? docRound, docRound);
    this.sql.insertVerdict.run(now, from.key, from.role, session.floor, verdict, verdict === 'approved' ? 1 : 0, null, ref.path, stored, parsed.score);
    this.docs.markRound(ref, round, now);
    if (verdict === 'approved') {
      this.commitRound(ref, round);
      if (ref.kind === 'plan') this.background(this.sync.checkAhead(ref.slug));
    }
    this.refreshDocuments();
    const key = verdict === 'approved' ? 'hub.act.verdictApproved' : verdict === 'improve' ? 'hub.act.verdictImprove' : 'hub.act.verdictNoAgreement';
    this.pushActivity({
      ts: now,
      agentKey: from.key,
      event: 'Verdict',
      tool: 'SendMessage',
      state: null,
      summary: { key, params: { path: ref.path, round: roundText(round), score: scoreText(parsed.score) } },
    });
    this.retire(from, VERDICT_DETAILS[verdict], now);
  }

  private toAuthor(message: { to: string; toKey: string | null }, ref: DocRef): boolean {
    const author = `${ref.kind === 'plan' ? 'redactor' : 'artesano'}-${ref.slug}`;
    const name = message.to.split('@')[0] ?? '';
    if (name === author) return true;
    const recipient = message.toKey ? this.agents.get(message.toKey) : undefined;
    return !!recipient && recipient.name === author && isAuthorRole(recipient.role);
  }

  private retire(agent: AgentRuntime, detail: HubText, now: number): void {
    agent.retiredAt = now;
    agent.retiredAwake = true;
    agent.blockedReason = null;
    agent.detail = detail;
    if (agent.state !== 'done') {
      agent.state = 'done';
      agent.stateSince = now;
    }
    if (agent.endedAt === null) agent.endedAt = now;
    agent.updatedAt = now;
    if (this.watch.watching(agent.key)) this.background(this.watch.finish(agent.key));
    this.persistAgent(agent);
    this.emitAgent(agent, now);
    this.storeReport(agent, now);
  }

  // The script is not a hook and brings no agent_id: the floor comes from its folder and the author from --de,
  // or from the name of the session that runs it, and either must be alive on that floor.
  // With --de, the session that runs the script must also be alive on that floor: teammates share its
  // environment, so a session of another floor cannot sign for a teammate of this one.
  private chatAuthor(raw: ChatPostRequest, meta: HookMeta): { author: ChatAuthor; root: string; cwd: string } | ChatError {
    const cwd = raw.cwd?.trim();
    const root = cwd ? this.floors.rootOf(realPath(cwd)) : null;
    const slug = root ? managedFloors(this.config).find(([, floor]) => realPath(floor.path) === root)?.[0] : undefined;
    if (!cwd || !root || !slug) return { status: 404, error: { key: 'hub.api.chatFloorUnknown' } };
    const from = raw.from?.trim() || null;
    const caller = meta.name ? this.liveSessionNamed(meta.name, slug) : null;
    if (from && !caller) return { status: 403, error: { key: 'hub.api.chatSessionUnknown' } };
    const name = from ?? meta.name;
    if (name && name !== USER_NAME) {
      const agent = [...this.agents.values()]
        .filter((a) => a.name === name && a.floor === slug && a.endedAt === null && !this.isRetired(a))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (agent) return { author: { key: agent.key, name, role: agent.role, floor: slug, origin: 'agent' }, root, cwd };
      const session = this.liveSessionNamed(name, slug);
      if (session) {
        const role = session.role ?? this.agents.get(session.sessionId)?.role ?? null;
        return { author: { key: session.sessionId, name, role, floor: slug, origin: 'agent' }, root, cwd };
      }
    }
    return { status: 404, error: { key: 'hub.api.chatAuthorUnknown' } };
  }

  private liveSessionNamed(name: string, slug: string): SessionRuntime | null {
    return (
      [...this.sessions.values()].filter((s) => s.name === name && s.floor === slug && s.endedAt === null).sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
      null
    );
  }

  private forgetChatNotes(keys: ReadonlySet<string>): void {
    for (const notes of [this.chatNudged, this.chatWarned]) {
      for (const note of notes) if (keys.has(note.slice(0, note.indexOf('|')))) notes.delete(note);
    }
  }

  // Live leads of managed floors that read the channel: the floor's own, or all of them for #global.
  private chatLeads(channel: string): SessionRuntime[] {
    return [...this.sessions.values()].filter((session) => {
      if (session.endedAt !== null || session.floorKind !== 'managed') return false;
      if (!isLeadRole(session.role ?? this.agents.get(session.sessionId)?.role ?? null)) return false;
      return channel === GLOBAL_CHANNEL || session.floor === channel;
    });
  }

  private chatActivity(message: ChatMessageView): void {
    const base = { who: message.authorName, channel: message.channel };
    const files = message.files.join(', ');
    const summary: HubText =
      message.origin === 'user'
        ? { key: 'hub.act.chatUser', params: { channel: message.channel, text: short(message.text, 60) } }
        : message.kind === 'toca'
          ? { key: 'hub.act.chatClaim', params: { ...base, files } }
          : message.kind === 'listo'
            ? { key: 'hub.act.chatRelease', params: { ...base, files } }
            : { key: 'hub.act.chatPost', params: { ...base, text: short(message.text, 60) } };
    this.pushActivity({ ts: message.ts, agentKey: message.authorKey, event: 'Chat', tool: null, state: null, summary });
  }

  private isRetired(agent: AgentRuntime): boolean {
    if (agent.retiredAt !== null) return true;
    if (!isVerdictRole(agent.role)) return false;
    const row = this.sql.firstVerdictOf.get(agent.key);
    if (!row || row.ts === null) return false;
    agent.retiredAt = row.ts;
    agent.retiredAwake = false;
    agent.state = 'done';
    agent.sentState = 'done';
    agent.stateSince = row.ts;
    if (agent.endedAt === null) agent.endedAt = row.ts;
    this.persistAgent(agent);
    return true;
  }

  private ingestRetired(e: HookEvent, c: Classified, agent: AgentRuntime, session: SessionRuntime, now: number): void {
    const kind = session.floorKind;
    this.sql.insertEvent.run(now, e.session_id, agent.key, session.floor, c.event, c.tool, null, c.filePath, storedPayload(e, kind));
    if (TURN_OVER.has(c.event)) {
      agent.retiredAwake = false;
    } else if (!agent.retiredAwake) {
      agent.retiredAwake = true;
      this.pushActivity({
        ts: now,
        agentKey: agent.key,
        event: 'Retired',
        tool: null,
        state: null,
        summary: { key: 'hub.act.retiredIgnored', params: { who: agent.name ?? agent.key } },
      });
    }
    if (c.message) this.recordMessage(c.message, agent, session, now);
    this.settlePermissions(agent.key, c.event, c.tool, e.tool_input);
    if (c.sessionEnded) this.endSession(session, now);
  }

  private liveTeammate(name: string | null, team: string, sessionId: string): AgentRuntime | null {
    if (!name) return null;
    for (const agent of this.agents.values()) {
      if (agent.name !== name || agent.endedAt !== null || this.isRetired(agent)) continue;
      if (agent.team === team || agent.sessionId === sessionId) return agent;
    }
    return null;
  }

  private markDiscardedFile(ref: DocRef, now: number): void {
    const file = join(this.docsRoot(), ref.path);
    try {
      const content = readFileSync(file, 'utf8');
      if (!content.startsWith(DISCARDED_MARK)) {
        writeFileSync(file, `${DISCARDED_MARK} desde el panel de Agent Office el ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')}. No se continúa: un encargo nuevo empieza con otro slug.\n\n${content}`);
      }
    } catch {
      return;
    }
    const root = this.docsRoot();
    this.background(this.docsQueue.run(root, () => commitDocument(this.git, root, ref.path, `redaccion: ${ref.slug} descartado`)));
  }

  private commitRound(ref: DocRef, round: number | null): void {
    const root = this.docsRoot();
    const message = `${ref.kind === 'plan' ? 'redaccion' : 'taller'}: ${ref.slug} ronda ${round ?? '?'}`;
    const paths = ref.kind === 'plan' ? [ref.path, historyPath(ref.slug)] : [ref.path];
    this.background(
      this.docsQueue
        .run(root, () => commitDocument(this.git, root, paths, message))
        .then((outcome) => {
          if (outcome === 'failed') {
            this.pushActivity({
              ts: this.now(),
              agentKey: 'redaccion',
              event: 'Commit',
              tool: null,
              state: null,
              summary: { key: 'hub.act.commitFailed', params: { path: ref.path, root } },
            });
          }
        }),
    );
  }

  private captureAgentLesson(agent: AgentRuntime, raw: string, now: number): void {
    const roleId = roleIdOf(agent.role);
    if (!roleId) return;
    const result = captureLesson(
      this.opts.db,
      { floor: agent.floor, role: roleId, text: raw, origin: 'agent', agentKey: agent.key, now },
      this.config.memory,
    );
    if (result.status === 'saved') this.emit({ type: 'memory', floor: agent.floor, role: roleId });
    const summary: HubText =
      result.status === 'saved'
        ? { key: 'hub.act.lessonSaved', params: { role: roleText(roleId), floor: floorText(agent.floor) } }
        : result.status === 'duplicate'
          ? { key: 'hub.act.lessonDuplicate' }
          : result.status === 'cap'
            ? { key: 'hub.act.lessonCap', params: { max: this.config.memory.maxLessonsPerSession } }
            : { key: 'hub.act.lessonEmpty' };
    this.pushActivity({ ts: now, agentKey: agent.key, event: 'Lesson', tool: 'SendMessage', state: null, summary });
  }

  private touchSession(e: HookEvent, meta: HookMeta, now: number): SessionRuntime {
    const cwd = text(e.cwd);
    let session = this.sessions.get(e.session_id);
    let changed = false;
    if (!session) {
      const floor = this.floors.resolve(cwd);
      session = {
        sessionId: e.session_id,
        cwd,
        floor: floor.slug,
        floorKind: floor.kind,
        stack: floor.stack,
        role: null,
        name: null,
        socket: null,
        token: null,
        team: null,
        startedAt: now,
        updatedAt: now,
        endedAt: null,
      };
      this.sessions.set(e.session_id, session);
      changed = true;
    } else if (cwd && cwd !== session.cwd) {
      session.cwd = cwd;
      this.applyFloor(session, this.floors.resolve(cwd));
      changed = true;
    }
    for (const field of ['socket', 'token', 'role', 'name'] as const) {
      const value = field === 'role' ? canonicalRole(meta.role) : meta[field];
      if (value && value !== session[field]) {
        session[field] = value;
        changed = true;
      }
    }
    const title = text(e.session_title);
    if (title && !session.name) {
      session.name = title;
      changed = true;
    }
    const team = text(e.team_name);
    if (team && team !== session.team) {
      session.team = team;
      changed = true;
    }
    if (session.endedAt !== null && e.hook_event_name === 'SessionStart') {
      session.endedAt = null;
      changed = true;
    }
    session.updatedAt = now;
    if (changed) {
      this.persistSession(session);
      this.emit({ type: 'session', data: this.sessionView(session) });
    }
    return session;
  }

  private applyFloor(session: SessionRuntime, floor: ResolvedFloor): void {
    session.floor = floor.slug;
    session.floorKind = floor.kind;
    session.stack = floor.stack;
  }

  private touchAgent(e: HookEvent, c: Classified, session: SessionRuntime, now: number): AgentRuntime {
    let agent = this.agents.get(c.agentKey);
    if (!agent) {
      agent = {
        key: c.agentKey,
        sessionId: e.session_id,
        parentKey: c.parentKey,
        name: null,
        role: null,
        spawnType: null,
        teammate: false,
        team: null,
        floor: session.floor,
        floorKind: session.floorKind,
        touchedFloor: null,
        state: 'idle',
        stateSince: now,
        detail: '',
        tool: null,
        blockedReason: null,
        lastTest: null,
        startedAt: now,
        closing: null,
        updatedAt: now,
        endedAt: null,
        sentState: null,
        retiredAt: null,
        retiredAwake: false,
        awaitingAnswer: false,
        file: null,
        task: null,
        away: false,
      };
      this.agents.set(agent.key, agent);
    }
    const isMain = agent.key === e.session_id;
    agent.floor = session.floor;
    agent.floorKind = session.floorKind;
    if (c.parentKey && !agent.parentKey) agent.parentKey = c.parentKey;
    if (isMain && session.name) agent.name = session.name;
    if (c.team) agent.team = c.team;
    if (c.teammate && (e.hook_event_name === 'TeammateIdle' || e.agent_id)) agent.name = c.teammate;

    if (c.spawnCall?.toolUseId) {
      remember(this.spawnCalls, c.spawnCall.toolUseId, c.spawnCall);
      if (c.spawnCall.name) remember(this.spawnCallsByName, `${e.session_id}:${c.spawnCall.name}`, c.spawnCall);
    }
    if (c.spawned) {
      if (c.spawned.teammate) remember(this.teammateIds, c.spawned.agentId, true);
      const call = this.spawnCalls.get(c.spawned.toolUseId);
      if (call) {
        this.spawnCalls.delete(c.spawned.toolUseId);
        remember(this.spawnedAgents, c.spawned.agentId, call);
      }
      const target = this.agents.get(c.spawned.agentId);
      if (target) {
        if (c.spawned.teammate) target.teammate = true;
        if (call) this.applySpawn(target, call);
        this.emitAgent(target, now);
      }
    }
    if (this.teammateIds.has(agent.key) || e.hook_event_name === 'TeammateIdle') agent.teammate = true;
    const call = this.spawnedAgents.get(agent.key);
    if (call) this.applySpawn(agent, call);
    if (!isMain && !agent.spawnType) this.resolveSpawnType(e, c, agent, session);
    agent.role = canonicalRole(agent.spawnType ?? c.role ?? agent.role ?? (isMain ? session.role : null));

    if (agent.team && !agent.parentKey) {
      const lead = this.leadSession(agent.team);
      if (lead && lead.sessionId !== agent.key) agent.parentKey = lead.sessionId;
    }
    return agent;
  }

  private resolveSpawnType(e: HookEvent, c: Classified, agent: AgentRuntime, session: SessionRuntime): void {
    if (isOfficeRole(c.role)) {
      agent.spawnType = canonicalRole(c.role);
      return;
    }
    const candidate = agent.name ?? c.role;
    if (!candidate) return;
    const team = agent.team ?? session.team ?? teamOfSession(e.session_id);
    const type =
      this.teamMemberType(team, candidate) ??
      this.spawnCallsByName.get(`${e.session_id}:${candidate}`)?.subagentType ??
      roleFromName(candidate, session.floor, session.floorKind);
    if (!type) return;
    agent.spawnType = canonicalRole(type);
    if (!agent.name && candidate !== type) agent.name = candidate;
  }

  private applySpawn(agent: AgentRuntime, call: SpawnCall): void {
    if (!agent.name && call.name) agent.name = call.name;
    if (!agent.task) agent.task = taskLine(publicText(call.description, agent.floorKind));
    if (call.subagentType) {
      agent.spawnType = canonicalRole(call.subagentType);
      agent.role = agent.spawnType;
    }
  }

  private touchedFloor(filePath: string, ownFloor: string): string | null {
    const file = realPath(filePath);
    for (const [slug, floor] of Object.entries(this.config.floors)) {
      if (slug !== ownFloor && isInside(file, realPath(floor.path))) return slug;
    }
    return null;
  }

  private recordTask(e: HookEvent, c: Classified, agent: AgentRuntime, session: SessionRuntime, now: number): void {
    const task = c.task;
    if (!task?.taskId) return;
    const scope = c.team ?? agent.team ?? session.team ?? teamOfSession(e.session_id);
    this.sql.upsertTask.run(scope, task.taskId, task.subject, task.owner, task.status, now);
  }

  private recordMessage(message: { to: string; text: string }, from: AgentRuntime, session: SessionRuntime, now: number): void {
    const toKey = this.recipientKey(message.to, from);
    const body = publicText(message.text, session.floorKind);
    const id = Number(this.sql.insertMessage.run(now, from.key, message.to, toKey, body, session.floor).lastInsertRowid);
    const view: MessageView = { id, ts: now, fromKey: from.key, toName: message.to, toKey, text: body, floor: session.floor };
    this.messages.push(view);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    this.emit({ type: 'message', data: view });
    const recipient = toKey ? this.agents.get(toKey) : undefined;
    if (recipient && recipient !== from) this.messageReceived(recipient, assigns(from, recipient) ? body : null, now);
    if (recipient && recipient !== from && recipient.awaitingAnswer) this.answerReceived(recipient, now);
    if (body) this.handleProtocol({ to: message.to, toKey, text: body }, from, session, now);
  }

  private messageReceived(agent: AgentRuntime, body: string | null, now: number): void {
    if (agent.retiredAt !== null || agent.endedAt !== null) return;
    const task = taskLine(body);
    if (!task && !agent.away) return;
    if (task) agent.task = task;
    if (agent.away) {
      agent.away = false;
      agent.updatedAt = now;
    }
    this.emitAgent(agent, now);
  }

  private goesHome(agent: AgentRuntime, now: number): boolean {
    if (agent.away || !agent.teammate || agent.endedAt !== null || agent.retiredAt !== null) return false;
    if (agent.state !== 'idle' || agent.blockedReason !== null || agent.awaitingAnswer) return false;
    if (now - agent.updatedAt < this.config.leaveAfterMinutes * 60_000) return false;
    const lead = this.agents.get(agent.sessionId);
    if (!lead || lead === agent || lead.endedAt !== null) return true;
    return !LEAD_BUSY.has(this.view(lead, now).state);
  }

  private fileLabel(filePath: string, session: SessionRuntime): string {
    const name = basename(filePath);
    if (isPrivate(session.floorKind)) return name;
    const root = this.floors.resolve(session.cwd).path;
    if (!root) return name;
    const file = realPath(resolve(session.cwd ?? root, filePath));
    const base = realPath(root);
    return file !== base && isInside(file, base) ? relative(base, file) : name;
  }

  private answerReceived(agent: AgentRuntime, now: number): void {
    agent.awaitingAnswer = false;
    agent.state = 'working';
    agent.stateSince = now;
    agent.detail = { key: 'hub.detail.answerReceived' };
    agent.updatedAt = now;
    this.persistAgent(agent);
    this.emitAgent(agent, now);
  }

  private recipientKey(to: string, from: AgentRuntime): string | null {
    if (this.agents.has(to)) return to;
    if (to === 'main' || to === 'team-lead') {
      if (from.parentKey) return from.parentKey;
      return from.team ? (this.leadSession(from.team)?.sessionId ?? null) : null;
    }
    const named = [...this.agents.values()].filter((a) => a.name === to && a.endedAt === null);
    const sameTeam = named.find(
      (a) => (from.team !== null && a.team === from.team) || a.sessionId === from.sessionId,
    );
    if (sameTeam) return sameTeam.key;
    if (named[0]) return named[0].key;
    for (const session of this.sessions.values()) {
      if (session.name === to && session.endedAt === null) return session.sessionId;
    }
    const at = to.indexOf('@');
    return at > 0 ? this.recipientKey(to.slice(0, at), from) : null;
  }

  private directorSession(): SessionRuntime | null {
    let found: SessionRuntime | null = null;
    for (const session of this.sessions.values()) {
      if (session.endedAt !== null) continue;
      const role = session.role ?? this.agents.get(session.sessionId)?.role ?? null;
      if (canonicalRole(role) !== 'office-director') continue;
      if (!found || session.updatedAt > found.updatedAt) found = session;
    }
    return found;
  }

  private leadSession(team: string | null | undefined): SessionRuntime | null {
    if (!team) return null;
    const prefix = team.replace(/^session-/, '');
    if (!prefix) return null;
    for (const session of this.sessions.values()) {
      if (session.sessionId.startsWith(prefix)) return session;
    }
    return null;
  }

  private inScope(e: HookEvent, session: SessionRuntime): boolean {
    const team = text(e.team_name) ?? session.team;
    const lead = this.leadSession(team);
    return inOfficeScope({
      floorKind: session.floorKind,
      sessionRole: session.role ?? this.agents.get(session.sessionId)?.role ?? null,
      leadRole: lead?.role ?? null,
    });
  }

  private ownerKeys(owner: string | null, scope: string, lead: SessionRuntime): string[] {
    const inTeam = (a: AgentRuntime) => a.team === scope || a.sessionId === lead.sessionId || a.parentKey === lead.sessionId;
    const keys = new Set<string>();
    if (owner) {
      for (const a of this.agents.values()) if (a.name === owner && inTeam(a)) keys.add(a.key);
      for (const id of this.teamMemberIds(scope, owner)) keys.add(id);
    }
    if (keys.size === 0) {
      for (const a of this.agents.values()) {
        const kind = roleKind(a.role);
        if (inTeam(a) && (kind === 'dev' || kind === 'intern') && a.key !== lead.sessionId) keys.add(a.key);
      }
    }
    return [...keys];
  }

  private teamMembers(team: string): Record<string, unknown>[] {
    const now = this.now();
    const cached = this.teamCache.get(team);
    if (cached && now - cached.at < TEAM_CACHE_MS) return cached.members;
    let members: Record<string, unknown>[] = [];
    const file = join(this.opts.claudeHome, 'teams', team, 'config.json');
    try {
      if (existsSync(file)) {
        const raw = record(JSON.parse(readFileSync(file, 'utf8'))).members;
        members = Array.isArray(raw) ? raw.map((m) => record(m)) : [];
      }
    } catch {
      members = [];
    }
    this.teamCache.set(team, { at: now, members });
    return members;
  }

  private teamMemberIds(team: string, name: string): string[] {
    return this.teamMembers(team)
      .filter((m) => m.name === name)
      .map((m) => idText(m.agentId) ?? idText(m.agent_id) ?? idText(m.id))
      .filter((id): id is string => id !== null);
  }

  private teamMemberType(team: string, name: string): string | null {
    const member = this.teamMembers(team).find((m) => m.name === name);
    const type = member ? (text(member.agentType) ?? text(member.agent_type)) : null;
    return type && type !== 'team-lead' ? type : null;
  }

  private lastEdit(floor: string, keys: string[]): number | null {
    if (keys.length === 0) return null;
    const marks = keys.map(() => '?').join(', ');
    const row = this.opts.db
      .query<{ ts: number | null }, string[]>(`SELECT MAX(ts) AS ts FROM edits WHERE floor = ? AND agent_key IN (${marks})`)
      .get(floor, ...keys);
    return row?.ts ?? null;
  }

  private endSession(session: SessionRuntime, now: number): void {
    session.endedAt = now;
    this.persistSession(session);
    this.emit({ type: 'session', data: this.sessionView(session) });
    for (const agent of this.agents.values()) {
      if (agent.sessionId !== session.sessionId || agent.endedAt !== null) continue;
      agent.endedAt = now;
      this.forgetChatNotes(new Set([agent.key]));
      if (agent.state !== 'done') {
        agent.state = 'done';
        agent.stateSince = now;
      }
      this.persistAgent(agent);
      this.emitAgent(agent, now);
      this.storeReport(agent, now);
      if (this.watch.watching(agent.key)) this.background(this.watch.finish(agent.key));
    }
    for (const q of this.desk.list()) if (q.sessionId === session.sessionId) this.desk.release(q.id);
  }

  private questionOpened(view: QuestionView): void {
    this.sql.insertQuestion.run(view.id, view.sessionId, view.agentKey, view.floor, JSON.stringify(view.questions), 'pending', view.createdAt);
    this.emit({ type: 'question', data: view });
    const permission = view.kind === 'permission';
    this.pushActivity({
      ts: view.createdAt,
      agentKey: view.agentKey,
      event: permission ? 'Permission' : 'Question',
      tool: permission ? 'PermissionRequest' : 'AskUserQuestion',
      state: 'asking',
      summary: permission ? { key: 'hub.act.permissionWaiting', params: { detail: short(view.detail ?? '', 60) } } : { key: 'hub.act.questionWaiting' },
    });
  }

  private questionClosed(id: string, outcome: QuestionOutcome): void {
    this.permissionHolds.delete(id);
    this.sql.closeQuestion.run(outcome, this.now(), id);
    this.emit({ type: 'question-closed', id, outcome });
  }

  private view(agent: AgentRuntime, now: number): AgentView {
    let state = agent.state;
    let detail = agent.detail;
    if (agent.endedAt === null && agent.blockedReason) {
      state = 'blocked';
      detail = agent.blockedReason;
    } else if (
      agent.endedAt === null &&
      agent.state === 'asking' &&
      now - agent.stateSince > this.config.blockedAfterMinutes * 60_000
    ) {
      state = 'blocked';
      detail = { key: 'hub.detail.noAnswer', params: { detail: agent.detail } };
    }
    return {
      key: agent.key,
      sessionId: agent.sessionId,
      parentKey: agent.parentKey,
      name: agent.name,
      role: agent.role,
      roleId: roleIdOf(agent.role),
      roleKind: roleKind(agent.role),
      floor: agent.floor,
      touchedFloor: agent.touchedFloor,
      state,
      detail,
      tool: agent.tool,
      lastTest: agent.lastTest,
      stateSince: agent.stateSince,
      updatedAt: agent.updatedAt,
      endedAt: agent.endedAt,
      file: agent.file,
      task: agent.task,
      away: agent.away || agent.endedAt !== null || agent.retiredAt !== null,
    };
  }

  private sessionView(session: SessionRuntime): SessionView {
    return {
      sessionId: session.sessionId,
      agentKey: session.sessionId,
      name: session.name,
      role: session.role,
      floor: session.floor,
      canReceive: session.endedAt === null && !!session.socket && existsSync(session.socket),
      endedAt: session.endedAt,
    };
  }

  private emitAgent(agent: AgentRuntime, now: number): void {
    const view = this.view(agent, now);
    agent.sentState = view.state;
    this.emit({ type: 'agent', data: view });
  }

  private pushActivity(entry: ActivityView): void {
    this.activity.push(entry);
    if (this.activity.length > MAX_ACTIVITY) this.activity.splice(0, this.activity.length - MAX_ACTIVITY);
    this.emit({ type: 'activity', data: entry });
  }

  private emit(msg: ServerMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(msg);
      } catch {
        this.listeners.delete(listener);
      }
    }
  }

  private persistSession(s: SessionRuntime): void {
    this.sql.upsertSession.run(s.sessionId, s.cwd, s.floor, s.role, s.name, s.socket, s.token, s.team, s.startedAt, s.updatedAt, s.endedAt);
  }

  private persistAgent(a: AgentRuntime): void {
    this.sql.upsertAgent.run(a.key, a.sessionId, a.parentKey, a.name, a.role, a.floor, a.team, a.startedAt, a.updatedAt, a.endedAt);
  }

  private restoreSessions(): void {
    for (const row of this.sql.openSessions.all(this.now() - RESTORE_WINDOW_MS)) {
      if (!row.socket || !existsSync(row.socket)) {
        this.sql.endSession.run(this.now(), row.session_id);
        continue;
      }
      const floor = this.floors.resolve(row.cwd);
      const now = this.now();
      this.agents.set(row.session_id, {
        key: row.session_id,
        sessionId: row.session_id,
        parentKey: null,
        name: row.name,
        role: canonicalRole(row.role),
        spawnType: null,
        teammate: false,
        team: row.team,
        floor: floor.slug,
        floorKind: floor.kind,
        touchedFloor: null,
        state: 'idle',
        stateSince: now,
        detail: { key: 'hub.detail.waiting' },
        tool: null,
        blockedReason: null,
        lastTest: null,
        startedAt: row.started_at,
        closing: null,
        updatedAt: now,
        endedAt: null,
        sentState: null,
        retiredAt: null,
        retiredAwake: false,
        awaitingAnswer: false,
        file: null,
        task: null,
        away: false,
      });
      this.sessions.set(row.session_id, {
        sessionId: row.session_id,
        cwd: row.cwd,
        floor: floor.slug,
        floorKind: floor.kind,
        stack: floor.stack,
        role: canonicalRole(row.role),
        name: row.name,
        socket: row.socket,
        token: row.token,
        team: row.team,
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        endedAt: null,
      });
    }
  }

  private dumpRaw(e: HookEvent, now: number): void {
    const dir = this.opts.rawDir;
    if (!dir) return;
    try {
      mkdirSync(dir, { recursive: true });
      const name = `${now}-${e.hook_event_name}-${Math.random().toString(36).slice(2, 8)}.json`;
      writeFileSync(join(dir, name), `${JSON.stringify(e, null, 2)}\n`);
    } catch {
      this.opts.rawDir = null;
    }
  }
}

export function executeOrderText(doc: Pick<DocumentView, 'path' | 'title' | 'round' | 'base'>, docsRepo: string): string {
  const floors = [...new Set(doc.base.map((b) => b.floor))];
  const rounds = `${doc.round} ${doc.round === 1 ? 'ronda' : 'rondas'}`;
  const floorList = floors.length > 0 ? floors.join(', ') : 'las que indique el plan';
  const leads = floors.length > 0 ? ` (${floors.map((f) => `\`lead-${f}\``).join(', ')})` : '';
  return [
    `Ejecuta el plan ${doc.path} («${doc.title}»), aprobado por Redacción en ${rounds}.`,
    `Plantas: ${floorList}.`,
    `Léelo en \`${docsRepo}/${doc.path}\`, divídelo por planta según sus Pasos y manda a cada jefe${leads} su parte con la ruta del plan; ya lo conocen por el aviso PLAN de Redacción.`,
    'Avísame cuando terminen todas.',
  ].join(' ');
}

export function analysisOrderText(doc: Pick<DocumentView, 'path' | 'title'>, docsRepo: string): string {
  return [
    `Analiza el documento \`${doc.path}\` («${doc.title}») que te ha entregado Redacción.`,
    `Léelo en \`${docsRepo}/${doc.path}\` y, antes de encargar nada, pregúntame con AskUserQuestion qué planes de implementación quieres que encargue a Redacción y en qué orden (opciones: las acciones que propone el documento).`,
    'Encarga solo los que elija, en ese orden, y avísame.',
  ].join(' ');
}

function assigns(from: AgentRuntime, to: AgentRuntime): boolean {
  return from.parentKey !== to.key && roleKind(to.role) !== 'director';
}

const SEPARATORS: ReadonlySet<string> = new Set(['\n', ';', '|', '&', '(', ')']);

// The raw text of each command of a shell line, split where tokenize splits (; | & newlines and parentheses)
// outside quotes; the &> and >& redirections do not split.
function shellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  const end = () => {
    if (current.trim()) segments.push(current.trim());
    current = '';
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? '';
    if (ch === '\\' && quote !== "'" && i + 1 < command.length) {
      current += ch + (command[++i] ?? '');
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    const redirect = ch === '&' && (command[i + 1] === '>' || current.endsWith('>') || current.endsWith('<'));
    if (!redirect && SEPARATORS.has(ch)) end();
    else current += ch;
  }
  end();
  return segments;
}

const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash']);

function isChatCall(segment: string): boolean {
  const words = [...(tokenize(segment)[0] ?? [])];
  while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) words.shift();
  if (SHELLS.has(basename(words[0] ?? ''))) {
    words.shift();
    while ((words[0] ?? '').startsWith('-')) words.shift();
  }
  const first = words[0];
  return !!first && (first === CHAT_SCRIPT || basename(first) === 'office-chat.sh');
}

// A shell line without its calls to the chat script, or null when it has none. Nothing is taken out of a line
// with $( or backticks: whatever they run, even inside a chat message, really runs.
export function chatFreeCommand(command: string): string | null {
  if (command.includes('$(') || command.includes('`')) return null;
  const segments = shellSegments(command);
  const rest = segments.filter((segment) => !isChatCall(segment));
  return rest.length === segments.length ? null : rest.join('; ');
}

export function isChatCommand(command: string): boolean {
  return chatFreeCommand(command) === '';
}

const CHAT_COMMAND_EVENTS: ReadonlySet<string> = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);

// A call to the chat script is talking, not testing: whatever its text says, it must not count as a test run.
// The rest of the line is classified on its own, so a real test next to it still counts.
function withoutChatCalls(c: Classified, e: HookEvent, matchers: Matchers): Classified {
  if (c.tool !== 'Bash' || !CHAT_COMMAND_EVENTS.has(c.event)) return c;
  const input = record(e.tool_input);
  const command = text(input.command);
  const rest = command === null ? null : chatFreeCommand(command);
  if (rest === null) return c;
  if (rest !== '') return classify({ ...e, tool_input: { ...input, command: rest } }, matchers);
  c.test = null;
  c.command = null;
  c.state = 'working';
  c.summary = { key: 'hub.act.chatCommand' };
  c.detail = { key: 'hub.act.chatCommand' };
  return c;
}

export function taskLine(body: string | null): string | null {
  if (!body) return null;
  let rest = body.trim();
  if (rest.startsWith(ORDER_LEAD)) rest = rest.slice(ORDER_LEAD.length).trim();
  else if (rest.startsWith(ORDER_PREFIX) || rest.startsWith(CHAT_PREFIX) || rest.startsWith('<') || rest.startsWith('/')) return null;
  if (parseProtocol(rest) !== null) return null;
  const line = rest
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line ? short(line, TASK_MAX) : null;
}

export function historyPath(slug: string): string {
  return `redaccion/historial/${slug}.md`;
}

export function permissionMatch(tool: string, input: Record<string, unknown>): string {
  return `${tool}|${JSON.stringify(input)}`;
}

export function permissionPrompt(tool: string, who: string): HubText {
  if (tool === 'Bash') return { key: 'hub.permission.bash', params: { who } };
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') return { key: 'hub.permission.edit', params: { who } };
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return { key: 'hub.permission.read', params: { who } };
  if (tool === 'WebFetch' || tool === 'WebSearch') return { key: 'hub.permission.web', params: { who } };
  return { key: 'hub.permission.other', params: { who, tool } };
}

export function permissionDetail(tool: string, input: Record<string, unknown>): string {
  const value =
    text(input.command) ??
    text(input.file_path) ??
    text(input.notebook_path) ??
    text(input.url) ??
    text(input.query) ??
    (text(input.pattern) ? `${input.pattern as string}${text(input.path) ? ` (${input.path as string})` : ''}` : null);
  return short(value ?? `${tool} ${JSON.stringify(input)}`, 600);
}

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_SPAWNS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function parseList(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function prepare(db: Database) {
  return {
    insertEvent: db.query(
      'INSERT INTO events (ts, session_id, agent_key, floor, event, tool, state, path, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    upsertSession: db.query(
      `INSERT INTO sessions (session_id, cwd, floor, role, name, socket, token, team, started_at, updated_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET cwd = excluded.cwd, floor = excluded.floor, role = excluded.role,
         name = excluded.name, socket = excluded.socket, token = excluded.token, team = excluded.team,
         updated_at = excluded.updated_at, ended_at = excluded.ended_at`,
    ),
    upsertAgent: db.query(
      `INSERT INTO agents (agent_key, session_id, parent_key, name, role, floor, team, started_at, updated_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_key) DO UPDATE SET session_id = excluded.session_id, parent_key = excluded.parent_key,
         name = excluded.name, role = excluded.role, floor = excluded.floor, team = excluded.team,
         updated_at = excluded.updated_at, ended_at = excluded.ended_at`,
    ),
    openSessions: db.query<SessionRow, [number]>(
      'SELECT session_id, cwd, role, name, socket, token, team, started_at, updated_at FROM sessions WHERE ended_at IS NULL AND updated_at > ?',
    ),
    endSession: db.query('UPDATE sessions SET ended_at = ? WHERE session_id = ?'),
    insertEdit: db.query('INSERT INTO edits (ts, agent_key, floor, path) VALUES (?, ?, ?, ?)'),
    editsBetween: db.query<{ path: string | null }, [string, number, number]>('SELECT path FROM edits WHERE floor = ? AND ts BETWEEN ? AND ?'),
    floorActive: db.query<{ one: number }, [string, number, number]>('SELECT 1 AS one FROM events WHERE floor = ? AND ts BETWEEN ? AND ? LIMIT 1'),
    insertVerdict: db.query(
      'INSERT INTO verdicts (ts, agent_key, role, floor, kind, ok, command, path, round, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    agentVerdict: db.query<{ id: number }, [string, string]>(
      "SELECT id FROM verdicts WHERE agent_key = ? AND path = ? AND kind IN ('approved', 'improve', 'no-agreement') LIMIT 1",
    ),
    firstVerdictOf: db.query<{ ts: number | null }, [string]>(
      "SELECT MIN(ts) AS ts FROM verdicts WHERE agent_key = ? AND kind IN ('approved', 'improve', 'no-agreement')",
    ),
    lastTesterGreen: db.query<{ ts: number | null }, [string]>(
      "SELECT MAX(ts) AS ts FROM verdicts WHERE floor = ? AND kind = 'tests' AND ok = 1 AND role LIKE 'office-tester-%'",
    ),
    lastApproved: db.query<{ ts: number | null }, [string]>("SELECT MAX(ts) AS ts FROM verdicts WHERE path = ? AND kind = 'approved'"),
    insertMessage: db.query('INSERT INTO messages (ts, from_key, to_name, to_key, text, floor) VALUES (?, ?, ?, ?, ?, ?)'),
    upsertTask: db.query(
      `INSERT INTO tasks (scope, task_id, subject, owner, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, task_id) DO UPDATE SET subject = COALESCE(excluded.subject, tasks.subject),
         owner = COALESCE(excluded.owner, tasks.owner), status = COALESCE(excluded.status, tasks.status),
         updated_at = excluded.updated_at`,
    ),
    getTask: db.query<TaskRow, [string, string]>('SELECT owner, status FROM tasks WHERE scope = ? AND task_id = ?'),
    insertGate: db.query('INSERT INTO gate_decisions (ts, scope, task_id, decision, reason) VALUES (?, ?, ?, ?, ?)'),
    insertQuestion: db.query(
      'INSERT OR REPLACE INTO questions (id, session_id, agent_key, floor, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    closeQuestion: db.query('UPDATE questions SET status = ?, resolved_at = ? WHERE id = ?'),
    insertAlert: db.query('INSERT INTO alerts (ts, level, floor, agent_key, files) VALUES (?, ?, ?, ?, ?)'),
    recentAlerts: db.query<AlertRow, [number]>('SELECT id, ts, level, floor, agent_key, files FROM alerts ORDER BY ts DESC, id DESC LIMIT ?'),
  };
}
