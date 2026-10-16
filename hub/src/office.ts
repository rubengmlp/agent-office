import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { managedFloors } from './agents';
import { deliver, encodeInbox, orderText } from './courier';
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
import { decideDocumentGate, decideGate, type GateDecision } from './gate';
import { GitQueue, runGit, type GitRunner } from './git';
import { GUARDED_TOOLS, GuardWatch, guardDecision, zonesFor, type GuardContext, type GuardFinding } from './guard';
import { captureLesson, cleanLesson, deleteLesson, isRoleId, listLessons, memoryContext } from './memory';
import { publicDetail, publicSummary, publicText, storedPayload } from './privacy';
import { detectStack, profileFor, type Profiles } from './profiles';
import { docRef, parseProtocol, type DocRef } from './protocol';
import { PERMISSION_ALLOW, PERMISSION_DENY, QuestionDesk, parseQuestions } from './questions';
import { buildReport, saveReport, savedReport, savedReports } from './reports';
import {
  canonicalRole,
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
import { DONE_PREFIX, classify, idText, record, short, text, type Classified, type Matchers, type SpawnCall } from './state-machine';
import { SyncDesk, type SyncResult } from './sync';
import type {
  ActivityView,
  AgentState,
  AgentView,
  DocumentContent,
  DocumentView,
  FloorKind,
  GuardAlert,
  HookEvent,
  HookMeta,
  LessonView,
  MemoryView,
  MessageView,
  OfficeConfig,
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
  detail: string;
  tool: string | null;
  blockedReason: string | null;
  lastTest: TestResult | null;
  startedAt: number;
  closing: string | null;
  updatedAt: number;
  endedAt: number | null;
  sentState: AgentState | null;
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

export type LessonResult = { ok: true; lesson: LessonView } | { ok: false; status: number; error: string };

export type DiscardResult = 'ok' | 'not-found' | 'closed';

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
};

const MAX_ACTIVITY = 300;
const MAX_MESSAGES = 200;
const MAX_ALERTS = 50;
const FORGET_ENDED_MS = 10 * 60_000;
const RESTORE_WINDOW_MS = 24 * 60 * 60_000;
const MAX_SPAWNS = 500;
const TEAM_CACHE_MS = 5000;
const VERDICT_DEDUP_MS = 10 * 60_000;
const DAY_MS = 86_400_000;
const EMPTY_META: HookMeta = { socket: null, token: null, role: null, name: null };
const NO_TESTS: Matchers = { test: /(?!)/, check: /(?!)/ };

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
    });
    this.docs = new DocumentDesk({
      db: opts.db,
      root: () => this.docsRoot(),
      enabled: () => this.config.departments,
      installTargets: () => this.installTargets(),
      base: (slug) => this.sync.base(slug),
      ahead: (slug) => this.sync.ahead(slug),
      onChange: (docs) => this.emit({ type: 'documents', data: docs }),
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
    };
  }

  ingest(e: HookEvent, meta: HookMeta = EMPTY_META): string | null {
    if (!isHookEvent(e)) return null;
    const now = this.now();
    this.dumpRaw(e, now);
    const session = this.touchSession(e, meta, now);
    const kind = session.floorKind;
    const c = classify(e, isDepartmentFloor(kind) ? NO_TESTS : profileFor(this.profiles, session.stack));
    if (c.event === 'SubagentStop' && !this.agents.has(c.agentKey)) {
      this.sql.insertEvent.run(now, e.session_id, c.agentKey, session.floor, c.event, null, null, null, storedPayload(e, kind));
      return null;
    }
    const agent = this.touchAgent(e, c, session, now);

    let nextState = c.state;
    let ended = c.ended;
    if (c.event === 'SubagentStop' && agent.teammate) {
      nextState = 'idle';
      ended = false;
    }
    if (nextState === null && (c.event === 'PostToolUse' || c.event === 'PostToolUseFailure') && agent.state === 'asking') {
      nextState = 'working';
    }
    if (ended) agent.endedAt = now;
    else if (agent.endedAt !== null) agent.endedAt = null;
    if (nextState && nextState !== agent.state) {
      agent.state = nextState;
      agent.stateSince = now;
    }
    if (c.event === 'SubagentStop' && agent.teammate) agent.detail = 'esperando';
    else if (c.detail) agent.detail = publicDetail(c, kind);
    if (c.tool && c.event === 'PreToolUse') agent.tool = c.tool;
    if (c.blocked) agent.blockedReason = kind === 'observed' ? 'bloqueado' : c.blocked;
    else if (c.unblock) agent.blockedReason = null;
    if (c.filePath) agent.touchedFloor = this.touchedFloor(c.filePath, agent.floor);
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
    if (c.event === 'SubagentStart' || c.event === 'SessionStart') return this.injection(c.event, agent, session);
    return null;
  }

  async ask(e: HookEvent, meta: HookMeta = EMPTY_META): Promise<string | null> {
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
    );
  }

  async permission(e: HookEvent, meta: HookMeta = EMPTY_META): Promise<string | null> {
    if (!isHookEvent(e) || e.hook_event_name !== 'PermissionRequest') return null;
    const now = this.now();
    const session = this.touchSession(e, meta, now);
    if (!this.desk.someoneWatching() || !this.inScope(e, session)) return null;
    const tool = text(e.tool_name) ?? 'una herramienta';
    const input = record(e.tool_input);
    const key = e.agent_id ?? e.session_id;
    const who = this.agents.get(key)?.name ?? (key === e.session_id ? session.name : null) ?? 'un agente de la oficina';
    const id = `permiso-${randomUUID()}`;
    this.permissionHolds.set(id, { agentKey: key, match: permissionMatch(tool, input) });
    return this.desk.hold(
      {
        id,
        kind: 'permission',
        detail: permissionDetail(tool, input),
        agentKey: key,
        sessionId: e.session_id,
        floor: session.floor,
        questions: [
          {
            question: `¿Permites a ${who} ${permissionVerb(tool)}?`,
            header: 'Permiso',
            options: [{ label: PERMISSION_ALLOW }, { label: PERMISSION_DENY }],
          },
        ],
        createdAt: now,
      },
      input,
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
      summary: decision.pass ? `tarea cerrada: ${subject}` : `cierre bloqueado (falta tester): ${subject}`,
    });
    return decision;
  }

  gateMessage(e: HookEvent): GateDecision {
    if (!isHookEvent(e) || e.tool_name !== 'SendMessage') return { pass: true, reason: 'no es un mensaje' };
    const body = text(record(e.tool_input).message) ?? '';
    if (!DONE_PREFIX.test(body)) return { pass: true, reason: 'no es un aviso de fin' };
    const now = this.now();
    const session = this.touchSession(e, EMPTY_META, now);
    const senderRole = this.roleForEvent(e, session);
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
      summary: decision.pass ? `aviso de fin aceptado: ${short(body, 60)}` : 'aviso de fin bloqueado: falta tester',
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
      { tool: e.tool_name ?? '', input: record(e.tool_input), cwd: text(e.cwd) ?? session.cwd, role },
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
        summary: `guardia: bloquea a ${this.agents.get(key)?.name ?? role ?? 'un agente'} (${short(decision.reason.replace(/^Guardia de Agent Office: /, ''), 80)})`,
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
      summary: `orden desde el panel: ${short(body, 60)}`,
    });
    return 'ok';
  }

  memoryView(floor: string, role: RoleId): MemoryView {
    return { floor, role, lessons: listLessons(this.opts.db, floor, role), reports: savedReports(this.opts.db, floor, role, 10) };
  }

  addLesson(raw: unknown): LessonResult {
    const body = record(raw);
    const floor = text(body.floor);
    const role = body.role;
    const lessonText = text(body.text);
    if (!floor || floor.length > 80) return { ok: false, status: 400, error: 'floor es obligatorio' };
    if (!isRoleId(role)) return { ok: false, status: 400, error: 'role no es un rol de la oficina' };
    if (!lessonText || !cleanLesson(lessonText)) return { ok: false, status: 400, error: 'La lección está vacía' };
    const result = captureLesson(
      this.opts.db,
      { floor, role, text: lessonText, origin: 'user', agentKey: null, now: this.now() },
      this.config.memory,
    );
    if (result.status === 'saved') {
      this.emit({ type: 'memory', floor, role });
      return { ok: true, lesson: result.lesson };
    }
    if (result.status === 'duplicate') return { ok: false, status: 409, error: 'Esa lección ya está guardada' };
    return { ok: false, status: 400, error: 'No se pudo guardar la lección' };
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
    if (doc.status === 'cerrado' || doc.status === 'descartado') return 'closed';
    const now = this.now();
    this.docs.markDiscarded({ path: doc.path, kind: doc.kind, slug: doc.slug }, now);
    this.refreshDocuments();
    this.pushActivity({ ts: now, agentKey: 'panel', event: 'Discard', tool: null, state: null, summary: `plan descartado desde el panel: ${doc.path}` });
    await this.sync.remove(doc.slug);
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
        summary: `fuentes preparadas para ${result.slug}: ${result.floors.map((f) => f.floor).join(', ')}`,
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
    for (const id of sessionIds) this.sessions.delete(id);
    const keptMessages = this.messages.filter((message) => message.floor !== slug);
    this.messages.splice(0, this.messages.length, ...keptMessages);
    const keptActivity = this.activity.filter((entry) => !keys.has(entry.agentKey));
    this.activity.splice(0, this.activity.length, ...keptActivity);

    const rows = purgeFloorData(this.opts.db, slug, path);
    const now = this.now();
    this.pushActivity({ ts: now, agentKey: 'panel', event: 'FloorRemoved', tool: null, state: null, summary: `planta borrada desde el panel: ${slug}` });
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
      summary: `${finding.level === 'alerta' ? 'alerta' : 'posible cambio'}: ${finding.files.length} fichero(s) de ${finding.floor} cambiaron sin atribuir mientras trabajaba ${who}`,
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
    if (!remembers(agent.floorKind)) return;
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

  private injection(event: string, agent: AgentRuntime, session: SessionRuntime): string | null {
    const roleId = roleIdOf(agent.role);
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
      summary: `memoria entregada: ${lessons.length} lecciones y ${reports.length} informes`,
    });
    return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
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
        ? `entrega aceptada: ${ref?.path ?? short(body, 60)}`
        : `entrega bloqueada: ${ref ? `${ref.path} sin aprobación vigente` : 'falta la ruta del documento'}`,
    });
    if (decision.pass && ref && isLeadRole(role)) {
      this.docs.markClosed(ref, now);
      this.refreshDocuments();
      if (ref.kind === 'plan') this.background(this.sync.remove(ref.slug));
    }
    return decision;
  }

  private handleProtocol(body: string, from: AgentRuntime, session: SessionRuntime, now: number): void {
    if (!remembers(session.floorKind)) return;
    const parsed = parseProtocol(body);
    if (!parsed) return;
    if (parsed.kind === 'lesson') {
      this.captureAgentLesson(from, parsed.rest, now);
      return;
    }
    if (!isDepartmentFloor(session.floorKind)) return;
    const ref = docRef(parsed.target, this.docsRoot(), session.cwd);
    if (!ref) return;
    const round = parsed.round;
    if (parsed.kind === 'review' && isAuthorRole(from.role)) {
      this.docs.markRequested(ref, round, now);
      this.commitRound(ref, round);
      this.refreshDocuments();
      this.pushActivity({
        ts: now,
        agentKey: from.key,
        event: 'Review',
        tool: 'SendMessage',
        state: null,
        summary: `pide revisión de ${ref.path}${round ? ` (ronda ${round})` : ''}`,
      });
      return;
    }
    const verdict: VerdictKind | null =
      parsed.kind === 'improve' ? 'improve' : parsed.kind === 'approved' ? 'approved' : parsed.kind === 'no-agreement' ? 'no-agreement' : null;
    if (!verdict || !isVerdictRole(from.role)) return;
    const duplicate = this.sql.recentVerdict.get(from.key, ref.path, verdict, round ?? -1, now - VERDICT_DEDUP_MS);
    if (!duplicate) {
      this.sql.insertVerdict.run(now, from.key, from.role, session.floor, verdict, verdict === 'approved' ? 1 : 0, null, ref.path, round, parsed.score);
    }
    this.docs.markRound(ref, round, now);
    if (verdict === 'approved' && !duplicate) {
      this.commitRound(ref, round);
      if (ref.kind === 'plan') this.background(this.sync.checkAhead(ref.slug));
    }
    this.refreshDocuments();
    if (duplicate) return;
    const label = verdict === 'approved' ? 'aprueba' : verdict === 'improve' ? 'pide mejoras en' : 'sin acuerdo en';
    const score = parsed.score !== null ? ` · nota ${parsed.score}/10` : '';
    this.pushActivity({
      ts: now,
      agentKey: from.key,
      event: 'Verdict',
      tool: 'SendMessage',
      state: null,
      summary: `${label} ${ref.path}${round ? ` (ronda ${round})` : ''}${score}`,
    });
  }

  private commitRound(ref: DocRef, round: number | null): void {
    const root = this.docsRoot();
    const message = `${ref.kind === 'plan' ? 'redaccion' : 'taller'}: ${ref.slug} ronda ${round ?? '?'}`;
    this.background(
      this.docsQueue
        .run(root, () => commitDocument(this.git, root, ref.path, message))
        .then((outcome) => {
          if (outcome === 'failed') {
            this.pushActivity({
              ts: this.now(),
              agentKey: 'redaccion',
              event: 'Commit',
              tool: null,
              state: null,
              summary: `no se pudo hacer commit de ${ref.path} en ${root}`,
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
    const summary =
      result.status === 'saved'
        ? `lección guardada para ${ROLE_LABELS[roleId]} en ${floorLabel(agent.floor)}`
        : result.status === 'duplicate'
          ? 'lección repetida: ya estaba guardada'
          : result.status === 'cap'
            ? `lección descartada: tope de ${this.config.memory.maxLessonsPerSession} por sesión`
            : 'lección vacía descartada';
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
    if (body) this.handleProtocol(body, from, session, now);
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
      summary: permission ? `permiso esperando en el panel: ${short(view.detail ?? '', 60)}` : 'pregunta esperando en el panel',
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
      detail = `sin respuesta: ${agent.detail}`;
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
        detail: 'esperando',
        tool: null,
        blockedReason: null,
        lastTest: null,
        startedAt: row.started_at,
        closing: null,
        updatedAt: now,
        endedAt: null,
        sentState: null,
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

export function permissionMatch(tool: string, input: Record<string, unknown>): string {
  return `${tool}|${JSON.stringify(input)}`;
}

export function permissionVerb(tool: string): string {
  if (tool === 'Bash') return 'ejecutar este comando';
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'modificar este fichero';
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return 'leer fuera de su carpeta';
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'consultar la web';
  return `usar ${tool}`;
}

export function permissionDetail(tool: string, input: Record<string, unknown>): string {
  const value =
    text(input.command) ??
    text(input.file_path) ??
    text(input.notebook_path) ??
    text(input.url) ??
    text(input.query) ??
    (text(input.pattern) ? `${input.pattern as string}${text(input.path) ? ` en ${input.path as string}` : ''}` : null);
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
    recentVerdict: db.query<{ id: number }, [string, string, string, number, number]>(
      'SELECT id FROM verdicts WHERE agent_key = ? AND path = ? AND kind = ? AND COALESCE(round, -1) = ? AND ts >= ? LIMIT 1',
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
