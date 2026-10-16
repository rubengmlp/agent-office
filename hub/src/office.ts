import type { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { CHAT_SCRIPT, managedFloors } from './agents';
import { ChatDesk, GLOBAL_CHANNEL, READ_LIMIT, SNAPSHOT_LIMIT, USER_NAME, isChatKind, normalizeChatPath, type ChatAuthor, type ChatError, type ChatUnread } from './chat';
import { chatInboxText, deliver, encodeInbox, orderText } from './courier';
import { writeAtomic } from './config';
import { commitDocument } from './docs-repo';
import { DocumentDesk, docTypeOf, headBytes } from './documents';
import { FloorInUseError, purgeFloorData } from './floor-data';
import {
  DIRECCION,
  FloorResolver,
  isInside,
  memoryRegistry,
  realPath,
  type FloorRegistry,
  type GitRootFn,
  type ResolvedFloor,
} from './floors';
import { decideDocumentGate, decideGate, decideReadCap, decideReviewGate, kilobytes, planByteLimit, type GateDecision, type ReviewGateFacts } from './gate';
import { GitQueue, runGit, type GitRunner } from './git';
import { GUARDED_TOOLS, GuardWatch, fingerprint, gitIgnored, guardDecision, shellWrites, zonesFor, type GuardContext, type GuardFinding } from './guard';
import type { Log } from './log';
import { keyMatches } from './security';
import { captureLesson, cleanLesson, deleteLesson, isRoleId, listLessons, memoryContext } from './memory';
import {
  ANSWERS_QUESTION,
  DECISION_FROM,
  EMPTY_META,
  FILE_TOOLS,
  FINGERPRINT_ACTIVITY,
  FORGET_ENDED_MS,
  GHOST_MS,
  GHOST_TOOL_MS,
  HOLDS_QUESTION,
  LAUNCH_CHECK_MS,
  LEAD_BUSY,
  MAX_ACTIVITY,
  MAX_ALERTS,
  MAX_MESSAGES,
  METER_SWEEP_MS,
  NEW_TURN,
  NOT_DISCARDABLE,
  NOT_PERMISSIONS,
  NO_TESTS,
  PERSIST_EVERY_MS,
  READ_CAP_TOOLS,
  RESTORE_WINDOW_MS,
  RULES_MAX_CHARS,
  SAFE_ID,
  SAFE_NAME,
  TEAM_CACHE_MS,
  TURN_OVER,
  UNDO_MS,
  DAY_MS,
  isHookEvent,
  recentDocuments,
  remember,
  teamOfSession,
  type AgentRuntime,
  type DecideResult,
  type DiscardResult,
  type LaunchPaths,
  type LessonResult,
  type OrderResult,
  type RelaunchResult,
  type RestoreResult,
  type SessionRuntime,
  type TmuxFn,
} from './office-state';
import { chatFreeCommand, withoutChatCalls } from './chat-commands';
import {
  RULES_NOTE,
  STATUS_REQUEST,
  VERDICT_DETAILS,
  DISCARDED_MARK,
  ROLE_LABELS,
  analysisOrderText,
  executeOrderText,
  floorLabel,
  historyPath,
  isUserPrompt,
  isoDate,
  permissionDetail,
  permissionMatch,
  permissionPrompt,
  taskLine,
  withoutDiscardMark,
} from './office-texts';
import { ownerEdits, prepare, type AlertRow, type Sql } from './office-sql';
import { isPrivate, publicDetail, publicSummary, publicText, storedPayload, visibleKind } from './privacy';
import { detectStack, profileFor, type Profiles } from './profiles';
import { BRIEF_PREFIX, docRef, parseProtocol, parseWaiting, type DocRef } from './protocol';
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
  noLessons,
  remembers,
  roleFromName,
  roleIdOf,
  roleKind,
} from './scope';
import { RELAUNCH_RESUMES, TMUX_SESSION, sq } from './office-sh';
import { settingsView } from './settings';
import {
  BLOCK_PREFIX,
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
import { planSlugIn, planSlugOf, SWEEP_BUDGET, TokenMeter, type MeterAgent, type PlanSubject } from './tokens';
import { UsageDesk } from './usage';
import type {
  ActivityView,
  AgentView,
  ChatMessageView,
  ChatPostRequest,
  ChatPostResult,
  ChatUserResult,
  DocumentContent,
  DocumentView,
  FloorKind,
  GuardAlert,
  HookEvent,
  HookMeta,
  HubText,
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
  UsageRange,
  UsageSummary,
  VerdictKind,
} from './types';







export {
  GHOST_MS,
  GHOST_TOOL_MS,
  PERSIST_EVERY_MS,
  SNAPSHOT_CLOSED_DOCS,
  UNDO_MS,
  isHookEvent,
  recentDocuments,
  teamOfSession,
  type DecideResult,
  type DiscardResult,
  type LaunchPaths,
  type LessonResult,
  type OrderResult,
  type RelaunchResult,
  type RestoreResult,
  type TmuxFn,
} from './office-state';

export {
  DISCARDED_MARK,
  ROLE_LABELS,
  STATUS_REQUEST,
  analysisOrderText,
  executeOrderText,
  floorLabel,
  historyPath,
  isUserPrompt,
  permissionDetail,
  permissionMatch,
  permissionPrompt,
  taskLine,
  withoutDiscardMark,
} from './office-texts';
export { chatFreeCommand, isChatCommand } from './chat-commands';

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
  launch?: LaunchPaths;
  tmux?: TmuxFn;
  // Id of this hub, written in the marker of its snapshots in redaccion/.fuentes.
  hubId: string;
  // Where background failures and broken listeners are written; console.error when absent.
  log?: Log;
  // How long a discarded plan can be restored before its sources are removed.
  undoMs?: number;
};







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
  private readonly sql: Sql;
  private readonly docs: DocumentDesk;
  private readonly sync: SyncDesk;
  private readonly watch: GuardWatch;
  private readonly changes: GuardWatch;
  private readonly pendingWrites = new Map<string, { root: string; paths: Map<string, string>; gitTree: boolean }>();
  private readonly fingerprintEdits = new Map<string, true>();
  private readonly usage: UsageDesk;
  private readonly meter: TokenMeter;
  private meterSweptAt: number;
  readonly chat: ChatDesk;
  private readonly chatNudged = new Set<string>();
  private readonly chatWarned = new Set<string>();
  private readonly readCounts = new Map<string, number>();
  private readonly readCapNoted = new Set<string>();
  private readonly lastUserInput = new Map<string, number>();
  private readonly briefAllowance = new Map<string, number>();
  private readonly sessionFlags = new Map<string, string>();
  private readonly tmux: TmuxFn;
  private readonly log: Log;
  private readonly undoMs: number;
  private readonly removals = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly deciding = new Set<string>();
  private readonly hashes = new Map<string, { mtime: number; size: number; hash: string | null }>();
  private lastLaunchCheck = 0;

  constructor(private readonly opts: OfficeOptions) {
    this.config = opts.config;
    this.profiles = opts.profiles;
    this.now = opts.now ?? Date.now;
    this.deliverFn = opts.deliverFn ?? deliver;
    this.tmux = opts.tmux ?? runTmux;
    this.log = opts.log ?? ((text) => console.error(`Agent Office: ${text}`));
    this.undoMs = opts.undoMs ?? UNDO_MS;
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
      onChange: (docs) => this.emit({ type: 'documents', data: this.withPlanTokens(docs) }),
      maxRounds: () => this.config.review.maxRounds,
    });
    this.watch = new GuardWatch({
      git: this.git,
      floors: () => this.guardFloors(),
      now: this.now,
      attributed: (floor, from, to) => this.attributedFiles(floor, from, to, false),
      active: (floor, from, to) => this.sql.floorActive.get(floor, from, to) !== null,
      exempt: (agentKey) => {
        const agent = this.agents.get(agentKey);
        const own = agent ? (zonesFor(agent.role, this.guardContext())?.allowed ?? []) : [];
        return [...own, ...this.installTargets().map((target) => realPath(target.dir))];
      },
      report: (finding) => this.recordAlert(finding),
    });
    this.changes = new GuardWatch({
      git: this.git,
      headDiff: true,
      floors: () => this.guardFloors(),
      now: this.now,
      attributed: (floor, from, to) => this.attributedFiles(floor, from, to, true),
      active: () => false,
      exempt: () => this.installTargets().map((target) => realPath(target.dir)),
      report: (finding) => this.recordBashChanges(finding),
    });
    this.usage = new UsageDesk(this.now, (view) => this.emit({ type: 'usage', data: view }));
    this.meter = new TokenMeter({
      db: opts.db,
      claudeHome: opts.claudeHome,
      now: this.now,
      onRead: (data) => this.emit({ type: 'tokens', data }),
    });
    this.meterSweptAt = this.now();
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
    // A question still pending in the database lost the request that held it when the hub went down.
    this.sql.releaseStalePending.run(this.now());
    this.docs.watch();
    this.refreshDocuments();
    this.background(this.sync.cleanup(this.docs.finishedPlanSlugs()));
  }

  stop(): void {
    this.docs.unwatch();
    for (const timer of this.removals.values()) clearTimeout(timer);
    this.removals.clear();
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
      documents: this.withPlanTokens(recentDocuments(this.docs.list())),
      alerts: this.alerts(),
      usage: this.usage.view(),
      chat: this.chat.recent(SNAPSHOT_LIMIT),
    };
  }

  ingestUsage(raw: unknown): string {
    const sessionId = text(record(raw).session_id);
    if (sessionId) {
      this.meter.noteSession(sessionId, record(raw).transcript_path);
      this.meter.noteAgent(sessionId, record(raw).transcript_path);
    }
    return this.usage.ingest(raw);
  }

  // One transaction per event: the writes of a hook (event, agent, edit, verdict, report) commit together, once.
  ingest(e: HookEvent, meta: HookMeta = EMPTY_META): string | null {
    if (!isHookEvent(e)) return null;
    return this.opts.db.transaction(() => this.ingestEvent(e, meta))();
  }

  private ingestEvent(e: HookEvent, meta: HookMeta): string | null {
    const now = this.now();
    this.dumpRaw(e, now);
    const session = this.touchSession(e, meta, now);
    if (e.hook_event_name === 'SessionStart' && (e.source === 'startup' || e.source === 'resume')) this.setBaseline(session);
    const kind = visibleKind(session.floorKind, this.sessionInOffice(session, text(e.team_name)));
    const matchers = isDepartmentFloor(session.floorKind) ? NO_TESTS : profileFor(this.profiles, session.stack);
    const c = withoutChatCalls(classify(e, matchers), e, matchers);
    const byName = c.event === 'TeammateIdle' && !e.agent_id && c.agentKey !== e.session_id && !this.agents.has(c.agentKey);
    const owner = byName ? this.liveTeammate(c.teammate, c.team ?? session.team ?? teamOfSession(e.session_id), e.session_id) : null;
    if (owner) c.agentKey = owner.key;
    if ((c.event === 'SubagentStop' || byName) && !this.agents.has(c.agentKey)) {
      this.sql.insertEvent.run(now, e.session_id, c.agentKey, session.floor, c.event, null, null, null, storedPayload(e, kind));
      return null;
    }
    this.trackOpenTools(e, c, session, now);
    this.noteTranscripts(e, c.agentKey);
    const agent = this.touchAgent(e, c, session, now);
    if (this.isRetired(agent)) {
      this.ingestRetired(e, c, agent, session, now);
      return this.readCap(c, agent, session, true, now);
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
      agent.waiting = null;
      agent.stalledSince = null;
      this.forgetChatNotes(new Set([agent.key]));
    }
    else if (agent.endedAt !== null) agent.endedAt = null;
    if (nextState && nextState !== agent.state) {
      agent.state = nextState;
      agent.stateSince = now;
    }
    if (agent.stalledSince !== null && agent.state !== 'idle') agent.stalledSince = null;
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
    const isMain = agent.key === session.sessionId;
    if (c.event === 'UserPromptSubmit' && isMain) {
      const task = taskLine(publicText(text(e.prompt), kind));
      if (task) {
        agent.task = task;
        this.openTask(agent, now);
      }
      const plan = planSlugIn(text(e.prompt));
      if (plan) this.setPlan(agent, plan);
      if (isUserPrompt(text(e.prompt))) this.userInstructed(session.sessionId, now);
    }
    if (c.event === 'PostToolUse' && isMain && c.tool === 'AskUserQuestion') this.userInstructed(session.sessionId, now);
    if (c.event === 'PostToolUse' && c.tool === 'SendMessage' && agent.taskOpenSince !== null && DONE_PREFIX.test(text(record(e.tool_input).message) ?? '')) {
      agent.taskOpenSince = null;
      agent.stalledSince = null;
      this.persistTaskOpen(agent);
    }
    const closing = text(e.last_assistant_message);
    if (closing && remembers(kind) && (c.event === 'SubagentStop' || c.event === 'Stop')) agent.closing = closing;
    const closingProtocol = closing && c.event === 'Stop' && remembers(kind) ? parseProtocol(closing) : null;
    if (closingProtocol?.kind === 'waiting') this.declareWaiting(agent, closingProtocol.rest, now);
    agent.updatedAt = now;

    if (c.edit !== null) this.sql.insertEdit.run(now, agent.key, session.floor, publicText(c.edit, kind) ?? '');
    this.bashWrites(e, c, agent, session, kind, matchers, now);
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
    this.trackChanges(agent, kind, c.event, ended);
    this.settlePermissions(agent.key, c.event, c.tool, e.tool_input);
    if (c.event === 'SubagentStop' || c.event === 'Stop' || c.event === 'SessionEnd') this.storeReport(agent, now);

    if (TURN_OVER.has(c.event)) this.meterLater(agent);
    if (c.sessionEnded) this.endSession(session, now);
    if (c.event === 'SubagentStart' || c.event === 'SessionStart' || c.event === 'UserPromptSubmit') return this.injection(c.event, agent, session);
    if (c.event === 'PreToolUse' && c.tool && EDIT_TOOLS.has(c.tool) && c.filePath) return this.chatReminder(agent, session, c.filePath, now);
    return this.readCap(c, agent, session, false, now);
  }

  // A PreToolUse with no PostToolUse yet is a tool still running (a long build): such a session is not a ghost for hours.
  private trackOpenTools(e: HookEvent, c: Classified, session: SessionRuntime, now: number): void {
    const open = session.openTools;
    const id = text(e.tool_use_id) ?? `${c.agentKey}:${c.tool ?? ''}`;
    if (c.event === 'PreToolUse' && c.tool) {
      open.set(id, { agentKey: c.agentKey, since: now });
    } else if (c.event === 'PostToolUse' || c.event === 'PostToolUseFailure') {
      open.delete(id);
    } else if (c.event === 'UserPromptSubmit' || c.event === 'Stop' || c.event === 'SessionStart' || c.event === 'SessionEnd') {
      open.clear();
    } else if (c.event === 'SubagentStop' || c.event === 'TeammateIdle') {
      for (const [key, tool] of open) if (tool.agentKey === c.agentKey) open.delete(key);
    }
  }

  private readCap(c: Classified, agent: AgentRuntime, session: SessionRuntime, retired: boolean, now: number): string | null {
    if (c.event !== 'PreToolUse' || !READ_CAP_TOOLS.has(c.tool ?? '') || !isVerdictRole(agent.role) || !isDepartmentFloor(session.floorKind)) {
      return null;
    }
    const count = this.readCounts.get(agent.key) ?? this.sql.countReads.get(agent.key)?.n ?? 0;
    const decision = decideReadCap({ count, max: this.config.review.maxReviewerReads, retired });
    this.readCounts.set(agent.key, decision.pass ? count + 1 : count);
    if (decision.pass) return null;
    if (!retired && !this.readCapNoted.has(agent.key)) {
      this.readCapNoted.add(agent.key);
      this.pushActivity({
        ts: now,
        agentKey: agent.key,
        event: 'ReadCap',
        tool: c.tool,
        state: null,
        summary: { key: 'hub.act.readCapReached', params: { who: agent.name ?? agent.key, n: count } },
      });
    }
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } });
  }

  async ask(e: HookEvent, meta: HookMeta = EMPTY_META, signal?: AbortSignal): Promise<string | null> {
    if (!isHookEvent(e) || e.tool_name !== 'AskUserQuestion') return null;
    const now = this.now();
    const session = this.touchSession(e, meta, now);
    if (!this.desk.someoneWatching() || !this.sessionInOffice(session, text(e.team_name))) return null;
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
    if (!this.desk.someoneWatching() || !this.sessionInOffice(session, text(e.team_name))) return null;
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
    const lastTesterGreen = this.sql.lastTesterGreen.get(lead.floor)?.ts ?? null;
    const edits = ownerEdits(this.opts.db, this.config.floors, lead.floor, keys, lastTesterGreen);
    const decision = decideGate({
      officeTeam: isLeadRole(leadRole),
      floorManaged: lead.floorKind === 'managed',
      owner,
      lastOwnerEdit: edits.last,
      lastTesterGreen,
      changed: edits.files,
      changedTotal: edits.total,
      fingerprintPending: this.changes.busy(lead.floor),
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
    if (BRIEF_PREFIX.test(body)) return this.gateBrief(e);
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
    const lastTesterGreen = this.sql.lastTesterGreen.get(session.floor)?.ts ?? null;
    const edits = ownerEdits(this.opts.db, this.config.floors, session.floor, this.ownerKeys(null, team, session), lastTesterGreen);
    const decision = decideGate({
      officeTeam: true,
      floorManaged: session.floorKind === 'managed',
      owner: null,
      lastOwnerEdit: edits.last,
      lastTesterGreen,
      changed: edits.files,
      changedTotal: edits.total,
      fingerprintPending: this.changes.busy(session.floor),
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
    const result = await this.deliverOrder(sessionId, body, { asTask: true });
    if (result === 'ok') this.userInstructed(sessionId, this.now());
    return result;
  }

  requestStatus(sessionId: string): Promise<OrderResult> {
    return this.deliverOrder(sessionId, STATUS_REQUEST, { asTask: false });
  }

  private async deliverOrder(sessionId: string, body: string, opts: { asTask: boolean }): Promise<OrderResult> {
    const session = this.sessions.get(sessionId);
    if (!session || session.endedAt !== null) return 'not-found';
    if (!this.sessionInOffice(session)) return 'not-office';
    if (!session.socket || !existsSync(session.socket)) return 'unreachable';
    try {
      await this.deliverFn(session.socket, encodeInbox(session.token, orderText(body)));
    } catch {
      return 'failed';
    }
    this.pushActivity({
      ts: this.now(),
      agentKey: session.sessionId,
      event: opts.asTask ? 'Order' : 'Status',
      tool: null,
      state: null,
      summary: opts.asTask
        ? { key: 'hub.act.order', params: { text: short(body, 60) } }
        : { key: 'hub.act.statusRequested', params: { who: session.name ?? session.sessionId.slice(0, 8) } },
    });
    const main = this.agents.get(sessionId);
    const plan = opts.asTask ? planSlugIn(body) : null;
    if (main && main.retiredAt === null && plan) this.setPlan(main, plan);
    const task = opts.asTask ? taskLine(publicText(body, session.floorKind)) : null;
    if (main && main.retiredAt === null && task) {
      main.task = task;
      main.away = false;
      this.openTask(main, this.now());
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
    const session = agent ? this.sessions.get(agent.sessionId) : undefined;
    if (session && !this.sessionInOffice(session)) return null;
    const report = agent ? this.buildReportFor(agent) : savedReport(this.opts.db, agentKey);
    return report ? { ...report, tokens: this.meter.totals(agentKey) } : null;
  }

  tokenSummary(range: UsageRange): UsageSummary {
    return this.meter.summary(range);
  }

  documents(): DocumentView[] {
    return this.withPlanTokens(this.docs.list());
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
    if (this.undoMs <= 0) {
      await this.sync.remove(doc.slug);
      return 'ok';
    }
    // The sources go once the window to undo has passed; stop() cancels it and the next start() sweeps the orphans.
    const timer = setTimeout(() => {
      this.removals.delete(doc.path);
      this.background(this.sync.remove(doc.slug));
    }, this.undoMs);
    timer.unref?.();
    this.removals.set(doc.path, timer);
    return 'ok';
  }

  async restoreDocument(path: string): Promise<RestoreResult> {
    const doc = this.docs.find(path);
    if (!doc || doc.kind !== 'plan') return 'not-found';
    if (doc.status !== 'descartado') return 'not-discarded';
    const now = this.now();
    const ref: DocRef = { path: doc.path, kind: doc.kind, slug: doc.slug };
    const timer = this.removals.get(doc.path);
    if (timer) clearTimeout(timer);
    this.removals.delete(doc.path);
    this.restoreFile(ref);
    this.docs.clearDiscarded(ref, now);
    this.refreshDocuments();
    this.pushActivity({ ts: now, agentKey: 'panel', event: 'Restore', tool: null, state: null, summary: { key: 'hub.act.planRestored', params: { path: doc.path } } });
    return 'ok';
  }

  // A second click on Ejecutar while the first order is still on its way must not send another one.
  async decidePlan(path: string, decision: PlanDecision): Promise<DecideResult> {
    if (this.deciding.has(path)) return 'busy';
    this.deciding.add(path);
    try {
      return await this.decide(path, decision);
    } finally {
      this.deciding.delete(path);
    }
  }

  private async decide(path: string, decision: PlanDecision): Promise<DecideResult> {
    const doc = this.docs.find(path);
    if (!doc || doc.kind !== 'plan') return 'not-found';
    if (!DECISION_FROM[decision].includes(doc.status)) return 'invalid-state';
    if (decision === 'ejecutar') {
      const director = this.directorSession();
      if (!director) return 'no-director';
      const text = doc.docType === 'analisis' ? analysisOrderText(doc, this.docsRoot()) : executeOrderText(doc, this.docsRoot());
      const sent = await this.order(director.sessionId, text);
      if (sent === 'not-found' || sent === 'not-office') return 'no-director';
      if (sent !== 'ok') return sent;
      this.briefAllowance.set(director.sessionId, new Set(doc.base.map((b) => b.floor)).size);
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
    this.meterSweep(now);
    for (const session of [...this.sessions.values()]) {
      if (session.endedAt === null && session.socket && !existsSync(session.socket)) this.endSession(session, now);
      else if (this.isGhost(session, now)) this.endSession(session, now, true);
      if (session.endedAt !== null && now - session.endedAt > FORGET_ENDED_MS) this.sessions.delete(session.sessionId);
    }
    this.detectStalls(now);
    this.refreshSessionFlags(now);
  }

  // No socket and no events: nobody can reach it and nobody is using it. A tool still open keeps it alive for longer.
  private isGhost(session: SessionRuntime, now: number): boolean {
    if (session.endedAt !== null || session.socket) return false;
    const limit = session.openTools.size > 0 ? GHOST_TOOL_MS : GHOST_MS;
    return now - session.updatedAt > limit;
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
    this.meter.forget(keys);
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
      this.emitSession(session);
      for (const agent of this.agents.values()) {
        if (agent.sessionId !== session.sessionId) continue;
        agent.floor = session.floor;
        agent.floorKind = session.floorKind;
        this.emitAgent(agent, now);
      }
    }
    this.refreshSessionFlags(now, true);
    this.emit({ type: 'floors', data: this.floors.views() });
    this.emit({ type: 'settings', data: settingsView(config) });
    this.docs.watch();
    this.refreshDocuments();
  }

  async relaunch(sessionId: string, resume: boolean = RELAUNCH_RESUMES): Promise<RelaunchResult> {
    const session = this.sessions.get(sessionId);
    if (!session || session.endedAt !== null) return 'not-found';
    if (!this.sessionInOffice(session)) return 'not-office';
    const script = this.launchFile(session);
    if (!script || !existsSync(script)) return 'no-script';
    if (!this.sessionFree(session)) return 'busy';
    if (resume && !SAFE_ID.test(sessionId)) return 'failed';
    const name = session.name ?? '';
    let windows: { code: number; stdout: string };
    try {
      windows = await this.tmux(['list-windows', '-t', TMUX_SESSION, '-F', '#{window_name}']);
    } catch {
      return 'no-tmux';
    }
    if (windows.code !== 0) return 'no-tmux';
    if (!windows.stdout.split('\n').some((line) => line.trim() === name)) return 'no-window';
    const command = resume ? `${sq(script)} --resume ${sessionId}` : sq(script);
    try {
      const respawned = await this.tmux(['respawn-window', '-k', '-t', `${TMUX_SESSION}:=${name}`, command]);
      if (respawned.code !== 0) return 'failed';
    } catch {
      return 'failed';
    }
    this.pushActivity({ ts: this.now(), agentKey: sessionId, event: 'Relaunch', tool: null, state: null, summary: { key: 'hub.act.relaunched', params: { who: name } } });
    return 'ok';
  }

  private gateBrief(e: HookEvent): GateDecision {
    const to = (text(record(e.tool_input).to) ?? '').split('@')[0] ?? '';
    if (!to.startsWith('lead-')) return { pass: true, reason: 'solo cuenta el encargo a un jefe' };
    const now = this.now();
    const session = this.touchSession(e, EMPTY_META, now);
    if (this.roleForEvent(e, session) !== 'office-director') return { pass: true, reason: 'solo cuenta el encargo del director' };
    const max = this.config.limits.maxBriefsPerOrder;
    const scope = `encargo:${session.sessionId}`;
    const sent = this.sql.countBriefs.get(scope, this.lastUserInputAt(session.sessionId))?.n ?? 0;
    const allowance = Math.max(max, this.briefAllowance.get(session.sessionId) ?? 0);
    if (max > 0 && sent >= allowance) {
      const reason = `Tope de encargos: ya has enviado ${sent} encargos desde la última instrucción del usuario (limits.maxBriefsPerOrder = ${max}). Pregunta al usuario con AskUserQuestion antes de encargar más: cuáles quiere y en qué orden.`;
      this.sql.insertGate.run(now, scope, null, 'block', reason);
      this.pushActivity({
        ts: now,
        agentKey: e.agent_id ?? session.sessionId,
        event: 'GateMessage',
        tool: 'SendMessage',
        state: null,
        summary: { key: 'hub.act.briefsCapped', params: { n: sent, max } },
      });
      return { pass: false, reason };
    }
    this.sql.insertGate.run(now, scope, null, 'pass', 'encargo dentro del presupuesto');
    return { pass: true, reason: 'encargo dentro del presupuesto' };
  }

  private lastUserInputAt(sessionId: string): number {
    const cached = this.lastUserInput.get(sessionId);
    if (cached !== undefined) return cached;
    const prompt = this.sql.recentPrompts.all(sessionId).find((row) => isUserPrompt(row.prompt));
    const at = Math.max(prompt?.ts ?? 0, this.sql.lastAsk.get(sessionId)?.ts ?? 0);
    this.lastUserInput.set(sessionId, at);
    return at;
  }

  private userInstructed(sessionId: string, now: number): void {
    this.lastUserInput.set(sessionId, now);
    this.briefAllowance.delete(sessionId);
    const agent = this.agents.get(sessionId);
    if (agent?.waiting && waitsForUser(agent.waiting.who)) agent.waiting = null;
  }

  private openTask(agent: AgentRuntime, now: number): void {
    agent.taskOpenSince = now;
    agent.waiting = null;
    agent.stalledSince = null;
    this.persistTaskOpen(agent);
  }

  private declareWaiting(agent: AgentRuntime, rest: string, now: number): boolean {
    if (agent.retiredAt !== null) return false;
    const { who, what } = parseWaiting(rest);
    if (!who || (agent.waiting?.who === who && agent.waiting.what === what)) return false;
    agent.waiting = { who, what, since: now };
    agent.stalledSince = null;
    this.pushActivity({
      ts: now,
      agentKey: agent.key,
      event: 'Waiting',
      tool: 'SendMessage',
      state: null,
      summary: { key: 'hub.act.waitingDeclared', params: { who: agent.name ?? agent.key, to: who, what } },
    });
    return true;
  }

  private settleWaiting(from: AgentRuntime, recipient: AgentRuntime | undefined, body: string | null, now: number): void {
    if (from.waiting && body && (DONE_PREFIX.test(body) || BLOCK_PREFIX.test(body))) {
      from.waiting = null;
      this.emitAgent(from, now);
    }
    if (recipient && recipient !== from && recipient.waiting && waitsFor(recipient.waiting.who, from)) {
      recipient.waiting = null;
      this.emitAgent(recipient, now);
    }
  }

  private detectStalls(now: number): void {
    const minutes = this.config.limits.stalledAfterMinutes;
    for (const agent of this.agents.values()) {
      if (agent.key !== agent.sessionId || !isLeadRole(agent.role)) continue;
      const stalled = minutes > 0 && this.isStalled(agent, now, minutes);
      if (stalled && agent.stalledSince === null) {
        agent.stalledSince = idleSince(agent);
        this.pushActivity({
          ts: now,
          agentKey: agent.key,
          event: 'Stalled',
          tool: null,
          state: null,
          summary: { key: 'hub.act.stalled', params: { who: agent.name ?? agent.key, minutes: Math.floor((now - idleSince(agent)) / 60_000) } },
        });
        this.emitAgent(agent, now);
      } else if (!stalled && agent.stalledSince !== null) {
        agent.stalledSince = null;
        this.emitAgent(agent, now);
      }
    }
  }

  private isStalled(agent: AgentRuntime, now: number, minutes: number): boolean {
    if (agent.taskOpenSince === null || agent.endedAt !== null || agent.retiredAt !== null) return false;
    if (agent.state !== 'idle' || now - idleSince(agent) <= minutes * 60_000) return false;
    if (agent.blockedReason !== null || agent.awaitingAnswer || agent.waiting !== null) return false;
    return this.sessionFree(this.sessions.get(agent.sessionId), true);
  }

  // The lead is idle and nobody of its team is working or asking, and no question of the session waits in the panel.
  private sessionFree(session: SessionRuntime | undefined, ignoreMain = false): boolean {
    if (!session) return false;
    const main = this.agents.get(session.sessionId);
    if (!ignoreMain && main && (main.state !== 'idle' || main.awaitingAnswer)) return false;
    if (this.desk.list().some((question) => question.sessionId === session.sessionId)) return false;
    for (const agent of this.agents.values()) {
      if (agent.sessionId !== session.sessionId || agent.key === session.sessionId) continue;
      if (agent.endedAt !== null || agent.retiredAt !== null || agent.away) continue;
      if (LEAD_BUSY.has(agent.state) || agent.state === 'asking') return false;
    }
    return true;
  }

  private fileHash(path: string): string | null {
    let stat;
    try {
      stat = statSync(path);
    } catch {
      this.hashes.delete(path);
      return null;
    }
    const cached = this.hashes.get(path);
    if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached.hash;
    let hash: string | null = null;
    try {
      hash = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
    } catch {
      hash = null;
    }
    this.hashes.set(path, { mtime: stat.mtimeMs, size: stat.size, hash });
    return hash;
  }

  private roleOf(session: SessionRuntime): string | null {
    const role = canonicalRole(session.role ?? this.agents.get(session.sessionId)?.role ?? null);
    return role && isOfficeRole(role) && SAFE_NAME.test(role) ? role : null;
  }

  private rulesFiles(session: SessionRuntime): string[] {
    const launch = this.opts.launch;
    const role = this.roleOf(session);
    if (!launch || !role) return [];
    return role === 'office-director' ? [join(launch.agentsDir, `${role}.md`), launch.directorFloors] : [join(launch.agentsDir, `${role}.md`)];
  }

  private launchFile(session: SessionRuntime): string | null {
    const launch = this.opts.launch;
    if (!launch || !session.name || !SAFE_NAME.test(session.name) || !this.roleOf(session)) return null;
    return join(launch.sessionsDir, `${session.name}.sh`);
  }

  private rulesHash(session: SessionRuntime): string | null {
    const files = this.rulesFiles(session);
    const hashes = files.map((file) => this.fileHash(file));
    if (hashes.length === 0 || hashes[0] === null) return null;
    return createHash('sha256').update(hashes.map((hash) => hash ?? '-').join(':')).digest('hex').slice(0, 16);
  }

  private rulesText(session: SessionRuntime): string | null {
    const files = this.rulesFiles(session);
    if (files.length === 0) return null;
    const parts: string[] = [];
    for (const [index, file] of files.entries()) {
      try {
        const content = readFileSync(file, 'utf8');
        parts.push((index === 0 ? withoutFrontmatter(content) : content).trim());
      } catch {
        if (index === 0) return null;
      }
    }
    return parts.join('\n\n');
  }

  private rulesCopy(session: SessionRuntime): string | null {
    const launch = this.opts.launch;
    if (!launch || !session.name || !SAFE_NAME.test(session.name)) return null;
    return join(dirname(launch.sessionsDir), 'rules', `${session.name}.md`);
  }

  private readRulesCopy(session: SessionRuntime): string | null {
    const file = this.rulesCopy(session);
    if (!file) return null;
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }

  private saveRulesCopy(session: SessionRuntime): void {
    const file = this.rulesCopy(session);
    const rules = this.rulesText(session);
    if (!file || rules === null) return;
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      writeAtomic(file, rules, 0o600);
    } catch {
      return;
    }
  }

  private setBaseline(session: SessionRuntime): void {
    if (!this.opts.launch) return;
    const script = this.launchFile(session);
    session.rulesHash = this.rulesHash(session);
    session.launchHash = script ? this.fileHash(script) : null;
    session.needsRelaunch = false;
    this.saveRulesCopy(session);
    this.sql.updateHashes.run(session.rulesHash, session.launchHash, session.sessionId);
    this.emitSession(session);
  }

  private rulesBlock(agent: AgentRuntime, session: SessionRuntime): string | null {
    if (session.rulesHash === null || !this.rulesPending(session)) return null;
    const rules = this.rulesText(session);
    const current = this.rulesHash(session);
    if (rules === null || current === null) return null;
    const base = this.readRulesCopy(session);
    session.rulesHash = current;
    this.sql.updateHashes.run(session.rulesHash, session.launchHash, session.sessionId);
    this.saveRulesCopy(session);
    this.emitSession(session);
    if (base === rules) return null;
    const body = base !== null && rules.length > RULES_MAX_CHARS ? changedSections(rules, base) : rules;
    this.pushActivity({
      ts: this.now(),
      agentKey: agent.key,
      event: 'Rules',
      tool: null,
      state: null,
      summary: { key: 'hub.act.rulesReloaded', params: { who: agent.name ?? agent.key } },
    });
    return `${RULES_NOTE}\n\n${body}`;
  }

  private rulesPending(session: SessionRuntime): boolean {
    if (session.rulesHash === null) return false;
    const current = this.rulesHash(session);
    return current !== null && current !== session.rulesHash;
  }

  private relaunchNeeded(session: SessionRuntime): boolean {
    if (!this.opts.launch || session.launchHash === null) return false;
    const script = this.launchFile(session);
    return !script || this.fileHash(script) !== session.launchHash;
  }

  private refreshSessionFlags(now: number, force = false): void {
    if (!this.opts.launch) return;
    const due = force || now - this.lastLaunchCheck >= LAUNCH_CHECK_MS;
    if (due) this.lastLaunchCheck = now;
    for (const session of this.sessions.values()) {
      if (session.endedAt !== null) continue;
      if (due) session.needsRelaunch = this.relaunchNeeded(session);
      if (this.sessionFlags.get(session.sessionId) !== flagsOf(this.sessionView(session))) this.emitSession(session);
    }
  }

  private background(task: Promise<unknown>): void {
    const tracked = task.catch((error: unknown) => {
      this.log(`tarea en segundo plano fallida: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
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

  // Files changed with Edit, Bash or a turn fingerprint between from and to. The department guard leaves the
  // fingerprint rows out: a file a writer changed during a developer turn is not the developer's.
  private attributedFiles(floor: string, from: number, to: number, includeFingerprints: boolean): Set<string> {
    const out = new Set<string>();
    for (const row of this.sql.editsBetween.all(floor, from, to)) {
      if (!row.path) continue;
      const path = realPath(row.path);
      if (!includeFingerprints && this.fingerprintEdits.has(fingerprintKey(floor, row.ts, path))) continue;
      out.add(path);
    }
    return out;
  }

  private recordBashChanges(finding: GuardFinding): void {
    for (const file of finding.files) {
      const path = realPath(file);
      this.sql.insertEdit.run(finding.ts, finding.agentKey, finding.floor, path);
      remember(this.fingerprintEdits, fingerprintKey(finding.floor, finding.ts, path), true);
    }
    for (const file of finding.files.slice(0, FINGERPRINT_ACTIVITY)) {
      this.pushActivity({
        ts: finding.ts,
        agentKey: finding.agentKey,
        event: 'Fingerprint',
        tool: null,
        state: null,
        summary: { key: 'hub.act.edited', params: { name: basename(file) } },
      });
    }
  }

  // Bash writes of a managed floor: the fingerprints of the candidate files before the command, compared after it.
  private bashWrites(e: HookEvent, c: Classified, agent: AgentRuntime, session: SessionRuntime, kind: FloorKind, matchers: Matchers, now: number): void {
    const id = text(e.tool_use_id);
    if (c.tool !== 'Bash' || !id) return;
    if (c.event === 'PostToolUse' || c.event === 'PostToolUseFailure') {
      const entry = this.pendingWrites.get(id);
      if (!entry) return;
      this.pendingWrites.delete(id);
      if (e.is_interrupt === true) return;
      let changed = [...entry.paths].filter(([path, before]) => fingerprint(path) !== before).map(([path]) => path);
      if (changed.length > 0 && this.changes.watching(agent.key)) {
        const ignored = gitIgnored(entry.root, changed.map((path) => relative(entry.root, path)));
        changed = changed.filter((path) => !ignored.has(path));
      }
      for (const path of changed) this.sql.insertEdit.run(now, agent.key, session.floor, path);
      if (entry.gitTree) this.sql.insertEdit.run(now, agent.key, session.floor, entry.root);
      return;
    }
    if (c.event !== 'PreToolUse' || kind !== 'managed' || c.test !== null) return;
    const input = record(e.tool_input);
    const raw = text(input.command);
    if (!raw || input.run_in_background === true) return;
    const command = chatFreeCommand(raw) ?? raw;
    const floorPath = this.config.floors[session.floor]?.path;
    if (!command.trim() || matchers.check.test(command) || !floorPath) return;
    const root = realPath(floorPath);
    const writes = shellWrites(command, text(e.cwd) ?? session.cwd, root);
    if (writes.paths.length === 0 && !writes.gitTree) return;
    remember(this.pendingWrites, id, { root, gitTree: writes.gitTree, paths: new Map(writes.paths.map((path) => [path, fingerprint(path)])) });
  }

  // The turn of a developer (or of the subagents it launches) on a managed floor: a git status fingerprint before
  // and after, for what neither Edit nor Bash declared.
  private trackChanges(agent: AgentRuntime, floorKind: FloorKind, event: string, ended: boolean): void {
    const kind = roleKind(agent.role);
    if (floorKind !== 'managed' || (kind !== 'dev' && kind !== 'intern') || agent.key === agent.sessionId) return;
    if (TURN_OVER.has(event)) {
      if (this.changes.watching(agent.key)) this.background(this.changes.finish(agent.key));
      return;
    }
    if (event === 'SessionStart' || event === 'Notification' || ended || agent.endedAt !== null || this.changes.watching(agent.key)) return;
    const floors = this.guardFloors().filter((f) => f.slug === agent.floor);
    if (floors.length === 0) return;
    this.changes.start(agent.key, floors);
    this.background(this.changes.ready(agent.key));
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
    const session = this.sessions.get(agent.sessionId);
    if (session && !this.sessionInOffice(session)) return;
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

  // The rules when they changed, first; memory on start only, and the chat lines the agent has not seen yet on start and on every turn.
  private injection(event: string, agent: AgentRuntime, session: SessionRuntime): string | null {
    const blocks = [
      event === 'UserPromptSubmit' && agent.key === session.sessionId ? this.rulesBlock(agent, session) : null,
      event === 'UserPromptSubmit' ? null : this.memoryBlock(agent, session),
      this.chatBlock(agent, session),
    ].filter((block): block is string => block !== null);
    if (blocks.length === 0) return null;
    return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: blocks.join('\n\n') } });
  }

  private memoryBlock(agent: AgentRuntime, session: SessionRuntime): string | null {
    const roleId = roleIdOf(agent.role);
    if (contextFree(roleKind(agent.role))) return null;
    if (!roleId || !remembers(session.floorKind) || !inOfficeScope({ floorKind: session.floorKind, sessionRole: agent.role, leadRole: null })) {
      return null;
    }
    const lessons = listLessons(this.opts.db, agent.floor, roleId, { userFirst: true });
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

  // REVISAR: over the round cap or of a plan over its size cap. Only a block is recorded: a REVISAR: that passes
  // already shows in the activity when ingest processes it.
  private gateReview(e: HookEvent, review: { target: string | null; round: number | null }, session: SessionRuntime, now: number): GateDecision {
    // session.cwd, as handleProtocol: touchSession has already taken the cwd of this event.
    const ref = docRef(review.target, this.docsRoot(), session.cwd);
    if (!ref) return { pass: true, reason: 'sin documento: handleProtocol tampoco lo cuenta' };
    const { decision, summary } = this.reviewBlock(ref, review.round, 'gate');
    if (decision.pass || !summary) return decision;
    this.sql.insertGate.run(now, teamOfSession(session.sessionId), ref.path, 'block', decision.reason);
    this.pushActivity({ ts: now, agentKey: e.agent_id ?? session.sessionId, event: 'GateMessage', tool: 'SendMessage', state: null, summary });
    return decision;
  }

  private reviewBlock(ref: DocRef, round: number | null, from: 'gate' | 'ingest'): { decision: GateDecision; summary: HubText | null } {
    const file = join(this.docsRoot(), ref.path);
    let bytes: number | null = null;
    if (ref.kind === 'plan') {
      try {
        bytes = statSync(file).size;
      } catch {
        bytes = null;
      }
    }
    const facts: ReviewGateFacts = {
      path: ref.path,
      round,
      maxRounds: this.config.review.maxRounds,
      bytes,
      maxBytes: this.config.review.maxPlanBytes,
      analysis: bytes !== null && docTypeOf('plan', headBytes(file)) === 'analisis',
      floors: Math.max(1, this.sync.base(ref.slug).length),
    };
    const decision = decideReviewGate(facts);
    if (decision.pass) return { decision, summary: null };
    if (decision.cause === 'rounds' && round !== null) {
      const key = from === 'gate' ? 'hub.act.reviewBlockedOverMax' : 'hub.act.reviewIgnoredOverMax';
      return { decision, summary: { key, params: { path: ref.path, round, max: facts.maxRounds } } };
    }
    const params = {
      path: ref.path,
      kb: kilobytes(bytes ?? 0),
      max: kilobytes(planByteLimit(facts.maxBytes, facts.floors, facts.analysis)),
    };
    return { decision, summary: { key: from === 'gate' ? 'hub.act.reviewBlockedTooLong' : 'hub.act.reviewIgnoredTooLong', params } };
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
      if (noLessons(roleKind(from.role))) return;
      this.captureAgentLesson(from, parsed.rest, now);
      return;
    }
    if (parsed.kind === 'waiting') {
      if (this.declareWaiting(from, parsed.rest, now)) this.emitAgent(from, now);
      return;
    }
    if (!isDepartmentFloor(session.floorKind)) return;
    const ref = docRef(parsed.target, this.docsRoot(), session.cwd);
    if (!ref) return;
    if (parsed.kind === 'split') {
      if (ref.kind === 'plan') {
        this.pushActivity({
          ts: now,
          agentKey: from.key,
          event: 'Split',
          tool: 'SendMessage',
          state: null,
          summary: { key: 'hub.act.splitRequested', params: { who: from.name ?? from.key, path: ref.path } },
        });
      }
      return;
    }
    if (parsed.kind === 'plan') {
      if (ref.kind === 'plan' && isLeadRole(from.role)) {
        this.pushActivity({ ts: now, agentKey: from.key, event: 'Plan', tool: 'SendMessage', state: null, summary: { key: 'hub.act.planNotice', params: { to: message.to, path: ref.path } } });
      }
      return;
    }
    const round = parsed.round;
    if (parsed.kind === 'review' && isAuthorRole(from.role)) {
      // gate.sh blocks it, but emit.sh runs in the same PreToolUse: no round opens and nothing is committed.
      const { decision, summary } = this.reviewBlock(ref, round, 'ingest');
      if (!decision.pass) {
        if (summary) this.pushActivity({ ts: now, agentKey: from.key, event: 'Review', tool: 'SendMessage', state: null, summary });
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
    // A SIN ACUERDO: is recorded at most at the round the document had, and without a round at that round.
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
    if (this.changes.watching(agent.key)) this.background(this.changes.finish(agent.key));
    this.persistAgent(agent);
    this.emitAgent(agent, now);
    this.storeReport(agent, now);
    this.meterLater(agent);
  }

  // The script is not a hook and brings no agent_id: the floor comes from its folder. Who signs comes from the
  // token of the session (X-Office-Token, the one the launcher gives every process of it): --de may name that
  // session or one of its agents and nobody else. A script that brings no token signs with the name it
  // declares, and cannot use --de.
  private chatAuthor(raw: ChatPostRequest, meta: HookMeta): { author: ChatAuthor; root: string; cwd: string } | ChatError {
    const cwd = raw.cwd?.trim();
    const root = cwd ? this.floors.rootOf(realPath(cwd)) : null;
    const slug = root ? managedFloors(this.config).find(([, floor]) => realPath(floor.path) === root)?.[0] : undefined;
    if (!cwd || !root || !slug) return { status: 404, error: { key: 'hub.api.chatFloorUnknown' } };
    const from = raw.from?.trim() || null;
    const unknown: ChatError = { status: 403, error: { key: 'hub.api.chatSessionUnknown' } };
    if (meta.token) {
      const caller = this.liveSessionWithToken(meta.token, slug);
      if (!caller) return unknown;
      const sessionAuthor = (name: string): ChatAuthor => ({
        key: caller.sessionId,
        name,
        role: caller.role ?? this.agents.get(caller.sessionId)?.role ?? null,
        floor: slug,
        origin: 'agent',
      });
      if (!from || from === caller.name) {
        const name = caller.name ?? meta.name;
        return name && name !== USER_NAME ? { author: sessionAuthor(name), root, cwd } : { status: 404, error: { key: 'hub.api.chatAuthorUnknown' } };
      }
      const agent = [...this.agents.values()]
        .filter((a) => a.sessionId === caller.sessionId && a.name === from && a.endedAt === null && !this.isRetired(a))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (!agent || from === USER_NAME) return unknown;
      return { author: { key: agent.key, name: from, role: agent.role, floor: slug, origin: 'agent' }, root, cwd };
    }
    if (from) return unknown;
    const name = meta.name;
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

  private liveSessionWithToken(token: string, slug: string): SessionRuntime | null {
    return [...this.sessions.values()].find((s) => keyMatches(token, s.token ?? '') && s.floor === slug && s.endedAt === null) ?? null;
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
    const kind = this.privacyKind(session, text(e.team_name));
    this.sql.insertEvent.run(now, e.session_id, agent.key, session.floor, c.event, c.tool, null, c.filePath, storedPayload(e, kind));
    if (TURN_OVER.has(c.event)) {
      agent.retiredAwake = false;
      this.meterLater(agent);
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
        const stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
        writeAtomic(file, `${DISCARDED_MARK} desde el panel de Agent Office el ${stamp}. No se continúa: un encargo nuevo empieza con otro slug.\n\n${content}`, statSync(file).mode & 0o777);
      }
    } catch {
      return;
    }
    this.commitDocumentFile(ref, `redaccion: ${ref.slug} descartado`);
  }

  private restoreFile(ref: DocRef): void {
    const file = join(this.docsRoot(), ref.path);
    try {
      const content = readFileSync(file, 'utf8');
      if (content.startsWith(DISCARDED_MARK)) writeAtomic(file, withoutDiscardMark(content), statSync(file).mode & 0o777);
    } catch {
      return;
    }
    this.commitDocumentFile(ref, `redaccion: ${ref.slug} restaurado`);
  }

  private commitDocumentFile(ref: DocRef, message: string): void {
    const root = this.docsRoot();
    this.background(this.docsQueue.run(root, () => commitDocument(this.git, root, ref.path, message)));
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
        rulesHash: null,
        launchHash: null,
        needsRelaunch: false,
        persistedAt: now,
        ghost: false,
        openTools: new Map(),
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
    const mainType = e.agent_id ? null : text(e.agent_type);
    if (!session.role && isOfficeRole(mainType)) {
      session.role = canonicalRole(mainType);
      changed = true;
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
    if (session.endedAt !== null && (e.hook_event_name === 'SessionStart' || session.ghost)) {
      session.endedAt = null;
      session.ghost = false;
      changed = true;
    }
    session.updatedAt = now;
    // updated_at decides which sessions come back after a restart: a quiet one is written at most once a minute.
    if (changed || now - session.persistedAt >= PERSIST_EVERY_MS) {
      this.persistSession(session);
      if (changed) this.emitSession(session);
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
        planSlug: null,
        waiting: null,
        taskOpenSince: null,
        stalledSince: null,
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
    const wasOffice = isOfficeRole(agent.role);
    agent.role = canonicalRole(agent.spawnType ?? c.role ?? agent.role ?? (isMain ? session.role : null));
    if (isMain && !wasOffice && isOfficeRole(agent.role)) this.emitSession(session);

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
    if (!agent.task) agent.task = taskLine(publicText(call.description, this.privacyKindOf(agent)));
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
    const body = publicText(message.text, this.privacyKind(session));
    const id = Number(this.sql.insertMessage.run(now, from.key, message.to, toKey, body, session.floor).lastInsertRowid);
    const view: MessageView = { id, ts: now, fromKey: from.key, toName: message.to, toKey, text: body, floor: session.floor };
    this.messages.push(view);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    this.emit({ type: 'message', data: view });
    const recipient = toKey ? this.agents.get(toKey) : undefined;
    this.settleWaiting(from, recipient, body, now);
    if (recipient && recipient !== from) this.messageReceived(recipient, assigns(from, recipient) ? body : null, now);
    if (recipient && recipient !== from && recipient.awaitingAnswer) this.answerReceived(recipient, now);
    if (body) this.handleProtocol({ to: message.to, toKey, text: body }, from, session, now);
  }

  private messageReceived(agent: AgentRuntime, body: string | null, now: number): void {
    if (agent.retiredAt !== null || agent.endedAt !== null) return;
    const plan = planSlugIn(body);
    if (plan) this.setPlan(agent, plan);
    const task = taskLine(body);
    if (!task && !agent.away) return;
    if (task) {
      agent.task = task;
      this.openTask(agent, now);
    }
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
    if (isPrivate(this.privacyKind(session))) return name;
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

  // A session of the office: not in an observed floor, and with an office role of its own or a lead of the office
  // in its team, from the launcher header or from the agent_type of its main agent.
  private sessionInOffice(session: SessionRuntime, team: string | null = null): boolean {
    const lead = this.leadSession(team ?? session.team);
    return inOfficeScope({
      floorKind: session.floorKind,
      sessionRole: session.role ?? this.agents.get(session.sessionId)?.role ?? null,
      leadRole: lead ? (lead.role ?? this.agents.get(lead.sessionId)?.role ?? null) : null,
    });
  }

  private privacyKind(session: SessionRuntime, team: string | null = null): FloorKind {
    return visibleKind(session.floorKind, this.sessionInOffice(session, team));
  }

  private privacyKindOf(agent: AgentRuntime): FloorKind {
    const session = this.sessions.get(agent.sessionId);
    return session ? this.privacyKind(session) : agent.floorKind;
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


  private endSession(session: SessionRuntime, now: number, ghost = false): void {
    const silent = now - session.updatedAt;
    session.endedAt = now;
    session.ghost = ghost;
    session.openTools.clear();
    this.persistSession(session);
    if (ghost) {
      this.pushActivity({
        ts: now,
        agentKey: session.sessionId,
        event: 'Ghost',
        tool: null,
        state: null,
        summary: { key: 'hub.act.sessionGhost', params: { who: session.name ?? session.sessionId.slice(0, 8), minutes: Math.round(silent / 60_000) } },
      });
    }
    this.emitSession(session);
    for (const agent of this.agents.values()) {
      if (agent.sessionId !== session.sessionId || agent.endedAt !== null) continue;
      agent.endedAt = now;
      agent.waiting = null;
      agent.stalledSince = null;
      this.forgetChatNotes(new Set([agent.key]));
      if (agent.state !== 'done') {
        agent.state = 'done';
        agent.stateSince = now;
      }
      this.persistAgent(agent);
      this.emitAgent(agent, now);
      this.storeReport(agent, now);
      this.meterLater(agent);
      if (this.watch.watching(agent.key)) this.background(this.watch.finish(agent.key));
      if (this.changes.watching(agent.key)) this.background(this.changes.finish(agent.key));
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
    } else if (agent.endedAt === null && agent.state === 'idle' && agent.waiting) {
      detail = { key: 'hub.detail.waitingFor', params: { who: agent.waiting.who, what: agent.waiting.what || '…' } };
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
      tokens: this.meter.totals(agent.key),
      waiting: agent.waiting,
      stalledSince: agent.stalledSince,
    };
  }

  private sessionView(session: SessionRuntime): SessionView {
    const script = this.launchFile(session);
    return {
      sessionId: session.sessionId,
      agentKey: session.sessionId,
      name: session.name,
      role: session.role,
      floor: session.floor,
      canReceive: session.endedAt === null && !!session.socket && existsSync(session.socket),
      endedAt: session.endedAt,
      needsRelaunch: session.needsRelaunch,
      rulesPending: this.rulesPending(session),
      canRelaunch: session.endedAt === null && script !== null && existsSync(script) && this.sessionFree(session),
      relaunchResumes: RELAUNCH_RESUMES,
      office: this.sessionInOffice(session),
    };
  }

  private emitSession(session: SessionRuntime): void {
    const view = this.sessionView(session);
    this.sessionFlags.set(session.sessionId, flagsOf(view));
    this.emit({ type: 'session', data: view });
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
      } catch (error) {
        this.log(`un oyente falló con ${msg.type}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      }
    }
  }

  private persistSession(s: SessionRuntime): void {
    s.persistedAt = this.now();
    this.sql.upsertSession.run(s.sessionId, s.cwd, s.floor, s.role, s.name, s.socket, s.token, s.team, s.startedAt, s.updatedAt, s.endedAt);
  }

  private persistTaskOpen(a: AgentRuntime): void {
    if (a.key === a.sessionId) this.sql.updateTaskOpen.run(a.taskOpenSince, a.sessionId);
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
        planSlug: null,
        waiting: null,
        taskOpenSince: row.task_open_since,
        stalledSince: null,
      });
      const session: SessionRuntime = {
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
        rulesHash: row.rules_hash,
        launchHash: row.launch_hash,
        needsRelaunch: false,
        persistedAt: row.updated_at,
        ghost: false,
        openTools: new Map(),
      };
      this.sessions.set(row.session_id, session);
      if (this.opts.launch && (row.rules_hash === null || row.launch_hash === null)) {
        session.rulesHash ??= this.rulesHash(session);
        const script = this.launchFile(session);
        session.launchHash ??= script ? this.fileHash(script) : null;
        this.sql.updateHashes.run(session.rulesHash, session.launchHash, session.sessionId);
      }
      session.needsRelaunch = this.relaunchNeeded(session);
    }
  }

  private noteTranscripts(e: HookEvent, agentKey: string): void {
    this.meter.noteSession(e.session_id, e.transcript_path);
    this.meter.noteAgent(agentKey, agentKey === e.session_id ? e.transcript_path : e.agent_transcript_path);
  }

  private planSubject(agent: AgentRuntime): PlanSubject {
    return { name: agent.name, roleId: roleIdOf(agent.role), floorKind: agent.floorKind, planSlug: agent.planSlug };
  }

  private meterAgent(agent: AgentRuntime): MeterAgent | null {
    const lead = this.agents.get(agent.sessionId) ?? null;
    if (!inOfficeScope({ floorKind: agent.floorKind, sessionRole: agent.role, leadRole: lead?.role ?? null })) return null;
    return {
      key: agent.key,
      sessionId: agent.sessionId,
      floor: agent.floor,
      roleId: roleIdOf(agent.role),
      name: agent.name,
      cwd: this.sessions.get(agent.sessionId)?.cwd ?? null,
      plan: planSlugOf(this.planSubject(agent), lead && lead !== agent ? this.planSubject(lead) : null),
    };
  }

  private meterLater(agent: AgentRuntime): void {
    const subject = this.meterAgent(agent);
    if (subject) this.background(this.meter.schedule(subject));
  }

  private setPlan(agent: AgentRuntime, slug: string): void {
    if (agent.planSlug === slug) return;
    const subject = this.meterAgent(agent);
    if (subject) this.meter.readNow(subject);
    agent.planSlug = slug;
  }

  private meterSweep(now: number): void {
    if (now - this.meterSweptAt < METER_SWEEP_MS) return;
    this.meterSweptAt = now;
    let budget = SWEEP_BUDGET;
    for (const agent of this.agents.values()) {
      if (budget <= 0) break;
      if (agent.endedAt !== null || agent.away) continue;
      if (agent.updatedAt <= this.meter.lastRead(agent.key) && !this.meter.behind(agent.key)) continue;
      const subject = this.meterAgent(agent);
      if (subject) budget -= this.meter.readNow(subject, subject.plan, budget);
    }
  }

  private withPlanTokens(docs: DocumentView[]): DocumentView[] {
    const plans = this.meter.planTotals();
    return docs.map((doc) => (doc.kind === 'plan' ? { ...doc, tokens: plans.get(doc.slug) ?? null } : doc));
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


function assigns(from: AgentRuntime, to: AgentRuntime): boolean {
  return from.parentKey !== to.key && roleKind(to.role) !== 'director';
}



function idleSince(agent: AgentRuntime): number {
  return Math.max(agent.stateSince, agent.taskOpenSince ?? 0);
}

function waitsForUser(who: string): boolean {
  return /^@?(usuario|user)$/i.test(who.trim());
}

function waitsFor(who: string, from: AgentRuntime): boolean {
  const name = from.name?.split('@')[0]?.toLowerCase();
  if (!name) return false;
  return who
    .toLowerCase()
    .split(/\s*(?:,|\/|\by\b|\band\b)\s*/)
    .some((part) => part.trim().replace(/^@/, '') === name);
}

function flagsOf(view: SessionView): string {
  return `${view.needsRelaunch}|${view.rulesPending}|${view.canRelaunch}|${view.canReceive}|${view.office}`;
}

function withoutFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function sectionsOf(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  for (const chunk of content.split(/^(?=## )/m)) sections.set(chunk.split('\n')[0] ?? '', chunk.trim());
  return sections;
}

function changedSections(current: string, base: string): string {
  const before = sectionsOf(base);
  const changed = [...sectionsOf(current)].filter(([heading, body]) => before.get(heading) !== body).map(([, body]) => body);
  return changed.length > 0 ? changed.join('\n\n') : current.slice(0, RULES_MAX_CHARS);
}

async function runTmux(args: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(['tmux', ...args], { stdout: 'pipe', stderr: 'ignore' });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { code, stdout };
}


function fingerprintKey(floor: string, ts: number, path: string): string {
  return `${floor}\0${ts}\0${path}`;
}



function parseList(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

