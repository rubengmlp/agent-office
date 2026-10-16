import { randomUUID } from 'node:crypto';
import type { OfficeBus } from './office-bus';
import type { Sql } from './office-sql';
import { EMPTY_META, NOT_PERMISSIONS, isHookEvent } from './office-state';
import { permissionDetail, permissionMatch, permissionPrompt } from './office-texts';
import { PERMISSION_ALLOW, PERMISSION_DENY, parseQuestions, type QuestionDesk } from './questions';
import type { SessionBook } from './session-book';
import { record, short, text } from './state-machine';
import type { HookEvent, HookMeta, QuestionOutcome, QuestionView } from './types';

export type AskDeskOpts = {
  sql: Sql;
  now: () => number;
  bus: OfficeBus;
  book: SessionBook;
  desk: QuestionDesk;
};

export class AskDesk {
  private readonly permissionHolds = new Map<string, { agentKey: string; match: string }>();

  constructor(private readonly opts: AskDeskOpts) {}

  async ask(e: HookEvent, meta: HookMeta = EMPTY_META, signal?: AbortSignal): Promise<string | null> {
    if (!isHookEvent(e) || e.tool_name !== 'AskUserQuestion') return null;
    const now = this.opts.now();
    const session = this.opts.book.touchSession(e, meta, now);
    if (!this.opts.desk.someoneWatching() || !this.opts.book.sessionInOffice(session, text(e.team_name))) return null;
    const input = record(e.tool_input);
    const questions = parseQuestions(input.questions);
    if (!questions) return null;
    const id = text(e.tool_use_id) ?? randomUUID();
    if (this.opts.desk.has(id)) return null;
    return this.opts.desk.hold(
      { id, agentKey: e.agent_id ?? e.session_id, sessionId: e.session_id, floor: session.floor, questions, createdAt: now },
      input,
      signal,
    );
  }

  async permission(e: HookEvent, meta: HookMeta = EMPTY_META, signal?: AbortSignal): Promise<string | null> {
    if (!isHookEvent(e) || e.hook_event_name !== 'PermissionRequest') return null;
    if (NOT_PERMISSIONS.has(e.tool_name ?? '')) return null;
    const now = this.opts.now();
    const session = this.opts.book.touchSession(e, meta, now);
    if (!this.opts.desk.someoneWatching() || !this.opts.book.sessionInOffice(session, text(e.team_name))) return null;
    const tool = text(e.tool_name) ?? '?';
    const input = record(e.tool_input);
    const key = e.agent_id ?? e.session_id;
    const who = this.opts.book.agents.get(key)?.name ?? (key === e.session_id ? session.name : null) ?? key.slice(0, 8);
    const id = `permiso-${randomUUID()}`;
    this.permissionHolds.set(id, { agentKey: key, match: permissionMatch(tool, input) });
    return this.opts.desk.hold(
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

  settlePermissions(agentKey: string, event: string, tool: string | null, input: unknown): void {
    if (this.permissionHolds.size === 0) return;
    const turnOver = event === 'Stop' || event === 'SubagentStop' || event === 'SessionEnd' || event === 'UserPromptSubmit';
    const ran = (event === 'PostToolUse' || event === 'PostToolUseFailure') && tool ? permissionMatch(tool, record(input)) : null;
    if (!turnOver && !ran) return;
    for (const [id, hold] of [...this.permissionHolds]) {
      if (hold.agentKey !== agentKey) continue;
      if (turnOver || hold.match === ran) this.opts.desk.release(id);
    }
  }

  questionOpened(view: QuestionView): void {
    this.opts.sql.insertQuestion.run(view.id, view.sessionId, view.agentKey, view.floor, JSON.stringify(view.questions), 'pending', view.createdAt);
    this.opts.bus.emit({ type: 'question', data: view });
    const permission = view.kind === 'permission';
    this.opts.bus.pushActivity({
      ts: view.createdAt,
      agentKey: view.agentKey,
      event: permission ? 'Permission' : 'Question',
      tool: permission ? 'PermissionRequest' : 'AskUserQuestion',
      state: 'asking',
      summary: permission ? { key: 'hub.act.permissionWaiting', params: { detail: short(view.detail ?? '', 60) } } : { key: 'hub.act.questionWaiting' },
    });
  }

  questionClosed(id: string, outcome: QuestionOutcome): void {
    this.permissionHolds.delete(id);
    this.opts.sql.closeQuestion.run(outcome, this.opts.now(), id);
    this.opts.bus.emit({ type: 'question-closed', id, outcome });
  }

  forget(keys: ReadonlySet<string>): void {
    for (const [id, hold] of this.permissionHolds) if (keys.has(hold.agentKey)) this.permissionHolds.delete(id);
  }
}
