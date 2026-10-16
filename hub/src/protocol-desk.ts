import type { Database } from 'bun:sqlite';
import { commitDocument } from './docs-repo';
import type { DocumentDesk } from './documents';
import type { GateDecision } from './gate';
import type { GitQueue, GitRunner } from './git';
import { captureLesson } from './memory';
import type { OfficeBus } from './office-bus';
import type { Sql } from './office-sql';
import type { AgentRuntime, SessionRuntime } from './office-state';
import { VERDICT_DETAILS, historyPath } from './office-texts';
import { docRef, parseProtocol, type DocRef } from './protocol';
import { isAuthorRole, isDepartmentFloor, isLeadRole, isVerdictRole, noLessons, remembers, roleIdOf, roleKind } from './scope';
import type { SessionBook } from './session-book';
import type { SyncDesk } from './sync';
import { floorText, roleText, roundText, scoreText } from './texts';
import type { HubText, OfficeConfig, VerdictKind } from './types';

export type ProtocolDeskOpts = {
  db: Database;
  sql: Sql;
  now: () => number;
  bus: OfficeBus;
  book: SessionBook;
  config: () => OfficeConfig;
  docs: DocumentDesk;
  sync: SyncDesk;
  git: GitRunner;
  queue: GitQueue;
  docsRoot: () => string;
  refreshDocuments: () => void;
  review: (ref: DocRef, round: number | null, from: 'gate' | 'ingest') => { decision: GateDecision; summary: HubText | null };
  declareWaiting: (agent: AgentRuntime, rest: string, now: number) => boolean;
  retire: (agent: AgentRuntime, detail: HubText, now: number) => void;
};

export class ProtocolDesk {
  constructor(private readonly opts: ProtocolDeskOpts) {}

  handleProtocol(message: { to: string; toKey: string | null; text: string }, from: AgentRuntime, session: SessionRuntime, now: number): void {
    if (!remembers(session.floorKind)) return;
    const parsed = parseProtocol(message.text);
    if (!parsed) return;
    if (parsed.kind === 'lesson') {
      if (noLessons(roleKind(from.role))) return;
      this.captureAgentLesson(from, parsed.rest, now);
      return;
    }
    if (parsed.kind === 'waiting') {
      if (this.opts.declareWaiting(from, parsed.rest, now)) this.opts.book.emitAgent(from, now);
      return;
    }
    if (!isDepartmentFloor(session.floorKind)) return;
    const ref = docRef(parsed.target, this.opts.docsRoot(), session.cwd);
    if (!ref) return;
    if (parsed.kind === 'split') {
      if (ref.kind === 'plan') {
        this.opts.bus.pushActivity({
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
        this.opts.bus.pushActivity({ ts: now, agentKey: from.key, event: 'Plan', tool: 'SendMessage', state: null, summary: { key: 'hub.act.planNotice', params: { to: message.to, path: ref.path } } });
      }
      return;
    }
    const round = parsed.round;
    if (parsed.kind === 'review' && isAuthorRole(from.role)) {
      // gate.sh blocks it, but emit.sh runs in the same PreToolUse: no round opens and nothing is committed.
      const { decision, summary } = this.opts.review(ref, round, 'ingest');
      if (!decision.pass) {
        if (summary) this.opts.bus.pushActivity({ ts: now, agentKey: from.key, event: 'Review', tool: 'SendMessage', state: null, summary });
        return;
      }
      this.opts.docs.markRequested(ref, round, now);
      this.commitRound(ref, round);
      this.opts.refreshDocuments();
      this.opts.bus.pushActivity({
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
    if (this.opts.sql.agentVerdict.get(from.key, ref.path)) {
      this.opts.bus.pushActivity({
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
    const docRound = this.opts.docs.find(ref.path)?.round ?? 0;
    const stored = verdict !== 'no-agreement' || docRound <= 0 ? round : Math.min(round ?? docRound, docRound);
    this.opts.sql.insertVerdict.run(now, from.key, from.role, session.floor, verdict, verdict === 'approved' ? 1 : 0, null, ref.path, stored, parsed.score);
    this.opts.docs.markRound(ref, round, now);
    if (verdict === 'approved') {
      this.commitRound(ref, round);
      if (ref.kind === 'plan') this.opts.bus.background(this.opts.sync.checkAhead(ref.slug));
    }
    this.opts.refreshDocuments();
    const key = verdict === 'approved' ? 'hub.act.verdictApproved' : verdict === 'improve' ? 'hub.act.verdictImprove' : 'hub.act.verdictNoAgreement';
    this.opts.bus.pushActivity({
      ts: now,
      agentKey: from.key,
      event: 'Verdict',
      tool: 'SendMessage',
      state: null,
      summary: { key, params: { path: ref.path, round: roundText(round), score: scoreText(parsed.score) } },
    });
    this.opts.retire(from, VERDICT_DETAILS[verdict], now);
  }

  private toAuthor(message: { to: string; toKey: string | null }, ref: DocRef): boolean {
    const author = `${ref.kind === 'plan' ? 'redactor' : 'artesano'}-${ref.slug}`;
    const name = message.to.split('@')[0] ?? '';
    if (name === author) return true;
    const recipient = message.toKey ? this.opts.book.agents.get(message.toKey) : undefined;
    return !!recipient && recipient.name === author && isAuthorRole(recipient.role);
  }

  private commitRound(ref: DocRef, round: number | null): void {
    const root = this.opts.docsRoot();
    const message = `${ref.kind === 'plan' ? 'redaccion' : 'taller'}: ${ref.slug} ronda ${round ?? '?'}`;
    const paths = ref.kind === 'plan' ? [ref.path, historyPath(ref.slug)] : [ref.path];
    this.opts.bus.background(
      this.opts.queue
        .run(root, () => commitDocument(this.opts.git, root, paths, message))
        .then((outcome) => {
          if (outcome === 'failed') {
            this.opts.bus.pushActivity({
              ts: this.opts.now(),
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
      this.opts.config().memory,
    );
    if (result.status === 'saved') this.opts.bus.emit({ type: 'memory', floor: agent.floor, role: roleId });
    const summary: HubText =
      result.status === 'saved'
        ? { key: 'hub.act.lessonSaved', params: { role: roleText(roleId), floor: floorText(agent.floor) } }
        : result.status === 'duplicate'
          ? { key: 'hub.act.lessonDuplicate' }
          : result.status === 'cap'
            ? { key: 'hub.act.lessonCap', params: { max: this.opts.config().memory.maxLessonsPerSession } }
            : { key: 'hub.act.lessonEmpty' };
    this.opts.bus.pushActivity({ ts: now, agentKey: agent.key, event: 'Lesson', tool: 'SendMessage', state: null, summary });
  }
}
