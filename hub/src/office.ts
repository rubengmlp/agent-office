import type { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { managedFloors } from './agents';
import { ChatDesk, GLOBAL_CHANNEL, SNAPSHOT_LIMIT } from './chat';
import { deliver, encodeInbox, orderText } from './courier';
import { writeAtomic } from './config';
import { commitDocument } from './docs-repo';
import { DocumentDesk } from './documents';
import { FloorInUseError, purgeFloorData } from './floor-data';
import {
  FloorResolver,
  memoryRegistry,
  type FloorRegistry,
  type GitRootFn,
} from './floors';
import { type GateDecision } from './gate';
import { GitQueue, runGit, type GitRunner } from './git';
import { GUARDED_TOOLS, guardDecision } from './guard';
import type { Log } from './log';
import { captureLesson } from './memory';
import {
  ANSWERS_QUESTION,
  DECISION_FROM,
  EMPTY_META,
  FILE_TOOLS,
  FORGET_ENDED_MS,
  HOLDS_QUESTION,
  MAX_MESSAGES,
  NEW_TURN,
  NOT_DISCARDABLE,
  NO_TESTS,
  TURN_OVER,
  UNDO_MS,
  DAY_MS,
  isHookEvent,
  recentDocuments,
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
import { withoutChatCalls } from './chat-commands';
import {
  STATUS_REQUEST,
  VERDICT_DETAILS,
  DISCARDED_MARK,
  ROLE_LABELS,
  analysisOrderText,
  executeOrderText,
  historyPath,
  isUserPrompt,
  taskLine,
  withoutDiscardMark,
} from './office-texts';
import { AskDesk } from './ask-desk';
import { ChatRoom, type ReadChatResult, type UserChatResult } from './chat-room';
import { ContextDesk } from './context-desk';
import { GateDesk } from './gate-desk';
import { GuardDesk } from './guard-desk';
import { MeterDesk } from './meter-desk';
import { OfficeBus } from './office-bus';
import { RulesDesk } from './rules-desk';
import { SessionBook } from './session-book';
import { StallDesk } from './stall-desk';
import { prepare, type Sql } from './office-sql';
import { publicDetail, publicSummary, publicText, storedPayload, visibleKind } from './privacy';
import { detectStack, profileFor, type Profiles } from './profiles';
import { docRef, parseProtocol, type DocRef } from './protocol';
import { QuestionDesk } from './questions';
import { buildReport, saveReport, savedReport, savedReports } from './reports';
import {
  isAuthorRole,
  isDepartmentFloor,
  isLeadRole,
  isVerdictRole,
  noLessons,
  remembers,
  roleIdOf,
  roleKind,
} from './scope';
import { RELAUNCH_RESUMES, TMUX_SESSION, sq } from './office-sh';
import { settingsView } from './settings';
import {
  DONE_PREFIX,
  EDIT_TOOLS,
  classify,
  record,
  short,
  text,
  type Classified,
} from './state-machine';
import { SyncDesk, type SyncResult } from './sync';
import { floorText, roleText, roundText, scoreText } from './texts';
import { planSlugIn } from './tokens';
import { UsageDesk } from './usage';
import type {
  ActivityView,
  ChatMessageView,
  ChatPostRequest,
  ChatPostResult,
  DocumentContent,
  DocumentView,
  HookEvent,
  HookMeta,
  HubText,
  MemoryView,
  MessageView,
  OfficeConfig,
  PlanDecision,
  ReportView,
  RoleId,
  ServerMessage,
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
  private readonly messages: MessageView[] = [];
  private readonly docsQueue = new GitQueue();
  private readonly bus: OfficeBus;
  private readonly book: SessionBook;
  private readonly rules: RulesDesk;
  private readonly guards: GuardDesk;
  private readonly gates: GateDesk;
  private readonly room: ChatRoom;
  private readonly context: ContextDesk;
  private readonly asks: AskDesk;
  private readonly stall: StallDesk;
  private readonly now: () => number;
  private readonly deliverFn: typeof deliver;
  private readonly git: GitRunner;
  private readonly sql: Sql;
  private readonly docs: DocumentDesk;
  private readonly sync: SyncDesk;
  private readonly usage: UsageDesk;
  private readonly meter: MeterDesk;
  readonly chat: ChatDesk;
  private readonly undoMs: number;
  private readonly removals = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly deciding = new Set<string>();

  constructor(private readonly opts: OfficeOptions) {
    this.config = opts.config;
    this.profiles = opts.profiles;
    this.now = opts.now ?? Date.now;
    this.deliverFn = opts.deliverFn ?? deliver;
    this.bus = new OfficeBus(opts.log ?? ((text) => console.error(`Agent Office: ${text}`)));
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
    this.book = new SessionBook({
      sql: this.sql,
      now: this.now,
      bus: this.bus,
      config: () => this.config,
      claudeHome: opts.claudeHome,
      tokens: (key) => this.meter.totals(key),
      flags: (session) => this.rules.flags(session),
      restored: (session, row) => this.rules.restored(session, row),
      floors: this.floors,
    });
    this.rules = new RulesDesk({
      sql: this.sql,
      now: this.now,
      bus: this.bus,
      book: this.book,
      launch: opts.launch,
      tmux: opts.tmux,
      free: (session, ignoreMain) => this.stall.sessionFree(session, ignoreMain),
    });
    this.desk = new QuestionDesk(
      {
        opened: (view) => this.asks.questionOpened(view),
        closed: (id, outcome) => this.asks.questionClosed(id, outcome),
      },
      opts.holdMs,
      this.now,
    );
    this.asks = new AskDesk({ sql: this.sql, now: this.now, bus: this.bus, book: this.book, desk: this.desk });
    this.stall = new StallDesk({ now: this.now, bus: this.bus, book: this.book, config: () => this.config, desk: this.desk });
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
      installTargets: () => this.guards.installTargets(),
      base: (slug) => this.sync.base(slug),
      ahead: (slug) => this.sync.ahead(slug),
      onChange: (docs) => this.bus.emit({ type: 'documents', data: this.meter.withPlanTokens(docs) }),
      maxRounds: () => this.config.review.maxRounds,
    });
    this.guards = new GuardDesk({
      git: this.git,
      sql: this.sql,
      now: this.now,
      bus: this.bus,
      book: this.book,
      config: () => this.config,
      claudeHome: opts.claudeHome,
      docsRoot: () => this.docsRoot(),
    });
    this.usage = new UsageDesk(this.now, (view) => this.bus.emit({ type: 'usage', data: view }));
    this.meter = new MeterDesk({ db: opts.db, claudeHome: opts.claudeHome, now: this.now, bus: this.bus, book: this.book });
    this.chat = new ChatDesk({
      db: opts.db,
      now: this.now,
      channels: () => [GLOBAL_CHANNEL, ...managedFloors(this.config).map(([slug]) => slug)],
      roleLabel: (role) => {
        const id = roleIdOf(role);
        return id ? ROLE_LABELS[id] : null;
      },
      onMessage: (message) => this.bus.emit({ type: 'chat', data: message }),
    });
    this.context = new ContextDesk({
      db: opts.db,
      now: this.now,
      bus: this.bus,
      book: this.book,
      config: () => this.config,
      chat: this.chat,
      rules: (agent, session) => this.rules.rulesBlock(agent, session),
      tokens: (key) => this.meter.totals(key),
    });
    this.room = new ChatRoom({
      bus: this.bus,
      book: this.book,
      chat: this.chat,
      config: () => this.config,
      floors: this.floors,
      deliver: this.deliverFn,
      lines: (unread, channel) => this.context.chatLines(unread, channel),
    });
    this.gates = new GateDesk({
      db: opts.db,
      sql: this.sql,
      now: this.now,
      bus: this.bus,
      book: this.book,
      config: () => this.config,
      docs: this.docs,
      sync: this.sync,
      docsRoot: () => this.docsRoot(),
      refreshDocuments: () => this.refreshDocuments(),
      context: () => this.guards.context(),
      busy: (floor) => this.guards.busy(floor),
      userAnswered: (sessionId) => this.stall.userAnswered(sessionId),
    });
    this.book.restoreSessions();
    this.docs.refresh();
  }

  start(): void {
    // A question still pending in the database lost the request that held it when the hub went down.
    this.sql.releaseStalePending.run(this.now());
    this.docs.watch();
    this.refreshDocuments();
    this.bus.background(this.sync.cleanup(this.docs.finishedPlanSlugs()));
  }

  stop(): void {
    this.docs.unwatch();
    for (const timer of this.removals.values()) clearTimeout(timer);
    this.removals.clear();
  }

  idle(): Promise<void> {
    return this.bus.idle();
  }

  subscribe(listener: (msg: ServerMessage) => void): () => void {
    return this.bus.subscribe(listener);
  }

  snapshot(): Snapshot {
    const now = this.now();
    return {
      now,
      floors: this.floors.views(),
      agents: [...this.book.agents.values()].map((a) => this.book.view(a, now)),
      sessions: [...this.book.sessions.values()].map((s) => this.book.sessionView(s)),
      questions: this.desk.list(),
      messages: this.messages.slice(-100),
      activity: this.bus.recent(),
      documents: this.meter.withPlanTokens(recentDocuments(this.docs.list())),
      alerts: this.guards.alerts(),
      usage: this.usage.view(),
      chat: this.chat.recent(SNAPSHOT_LIMIT),
    };
  }

  ingestUsage(raw: unknown): string {
    this.meter.noteUsage(raw);
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
    const session = this.book.touchSession(e, meta, now);
    if (e.hook_event_name === 'SessionStart' && (e.source === 'startup' || e.source === 'resume')) this.rules.setBaseline(session);
    const kind = visibleKind(session.floorKind, this.book.sessionInOffice(session, text(e.team_name)));
    const matchers = isDepartmentFloor(session.floorKind) ? NO_TESTS : profileFor(this.profiles, session.stack);
    const c = withoutChatCalls(classify(e, matchers), e, matchers);
    const byName = c.event === 'TeammateIdle' && !e.agent_id && c.agentKey !== e.session_id && !this.book.agents.has(c.agentKey);
    const owner = byName ? this.book.liveTeammate(c.teammate, c.team ?? session.team ?? teamOfSession(e.session_id), e.session_id) : null;
    if (owner) c.agentKey = owner.key;
    if ((c.event === 'SubagentStop' || byName) && !this.book.agents.has(c.agentKey)) {
      this.sql.insertEvent.run(now, e.session_id, c.agentKey, session.floor, c.event, null, null, null, storedPayload(e, kind));
      return null;
    }
    this.stall.trackOpenTools(e, c, session, now);
    this.meter.noteTranscripts(e, c.agentKey);
    const agent = this.book.touchAgent(e, c, session, now);
    if (this.book.isRetired(agent)) {
      this.ingestRetired(e, c, agent, session, now);
      return this.gates.readCap(c, agent, session, true, now);
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
      this.context.forgetChatNotes(new Set([agent.key]));
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
    if (c.filePath) agent.touchedFloor = this.book.touchedFloor(c.filePath, agent.floor);
    agent.away = false;
    if (NEW_TURN.has(c.event)) agent.file = null;
    if (c.event === 'PreToolUse' && c.filePath && FILE_TOOLS.has(c.tool ?? '')) agent.file = this.book.fileLabel(c.filePath, session);
    const isMain = agent.key === session.sessionId;
    if (c.event === 'UserPromptSubmit' && isMain) {
      const task = taskLine(publicText(text(e.prompt), kind));
      if (task) {
        agent.task = task;
        this.stall.openTask(agent, now);
      }
      const plan = planSlugIn(text(e.prompt));
      if (plan) this.meter.setPlan(agent, plan);
      if (isUserPrompt(text(e.prompt))) this.gates.userInstructed(session.sessionId, now);
    }
    if (c.event === 'PostToolUse' && isMain && c.tool === 'AskUserQuestion') this.gates.userInstructed(session.sessionId, now);
    if (c.event === 'PostToolUse' && c.tool === 'SendMessage' && agent.taskOpenSince !== null && DONE_PREFIX.test(text(record(e.tool_input).message) ?? '')) {
      agent.taskOpenSince = null;
      agent.stalledSince = null;
      this.book.persistTaskOpen(agent);
    }
    const closing = text(e.last_assistant_message);
    if (closing && remembers(kind) && (c.event === 'SubagentStop' || c.event === 'Stop')) agent.closing = closing;
    const closingProtocol = closing && c.event === 'Stop' && remembers(kind) ? parseProtocol(closing) : null;
    if (closingProtocol?.kind === 'waiting') this.stall.declareWaiting(agent, closingProtocol.rest, now);
    agent.updatedAt = now;

    if (c.edit !== null) this.sql.insertEdit.run(now, agent.key, session.floor, publicText(c.edit, kind) ?? '');
    this.guards.bashWrites(e, c, agent, session, kind, matchers, now);
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
    this.book.persistAgent(agent);
    this.book.emitAgent(agent, now);
    if (c.message) this.recordMessage(c.message, agent, session, now);
    this.pushActivity({ ts: now, agentKey: agent.key, event: c.event, tool: c.tool, state: nextState, summary: publicSummary(c, kind) });
    this.guards.trackDepartment(agent, c.event, ended);
    this.guards.trackChanges(agent, kind, c.event, ended);
    this.asks.settlePermissions(agent.key, c.event, c.tool, e.tool_input);
    if (c.event === 'SubagentStop' || c.event === 'Stop' || c.event === 'SessionEnd') this.context.storeReport(agent, now);

    if (TURN_OVER.has(c.event)) this.meter.later(agent);
    if (c.sessionEnded) this.endSession(session, now);
    if (c.event === 'SubagentStart' || c.event === 'SessionStart' || c.event === 'UserPromptSubmit') return this.context.injection(c.event, agent, session);
    if (c.event === 'PreToolUse' && c.tool && EDIT_TOOLS.has(c.tool) && c.filePath) return this.context.chatReminder(agent, session, c.filePath, now);
    return this.gates.readCap(c, agent, session, false, now);
  }

  ask(e: HookEvent, meta: HookMeta = EMPTY_META, signal?: AbortSignal): Promise<string | null> {
    return this.asks.ask(e, meta, signal);
  }

  permission(e: HookEvent, meta: HookMeta = EMPTY_META, signal?: AbortSignal): Promise<string | null> {
    return this.asks.permission(e, meta, signal);
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
    return this.gates.gate(e);
  }

  gateMessage(e: HookEvent): GateDecision {
    return this.gates.gateMessage(e);
  }

  guard(e: HookEvent, meta: HookMeta = EMPTY_META): GateDecision {
    return this.gates.guard(e, meta);
  }

  async order(sessionId: string, body: string): Promise<OrderResult> {
    const result = await this.deliverOrder(sessionId, body, { asTask: true });
    if (result === 'ok') this.gates.userInstructed(sessionId, this.now());
    return result;
  }

  requestStatus(sessionId: string): Promise<OrderResult> {
    return this.deliverOrder(sessionId, STATUS_REQUEST, { asTask: false });
  }

  private async deliverOrder(sessionId: string, body: string, opts: { asTask: boolean }): Promise<OrderResult> {
    const session = this.book.sessions.get(sessionId);
    if (!session || session.endedAt !== null) return 'not-found';
    if (!this.book.sessionInOffice(session)) return 'not-office';
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
    const main = this.book.agents.get(sessionId);
    const plan = opts.asTask ? planSlugIn(body) : null;
    if (main && main.retiredAt === null && plan) this.meter.setPlan(main, plan);
    const task = opts.asTask ? taskLine(publicText(body, session.floorKind)) : null;
    if (main && main.retiredAt === null && task) {
      main.task = task;
      main.away = false;
      this.stall.openTask(main, this.now());
      this.book.emitAgent(main, this.now());
    }
    return 'ok';
  }

  memoryView(floor: string, role: RoleId): MemoryView {
    return this.context.memoryView(floor, role);
  }

  addLesson(raw: unknown): LessonResult {
    return this.context.addLesson(raw);
  }

  removeLesson(id: number): boolean {
    return this.context.removeLesson(id);
  }

  report(agentKey: string): ReportView | null {
    return this.context.report(agentKey);
  }

  postChat(raw: ChatPostRequest, meta: HookMeta): ChatPostResult {
    return this.room.postChat(raw, meta);
  }

  userChat(channel: string, body: string): Promise<UserChatResult> {
    return this.room.userChat(channel, body);
  }

  readChat(channel: string, afterId: number | null, waitMs: number, signal?: AbortSignal): Promise<ReadChatResult> {
    return this.room.readChat(channel, afterId, waitMs, signal);
  }

  chatHistory(channel: string, beforeId: number | null): ChatMessageView[] | 'no-channel' {
    return this.room.chatHistory(channel, beforeId);
  }

  tokenSummary(range: UsageRange): UsageSummary {
    return this.meter.summary(range);
  }

  documents(): DocumentView[] {
    return this.meter.withPlanTokens(this.docs.list());
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
      this.bus.background(this.sync.remove(doc.slug));
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
      const director = this.book.directorSession();
      if (!director) return 'no-director';
      const text = doc.docType === 'analisis' ? analysisOrderText(doc, this.docsRoot()) : executeOrderText(doc, this.docsRoot());
      const sent = await this.order(director.sessionId, text);
      if (sent === 'not-found' || sent === 'not-office') return 'no-director';
      if (sent !== 'ok') return sent;
      this.gates.allowBriefs(director.sessionId, new Set(doc.base.map((b) => b.floor)).size);
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
    for (const agent of [...this.book.agents.values()]) {
      if (agent.endedAt !== null && now - agent.endedAt > FORGET_ENDED_MS) {
        this.book.agents.delete(agent.key);
        this.bus.emit({ type: 'agent-gone', key: agent.key });
        continue;
      }
      if (this.stall.goesHome(agent, now)) {
        agent.away = true;
        this.book.emitAgent(agent, now);
        continue;
      }
      if (this.book.view(agent, now).state !== agent.sentState) this.book.emitAgent(agent, now);
    }
    this.meter.sweep(now);
    for (const session of [...this.book.sessions.values()]) {
      if (session.endedAt === null && session.socket && !existsSync(session.socket)) this.endSession(session, now);
      else if (this.stall.isGhost(session, now)) this.endSession(session, now, true);
      if (session.endedAt !== null && now - session.endedAt > FORGET_ENDED_MS) this.book.sessions.delete(session.sessionId);
    }
    this.stall.detectStalls(now);
    this.rules.refreshSessionFlags(now);
  }

  floorInUse(slug: string): string[] {
    return [...this.book.sessions.values()]
      .filter((session) => session.floor === slug && session.endedAt === null)
      .map((session) => session.name ?? session.sessionId.slice(0, 8));
  }

  async forgetFloor(slug: string, path: string): Promise<{ rows: number; worktrees: number }> {
    const worktrees = await this.sync.removeFloor(slug);
    // A session may have opened on the floor while git was working.
    const open = this.floorInUse(slug);
    if (open.length > 0) throw new FloorInUseError(slug, open);
    const keys = new Set([...this.book.agents.values()].filter((agent) => agent.floor === slug).map((agent) => agent.key));
    const sessionIds = new Set([...this.book.sessions.values()].filter((session) => session.floor === slug).map((session) => session.sessionId));

    for (const q of this.desk.list()) if (sessionIds.has(q.sessionId)) this.desk.release(q.id);
    this.asks.forget(keys);
    for (const key of keys) this.book.agents.delete(key);
    this.meter.forget(keys);
    this.context.forgetChatNotes(keys);
    for (const id of sessionIds) this.book.sessions.delete(id);
    const keptMessages = this.messages.filter((message) => message.floor !== slug);
    this.messages.splice(0, this.messages.length, ...keptMessages);
    this.bus.forget(keys);

    this.chat.forgetFloor(slug);
    const rows = purgeFloorData(this.opts.db, slug, path);
    const now = this.now();
    this.pushActivity({ ts: now, agentKey: 'panel', event: 'FloorRemoved', tool: null, state: null, summary: { key: 'hub.act.floorRemoved', params: { slug } } });
    this.bus.emit({ type: 'snapshot', data: this.snapshot() });
    return { rows, worktrees };
  }

  reload(config: OfficeConfig, profiles: Profiles): void {
    this.config = config;
    this.profiles = profiles;
    const now = this.now();
    for (const session of this.book.sessions.values()) {
      const floor = this.floors.resolve(session.cwd);
      if (floor.slug === session.floor && floor.kind === session.floorKind && floor.stack === session.stack) continue;
      this.book.applyFloor(session, floor);
      this.book.emitSession(session);
      for (const agent of this.book.agents.values()) {
        if (agent.sessionId !== session.sessionId) continue;
        agent.floor = session.floor;
        agent.floorKind = session.floorKind;
        this.book.emitAgent(agent, now);
      }
    }
    this.rules.refreshSessionFlags(now, true);
    this.bus.emit({ type: 'floors', data: this.floors.views() });
    this.bus.emit({ type: 'settings', data: settingsView(config) });
    this.docs.watch();
    this.refreshDocuments();
  }

  relaunch(sessionId: string, resume?: boolean): Promise<RelaunchResult> {
    return this.rules.relaunch(sessionId, resume);
  }

  private docsRoot(): string {
    return this.floors.docsRoot();
  }

  refreshDocuments(): void {
    this.docs.refresh();
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
      if (this.stall.declareWaiting(from, parsed.rest, now)) this.book.emitAgent(from, now);
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
      const { decision, summary } = this.gates.reviewBlock(ref, round, 'ingest');
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
      if (ref.kind === 'plan') this.bus.background(this.sync.checkAhead(ref.slug));
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
    const recipient = message.toKey ? this.book.agents.get(message.toKey) : undefined;
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
    this.guards.finish(agent.key);
    this.book.persistAgent(agent);
    this.book.emitAgent(agent, now);
    this.context.storeReport(agent, now);
    this.meter.later(agent);
  }

  private ingestRetired(e: HookEvent, c: Classified, agent: AgentRuntime, session: SessionRuntime, now: number): void {
    const kind = this.book.privacyKind(session, text(e.team_name));
    this.sql.insertEvent.run(now, e.session_id, agent.key, session.floor, c.event, c.tool, null, c.filePath, storedPayload(e, kind));
    if (TURN_OVER.has(c.event)) {
      agent.retiredAwake = false;
      this.meter.later(agent);
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
    this.asks.settlePermissions(agent.key, c.event, c.tool, e.tool_input);
    if (c.sessionEnded) this.endSession(session, now);
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
    this.bus.background(this.docsQueue.run(root, () => commitDocument(this.git, root, ref.path, message)));
  }

  private commitRound(ref: DocRef, round: number | null): void {
    const root = this.docsRoot();
    const message = `${ref.kind === 'plan' ? 'redaccion' : 'taller'}: ${ref.slug} ronda ${round ?? '?'}`;
    const paths = ref.kind === 'plan' ? [ref.path, historyPath(ref.slug)] : [ref.path];
    this.bus.background(
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
    if (result.status === 'saved') this.bus.emit({ type: 'memory', floor: agent.floor, role: roleId });
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

  private recordTask(e: HookEvent, c: Classified, agent: AgentRuntime, session: SessionRuntime, now: number): void {
    const task = c.task;
    if (!task?.taskId) return;
    const scope = c.team ?? agent.team ?? session.team ?? teamOfSession(e.session_id);
    this.sql.upsertTask.run(scope, task.taskId, task.subject, task.owner, task.status, now);
  }

  private recordMessage(message: { to: string; text: string }, from: AgentRuntime, session: SessionRuntime, now: number): void {
    const toKey = this.book.recipientKey(message.to, from);
    const body = publicText(message.text, this.book.privacyKind(session));
    const id = Number(this.sql.insertMessage.run(now, from.key, message.to, toKey, body, session.floor).lastInsertRowid);
    const view: MessageView = { id, ts: now, fromKey: from.key, toName: message.to, toKey, text: body, floor: session.floor };
    this.messages.push(view);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    this.bus.emit({ type: 'message', data: view });
    const recipient = toKey ? this.book.agents.get(toKey) : undefined;
    this.stall.settleWaiting(from, recipient, body, now);
    if (recipient && recipient !== from) this.messageReceived(recipient, assigns(from, recipient) ? body : null, now);
    if (recipient && recipient !== from && recipient.awaitingAnswer) this.answerReceived(recipient, now);
    if (body) this.handleProtocol({ to: message.to, toKey, text: body }, from, session, now);
  }

  private messageReceived(agent: AgentRuntime, body: string | null, now: number): void {
    if (agent.retiredAt !== null || agent.endedAt !== null) return;
    const plan = planSlugIn(body);
    if (plan) this.meter.setPlan(agent, plan);
    const task = taskLine(body);
    if (!task && !agent.away) return;
    if (task) {
      agent.task = task;
      this.stall.openTask(agent, now);
    }
    if (agent.away) {
      agent.away = false;
      agent.updatedAt = now;
    }
    this.book.emitAgent(agent, now);
  }

  private answerReceived(agent: AgentRuntime, now: number): void {
    agent.awaitingAnswer = false;
    agent.state = 'working';
    agent.stateSince = now;
    agent.detail = { key: 'hub.detail.answerReceived' };
    agent.updatedAt = now;
    this.book.persistAgent(agent);
    this.book.emitAgent(agent, now);
  }

  private endSession(session: SessionRuntime, now: number, ghost = false): void {
    const silent = now - session.updatedAt;
    session.endedAt = now;
    session.ghost = ghost;
    session.openTools.clear();
    this.book.persistSession(session);
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
    this.book.emitSession(session);
    for (const agent of this.book.agents.values()) {
      if (agent.sessionId !== session.sessionId || agent.endedAt !== null) continue;
      agent.endedAt = now;
      agent.waiting = null;
      agent.stalledSince = null;
      this.context.forgetChatNotes(new Set([agent.key]));
      if (agent.state !== 'done') {
        agent.state = 'done';
        agent.stateSince = now;
      }
      this.book.persistAgent(agent);
      this.book.emitAgent(agent, now);
      this.context.storeReport(agent, now);
      this.meter.later(agent);
      this.guards.finish(agent.key);
    }
    for (const q of this.desk.list()) if (q.sessionId === session.sessionId) this.desk.release(q.id);
  }

  private pushActivity(entry: ActivityView): void {
    this.bus.pushActivity(entry);
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
