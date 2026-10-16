import type { Database } from 'bun:sqlite';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { docTypeOf, headBytes, type DocumentDesk } from './documents';
import { decideDocumentGate, decideGate, decideReadCap, decideReviewGate, kilobytes, planByteLimit, type GateDecision, type ReviewGateFacts } from './gate';
import { GUARDED_TOOLS, guardDecision, type GuardContext } from './guard';
import type { OfficeBus } from './office-bus';
import { ownerEdits, type Sql } from './office-sql';
import { EMPTY_META, READ_CAP_TOOLS, isHookEvent, teamOfSession, type AgentRuntime, type SessionRuntime } from './office-state';
import { isUserPrompt } from './office-texts';
import { BRIEF_PREFIX, docRef, parseProtocol, type DocRef } from './protocol';
import { departmentOf, isAuthorRole, isDepartmentFloor, isLeadRole, isVerdictRole, roleKind } from './scope';
import type { SessionBook } from './session-book';
import { DONE_PREFIX, idText, record, short, text, type Classified } from './state-machine';
import type { SyncDesk } from './sync';
import type { HookEvent, HookMeta, HubText, OfficeConfig } from './types';

export type GateDeskOpts = {
  db: Database;
  sql: Sql;
  now: () => number;
  bus: OfficeBus;
  book: SessionBook;
  config: () => OfficeConfig;
  docs: DocumentDesk;
  sync: SyncDesk;
  docsRoot: () => string;
  refreshDocuments: () => void;
  context: () => GuardContext;
  busy: (floor: string) => boolean;
  userAnswered: (sessionId: string) => void;
  // A brief of the director to a lead that the budget let through.
  briefAccepted: (to: string, body: string) => void;
};

export class GateDesk {
  private readonly readCounts = new Map<string, number>();
  private readonly readCapNoted = new Set<string>();
  private readonly lastUserInput = new Map<string, number>();
  private readonly briefAllowance = new Map<string, number>();

  constructor(private readonly opts: GateDeskOpts) {}

