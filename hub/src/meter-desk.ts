import type { Database } from 'bun:sqlite';
import type { OfficeBus } from './office-bus';
import { METER_SWEEP_MS, type AgentRuntime } from './office-state';
import { inOfficeScope, roleIdOf } from './scope';
import type { SessionBook } from './session-book';
import { record, text } from './state-machine';
import { SWEEP_BUDGET, TokenMeter, planSlugOf, type MeterAgent, type PlanSubject } from './tokens';
import type { DocumentView, HookEvent, UsageRange, UsageSummary } from './types';

export type MeterDeskOpts = {
  db: Database;
  claudeHome: string;
  now: () => number;
  bus: OfficeBus;
  book: SessionBook;
};

export class MeterDesk {
  private readonly meter: TokenMeter;
  private sweptAt: number;

  constructor(private readonly opts: MeterDeskOpts) {
    this.meter = new TokenMeter({
      db: opts.db,
      claudeHome: opts.claudeHome,
      now: opts.now,
      onRead: (data) => opts.bus.emit({ type: 'tokens', data }),
    });
    this.sweptAt = opts.now();
  }

  noteUsage(raw: unknown): void {
    const sessionId = text(record(raw).session_id);
    if (!sessionId) return;
    this.meter.noteSession(sessionId, record(raw).transcript_path);
    this.meter.noteAgent(sessionId, record(raw).transcript_path);
  }

  totals(agentKey: string): ReturnType<TokenMeter['totals']> {
    return this.meter.totals(agentKey);
  }

  planTotals(): ReturnType<TokenMeter['planTotals']> {
    return this.meter.planTotals();
  }

  summary(range: UsageRange): UsageSummary {
    return this.meter.summary(range);
  }

  forget(keys: ReadonlySet<string>): void {
    this.meter.forget(keys);
  }

  noteTranscripts(e: HookEvent, agentKey: string): void {
    this.meter.noteSession(e.session_id, e.transcript_path);
    this.meter.noteAgent(agentKey, agentKey === e.session_id ? e.transcript_path : e.agent_transcript_path);
  }

  private planSubject(agent: AgentRuntime): PlanSubject {
    return { name: agent.name, roleId: roleIdOf(agent.role), floorKind: agent.floorKind, planSlug: agent.planSlug };
  }

  private meterAgent(agent: AgentRuntime): MeterAgent | null {
    const lead = this.opts.book.agents.get(agent.sessionId) ?? null;
    if (!inOfficeScope({ floorKind: agent.floorKind, sessionRole: agent.role, leadRole: lead?.role ?? null })) return null;
    return {
      key: agent.key,
      sessionId: agent.sessionId,
      floor: agent.floor,
      roleId: roleIdOf(agent.role),
      name: agent.name,
      cwd: this.opts.book.sessions.get(agent.sessionId)?.cwd ?? null,
      plan: planSlugOf(this.planSubject(agent), lead && lead !== agent ? this.planSubject(lead) : null),
    };
  }

  later(agent: AgentRuntime): void {
    const subject = this.meterAgent(agent);
    if (subject) this.opts.bus.background(this.meter.schedule(subject));
  }

  setPlan(agent: AgentRuntime, slug: string): void {
    if (agent.planSlug === slug) return;
    const subject = this.meterAgent(agent);
    if (subject) this.meter.readNow(subject);
    agent.planSlug = slug;
  }

  sweep(now: number): void {
    if (now - this.sweptAt < METER_SWEEP_MS) return;
    this.sweptAt = now;
    let budget = SWEEP_BUDGET;
    for (const agent of this.opts.book.agents.values()) {
      if (budget <= 0) break;
      if (agent.endedAt !== null || agent.away) continue;
      if (agent.updatedAt <= this.meter.lastRead(agent.key) && !this.meter.behind(agent.key)) continue;
      const subject = this.meterAgent(agent);
      if (subject) budget -= this.meter.readNow(subject, subject.plan, budget);
    }
  }

  withPlanTokens(docs: DocumentView[]): DocumentView[] {
    const plans = this.meter.planTotals();
    return docs.map((doc) => (doc.kind === 'plan' ? { ...doc, tokens: plans.get(doc.slug) ?? null } : doc));
  }
}
