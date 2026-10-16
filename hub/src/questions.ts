import type { AskQuestion, QuestionOutcome, QuestionView } from './types';
import { record, text } from './state-machine';

export const VISIBLE_WINDOW_MS = 30_000;
export const PERMISSION_ALLOW = 'Permitir';
export const PERMISSION_DENY = 'Denegar';
export const HOLD_MS = 3_580_000;

type Pending = {
  view: QuestionView;
  toolInput: Record<string, unknown>;
  resolve: (body: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type DeskEvents = {
  opened(view: QuestionView): void;
  closed(id: string, outcome: QuestionOutcome): void;
};

export class QuestionDesk {
  private readonly pending = new Map<string, Pending>();
  private lastVisibleAt = Number.NEGATIVE_INFINITY;
  private connected = 0;

  constructor(
    private readonly events: DeskEvents,
    private readonly holdMs = HOLD_MS,
    private readonly now: () => number = Date.now,
  ) {}

  heartbeat(visible: boolean): void {
    if (visible) this.lastVisibleAt = this.now();
  }

  connect(): void {
    this.connected += 1;
    this.lastVisibleAt = this.now();
  }

  disconnect(): void {
    this.connected = Math.max(0, this.connected - 1);
    this.lastVisibleAt = this.now();
  }

  someoneWatching(): boolean {
    return this.connected > 0 || this.now() - this.lastVisibleAt < VISIBLE_WINDOW_MS;
  }

  hold(view: Omit<QuestionView, 'expiresAt'>, toolInput: Record<string, unknown>, signal?: AbortSignal): Promise<string | null> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(null);
        return;
      }
      const full: QuestionView = { ...view, expiresAt: view.createdAt + this.holdMs };
      const timer = setTimeout(() => this.close(full.id, 'expired', null), this.holdMs);
      this.pending.set(full.id, { view: full, toolInput, resolve, timer });
      signal?.addEventListener('abort', () => this.close(full.id, 'released', null), { once: true });
      this.events.opened(full);
    });
  }

  answer(id: string, answers: unknown): 'ok' | 'closed' | 'invalid' {
    const pending = this.pending.get(id);
    if (!pending) return 'closed';
    const clean = validateAnswers(pending.view.questions, answers);
    if (!clean) return 'invalid';
    if (pending.view.kind === 'permission') {
      const choice = Object.values(clean)[0];
      if (choice !== PERMISSION_ALLOW && choice !== PERMISSION_DENY) return 'invalid';
      this.close(id, 'answered', permissionBody(choice === PERMISSION_ALLOW));
      return 'ok';
    }
    this.close(id, 'answered', decisionBody(pending.toolInput, clean));
    return 'ok';
  }

  release(id: string): 'ok' | 'closed' {
    if (!this.pending.has(id)) return 'closed';
    this.close(id, 'released', null);
    return 'ok';
  }

  sweep(): void {
    if (this.pending.size === 0 || this.someoneWatching()) return;
    for (const id of [...this.pending.keys()]) this.close(id, 'released', null);
  }

  list(): QuestionView[] {
    return [...this.pending.values()].map((p) => p.view);
  }

  has(id: string): boolean {
    return this.pending.has(id);
  }

  private close(id: string, outcome: QuestionOutcome, body: string | null): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(body);
    this.events.closed(id, outcome);
  }
}

export function parseQuestions(raw: unknown): AskQuestion[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: AskQuestion[] = [];
  for (const item of raw) {
    const q = record(item);
    const question = text(q.question);
    if (!question || !Array.isArray(q.options)) return null;
    const options = q.options
      .map((o) => record(o))
      .filter((o) => text(o.label))
      .map((o) => ({ label: o.label as string, ...(text(o.description) ? { description: o.description as string } : {}) }));
    out.push({
      question,
      ...(text(q.header) ? { header: q.header as string } : {}),
      options,
      ...(q.multiSelect === true ? { multiSelect: true } : {}),
    });
  }
  return out;
}

export function validateAnswers(questions: AskQuestion[], answers: unknown): Record<string, string> | null {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return null;
  const given = answers as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const q of questions) {
    const value = given[q.question];
    if (typeof value !== 'string' || !value.trim()) return null;
    out[q.question] = value.trim();
  }
  return out;
}

export function permissionBody(allow: boolean): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: allow
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: 'El usuario lo ha denegado desde el panel de Agent Office.', interrupt: false },
    },
  });
}

export function decisionBody(toolInput: Record<string, unknown>, answers: Record<string, string>): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Respondida desde Agent Office',
      updatedInput: { ...toolInput, answers },
    },
  });
}