  readCap(c: Classified, agent: AgentRuntime, session: SessionRuntime, retired: boolean, now: number): string | null {
    if (c.event !== 'PreToolUse' || !READ_CAP_TOOLS.has(c.tool ?? '') || !isVerdictRole(agent.role) || !isDepartmentFloor(session.floorKind)) {
      return null;
    }
    const count = this.readCounts.get(agent.key) ?? this.opts.sql.countReads.get(agent.key)?.n ?? 0;
    const decision = decideReadCap({ count, max: this.opts.config().review.maxReviewerReads, retired });
    this.readCounts.set(agent.key, decision.pass ? count + 1 : count);
    if (decision.pass) return null;
    if (!retired && !this.readCapNoted.has(agent.key)) {
      this.readCapNoted.add(agent.key);
      this.opts.bus.pushActivity({
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

  gate(e: HookEvent): GateDecision {
    if (!isHookEvent(e)) return { pass: true, reason: 'evento no válido' };
    const now = this.opts.now();
    const session = this.opts.book.touchSession(e, EMPTY_META, now);
    const scope = text(e.team_name) ?? session.team ?? teamOfSession(e.session_id);
    const lead = this.opts.book.leadSession(scope) ?? session;
    const leadRole = lead.role ?? this.opts.book.agents.get(lead.sessionId)?.role ?? null;
    const taskId = idText(e.task_id);
    const task = taskId ? this.opts.sql.getTask.get(scope, taskId) : null;
    const owner = task?.owner ?? text(e.teammate_name);
    const keys = this.ownerKeys(owner, scope, lead);
    const lastTesterGreen = this.opts.sql.lastTesterGreen.get(lead.floor)?.ts ?? null;
    const edits = ownerEdits(this.opts.db, this.opts.config().floors, lead.floor, keys, lastTesterGreen);
    const decision = decideGate({
      officeTeam: isLeadRole(leadRole),
      floorManaged: lead.floorKind === 'managed',
      owner,
      lastOwnerEdit: edits.last,
      lastTesterGreen,
      changed: edits.files,
      changedTotal: edits.total,
      fingerprintPending: this.opts.busy(lead.floor),
    });
    this.opts.sql.insertGate.run(now, scope, taskId, decision.pass ? 'pass' : 'block', decision.reason);
    if (taskId) {
      this.opts.sql.upsertTask.run(scope, taskId, text(e.task_subject), null, decision.pass ? 'completed' : 'blocked', now);
    }
    const subject = short(text(e.task_subject) ?? taskId ?? '', 60);
    this.opts.bus.pushActivity({
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
    const now = this.opts.now();
    const session = this.opts.book.touchSession(e, EMPTY_META, now);
    const senderRole = this.opts.book.roleForEvent(e, session);
    if (review) {
      if (isDepartmentFloor(session.floorKind) && isAuthorRole(senderRole)) return this.gateReview(e, review, session, now);
      return { pass: true, reason: 'solo cuenta el REVISAR de un redactor o artesano' };
    }
    if (isDepartmentFloor(session.floorKind) && departmentOf(senderRole)) {
      return this.gateDocument(e, body, senderRole, session, now);
    }
    if (!isLeadRole(senderRole)) return { pass: true, reason: 'solo cuenta el aviso de un jefe de planta' };
    const team = teamOfSession(session.sessionId);
    const lastTesterGreen = this.opts.sql.lastTesterGreen.get(session.floor)?.ts ?? null;
    const edits = ownerEdits(this.opts.db, this.opts.config().floors, session.floor, this.ownerKeys(null, team, session), lastTesterGreen);
    const decision = decideGate({
      officeTeam: true,
      floorManaged: session.floorKind === 'managed',
      owner: null,
      lastOwnerEdit: edits.last,
      lastTesterGreen,
      changed: edits.files,
      changedTotal: edits.total,
      fingerprintPending: this.opts.busy(session.floor),
    });
    this.opts.sql.insertGate.run(now, team, null, decision.pass ? 'pass' : 'block', decision.reason);
    this.opts.bus.pushActivity({
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
    const now = this.opts.now();
    const session = this.opts.book.touchSession(e, meta, now);
    const role = this.opts.book.roleForEvent(e, session);
    if (!departmentOf(role)) return { pass: true, reason: 'fuera de los departamentos' };
    const decision = guardDecision(
      { tool: e.tool_name ?? '', input: record(e.tool_input), cwd: text(e.cwd) ?? session.cwd, role, name: this.opts.book.agents.get(e.agent_id ?? e.session_id)?.name ?? null },
      this.opts.context(),
    );
    if (!decision.pass) {
      this.opts.sql.insertGate.run(now, 'guardia', null, 'block', decision.reason);
      const key = e.agent_id ?? e.session_id;
      this.opts.bus.pushActivity({
        ts: now,
        agentKey: key,
        event: 'Guard',
        tool: e.tool_name ?? null,
        state: null,
        summary: { key: 'hub.act.guardBlocked', params: { who: this.opts.book.agents.get(key)?.name ?? role ?? key.slice(0, 8), target: decision.target ?? '?' } },
      });
    }
    return decision;
  }

  private gateBrief(e: HookEvent): GateDecision {
    const to = (text(record(e.tool_input).to) ?? '').split('@')[0] ?? '';
    if (!to.startsWith('lead-')) return { pass: true, reason: 'solo cuenta el encargo a un jefe' };
    const now = this.opts.now();
    const session = this.opts.book.touchSession(e, EMPTY_META, now);
    if (this.opts.book.roleForEvent(e, session) !== 'office-director') return { pass: true, reason: 'solo cuenta el encargo del director' };
    const max = this.opts.config().limits.maxBriefsPerOrder;
    const scope = `encargo:${session.sessionId}`;
    const sent = this.opts.sql.countBriefs.get(scope, this.lastUserInputAt(session.sessionId))?.n ?? 0;
    const allowance = Math.max(max, this.briefAllowance.get(session.sessionId) ?? 0);
    if (max > 0 && sent >= allowance) {
      const reason = `Tope de encargos: ya has enviado ${sent} encargos desde la última instrucción del usuario (limits.maxBriefsPerOrder = ${max}). Pregunta al usuario con AskUserQuestion antes de encargar más: cuáles quiere y en qué orden.`;
      this.opts.sql.insertGate.run(now, scope, null, 'block', reason);
      this.opts.bus.pushActivity({
        ts: now,
        agentKey: e.agent_id ?? session.sessionId,
        event: 'GateMessage',
        tool: 'SendMessage',
        state: null,
        summary: { key: 'hub.act.briefsCapped', params: { n: sent, max } },
      });
      return { pass: false, reason };
    }
    this.opts.sql.insertGate.run(now, scope, null, 'pass', 'encargo dentro del presupuesto');
    this.opts.briefAccepted(to, text(record(e.tool_input).message) ?? '');
    return { pass: true, reason: 'encargo dentro del presupuesto' };
  }

  lastUserInputAt(sessionId: string): number {
    const cached = this.lastUserInput.get(sessionId);
    if (cached !== undefined) return cached;
    const prompt = this.opts.sql.recentPrompts.all(sessionId).find((row) => isUserPrompt(row.prompt));
    const at = Math.max(prompt?.ts ?? 0, this.opts.sql.lastAsk.get(sessionId)?.ts ?? 0);
    this.lastUserInput.set(sessionId, at);
    return at;
  }

  userInstructed(sessionId: string, now: number): void {
    this.lastUserInput.set(sessionId, now);
    this.briefAllowance.delete(sessionId);
    this.opts.userAnswered(sessionId);
  }

  // REVISAR: over the round cap or of a plan over its size cap. Only a block is recorded: a REVISAR: that passes
  // already shows in the activity when ingest processes it.
  private gateReview(e: HookEvent, review: { target: string | null; round: number | null }, session: SessionRuntime, now: number): GateDecision {
    // session.cwd, as handleProtocol: touchSession has already taken the cwd of this event.
    const ref = docRef(review.target, this.opts.docsRoot(), session.cwd);
    if (!ref) return { pass: true, reason: 'sin documento: handleProtocol tampoco lo cuenta' };
    const { decision, summary } = this.reviewBlock(ref, review.round, 'gate');
    if (decision.pass || !summary) return decision;
    this.opts.sql.insertGate.run(now, teamOfSession(session.sessionId), ref.path, 'block', decision.reason);
    this.opts.bus.pushActivity({ ts: now, agentKey: e.agent_id ?? session.sessionId, event: 'GateMessage', tool: 'SendMessage', state: null, summary });
    return decision;
  }

  reviewBlock(ref: DocRef, round: number | null, from: 'gate' | 'ingest'): { decision: GateDecision; summary: HubText | null } {
    const file = join(this.opts.docsRoot(), ref.path);
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
      maxRounds: this.opts.config().review.maxRounds,
      bytes,
      maxBytes: this.opts.config().review.maxPlanBytes,
      analysis: bytes !== null && docTypeOf('plan', headBytes(file)) === 'analisis',
      floors: Math.max(1, this.opts.sync.base(ref.slug).length),
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
    const ref = docRef(parsed?.target ?? null, this.opts.docsRoot(), text(e.cwd) ?? session.cwd);
    const decision = decideDocumentGate({
      raw: parsed?.target ?? null,
      path: ref?.path ?? null,
      changedAt: ref ? this.opts.docs.changedAt(ref) : null,
      approvedAt: ref ? (this.opts.sql.lastApproved.get(ref.path)?.ts ?? null) : null,
    });
    const scope = teamOfSession(session.sessionId);
    this.opts.sql.insertGate.run(now, scope, ref?.path ?? null, decision.pass ? 'pass' : 'block', decision.reason);
    this.opts.bus.pushActivity({
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
        this.opts.docs.markDelivered(ref, this.opts.sync.base(ref.slug), now);
        this.opts.refreshDocuments();
        this.opts.bus.background(this.opts.sync.remove(ref.slug));
      } else {
        this.opts.docs.markClosed(ref, now);
        this.opts.refreshDocuments();
      }
    }
    return decision;
  }

  ownerKeys(owner: string | null, scope: string, lead: SessionRuntime): string[] {
    const inTeam = (a: AgentRuntime) => a.team === scope || a.sessionId === lead.sessionId || a.parentKey === lead.sessionId;
    const keys = new Set<string>();
    if (owner) {
      for (const a of this.opts.book.agents.values()) if (a.name === owner && inTeam(a)) keys.add(a.key);
      for (const id of this.opts.book.teamMemberIds(scope, owner)) keys.add(id);
    }
    if (keys.size === 0) {
      for (const a of this.opts.book.agents.values()) {
        const kind = roleKind(a.role);
        if (inTeam(a) && (kind === 'dev' || kind === 'intern') && a.key !== lead.sessionId) keys.add(a.key);
      }
    }
    return [...keys];
  }

  allowBriefs(sessionId: string, floors: number): void {
    this.briefAllowance.set(sessionId, floors);
  }
}
