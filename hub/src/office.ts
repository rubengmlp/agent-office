import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deliver, encodeInbox, orderText } from './courier';
import {
  FloorResolver,
  isInside,
  memoryRegistry,
  realPath,
  type FloorRegistry,
  type GitRootFn,
  type ResolvedFloor,
} from './floors';
import { decideGate, type GateDecision } from './gate';
import { publicDetail, publicSummary, publicText, storedPayload } from './privacy';
import { detectStack, profileFor, type Profiles } from './profiles';
import { QuestionDesk, parseQuestions } from './questions';
import { inOfficeScope, isLeadRole, roleKind } from './scope';
import { DONE_PREFIX, classify, idText, record, short, text, type Classified, type SpawnCall } from './state-machine';
import type {
  ActivityView,
  AgentState,
  AgentView,
  FloorKind,
  HookEvent,
  HookMeta,
  MessageView,
  OfficeConfig,
  QuestionOutcome,
  QuestionView,
  ServerMessage,
  SessionView,
  Snapshot,
  Stack,
  TestResult,
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

export type OrderResult = 'ok' | 'not-found' | 'unreachable' | 'failed';

export type OfficeOptions = {
  db: Database;
  config: OfficeConfig;
  profiles: Profiles;
  workspaceDir: string;
  claudeHome: string;
  registry?: FloorRegistry;
  gitRoot?: GitRootFn;
  stackOf?: (dir: string) => Stack;
  rawDir?: string | null;
  holdMs?: number;
  now?: () => number;
  deliverFn?: typeof deliver;
};

const MAX_ACTIVITY = 300;
const MAX_MESSAGES = 200;
const FORGET_ENDED_MS = 10 * 60_000;
const RESTORE_WINDOW_MS = 24 * 60 * 60_000;
const MAX_SPAWNS = 500;
const TEAM_CACHE_MS = 5000;
const EMPTY_META: HookMeta = { socket: null, token: null, role: null, name: null };

export function isHookEvent(value: unknown): value is HookEvent {
  const r = record(value);
  return typeof r.session_id === 'string' && r.session_id.length > 0 && typeof r.hook_event_name === 'string';
}

export function teamOfSession(sessionId: string): string {
  return `session-${sessionId.slice(0, 8)}`;
}

export class Office {
  readonly desk: QuestionDesk;
  private config: OfficeConfig;
  private profiles: Profiles;
  private readonly floors: FloorResolver;
  private readonly agents = new Map<string, AgentRuntime>();
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly spawnCalls = new Map<string, SpawnCall>();
  private readonly spawnedAgents = new Map<string, SpawnCall>();
  private readonly teammateIds = new Map<string, true>();
  private readonly activity: ActivityView[] = [];
  private readonly messages: MessageView[] = [];
  private readonly listeners = new Set<(msg: ServerMessage) => void>();
  private readonly teamCache = new Map<string, { at: number; members: Record<string, unknown>[] }>();
  private readonly now: () => number;
  private readonly deliverFn: typeof deliver;
  private readonly sql: ReturnType<typeof prepare>;

  constructor(private readonly opts: OfficeOptions) {
    this.config = opts.config;
    this.profiles = opts.profiles;
    this.now = opts.now ?? Date.now;
    this.deliverFn = opts.deliverFn ?? deliver;
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
    this.restoreSessions();
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
    };
  }

  ingest(e: HookEvent, meta: HookMeta = EMPTY_META): void {
    if (!isHookEvent(e)) return;
    const now = this.now();
    this.dumpRaw(e, now);
    const session = this.touchSession(e, meta, now);
    const kind = session.floorKind;
    const c = classify(e, profileFor(this.profiles, session.stack));
    if (c.event === 'SubagentStop' && !this.agents.has(c.agentKey)) {
      this.sql.insertEvent.run(now, e.session_id, c.agentKey, session.floor, c.event, null, null, null, storedPayload(e, kind));
      return;
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
    agent.updatedAt = now;

    if (c.edit !== null) this.sql.insertEdit.run(now, agent.key, session.floor, publicText(c.edit, kind) ?? '');
    if (c.test === 'pass' || c.test === 'fail') {
      const ok = c.test === 'pass';
      const command = publicText(c.command, kind) ?? '';
      this.sql.insertTest.run(now, agent.key, agent.role, session.floor, ok ? 1 : 0, command);
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

    if (c.sessionEnded) this.endSession(session, now);
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
    const senderRole = text(e.agent_type) ?? this.agents.get(e.agent_id ?? e.session_id)?.role ?? session.role;
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
      if (session.endedAt !== null && now - session.endedAt > FORGET_ENDED_MS) this.sessions.delete(session.sessionId);
    }
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
      const value = meta[field];
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

    if (c.spawnCall?.toolUseId) remember(this.spawnCalls, c.spawnCall.toolUseId, c.spawnCall);
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
    if (!isMain && !agent.spawnType) {
      const memberName = agent.name ?? c.role;
      if (memberName) agent.spawnType = this.teamMemberType(agent.team ?? teamOfSession(e.session_id), memberName);
    }
    agent.role = agent.spawnType ?? c.role ?? agent.role ?? (isMain ? session.role : null);

    if (agent.team && !agent.parentKey) {
      const lead = this.leadSession(agent.team);
      if (lead && lead.sessionId !== agent.key) agent.parentKey = lead.sessionId;
    }
    return agent;
  }

  private applySpawn(agent: AgentRuntime, call: SpawnCall): void {
    if (!agent.name && call.name) agent.name = call.name;
    if (call.subagentType) {
      agent.spawnType = call.subagentType;
      agent.role = call.subagentType;
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
    }
    for (const q of this.desk.list()) if (q.sessionId === session.sessionId) this.desk.release(q.id);
  }

  private questionOpened(view: QuestionView): void {
    this.sql.insertQuestion.run(view.id, view.sessionId, view.agentKey, view.floor, JSON.stringify(view.questions), 'pending', view.createdAt);
    this.emit({ type: 'question', data: view });
    this.pushActivity({ ts: view.createdAt, agentKey: view.agentKey, event: 'Question', tool: 'AskUserQuestion', state: 'asking', summary: 'pregunta esperando en el panel' });
  }

  private questionClosed(id: string, outcome: QuestionOutcome): void {
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
    this.sql.upsertAgent.run(a.key, a.sessionId, a.parentKey, a.name, a.role, a.floor, a.team, a.updatedAt, a.endedAt);
  }

  private restoreSessions(): void {
    for (const row of this.sql.openSessions.all(this.now() - RESTORE_WINDOW_MS)) {
      const floor = this.floors.resolve(row.cwd);
      this.sessions.set(row.session_id, {
        sessionId: row.session_id,
        cwd: row.cwd,
        floor: floor.slug,
        floorKind: floor.kind,
        stack: floor.stack,
        role: row.role,
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

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.set(key, value);
  while (map.size > MAX_SPAWNS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
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
      `INSERT INTO agents (agent_key, session_id, parent_key, name, role, floor, team, updated_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_key) DO UPDATE SET session_id = excluded.session_id, parent_key = excluded.parent_key,
         name = excluded.name, role = excluded.role, floor = excluded.floor, team = excluded.team,
         updated_at = excluded.updated_at, ended_at = excluded.ended_at`,
    ),
    openSessions: db.query<SessionRow, [number]>(
      'SELECT session_id, cwd, role, name, socket, token, team, started_at, updated_at FROM sessions WHERE ended_at IS NULL AND updated_at > ?',
    ),
    insertEdit: db.query('INSERT INTO edits (ts, agent_key, floor, path) VALUES (?, ?, ?, ?)'),
    insertTest: db.query('INSERT INTO test_runs (ts, agent_key, role, floor, ok, command) VALUES (?, ?, ?, ?, ?, ?)'),
    lastTesterGreen: db.query<{ ts: number | null }, [string]>(
      "SELECT MAX(ts) AS ts FROM test_runs WHERE floor = ? AND ok = 1 AND role LIKE 'office-tester-%'",
    ),
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
  };
}

