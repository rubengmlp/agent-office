import type { AgentContext, TokenTotals } from './types';

export const DEFAULT_WINDOW = 200_000;
export const BIG_WINDOW = 1_000_000;
// A turn that shrinks the context by more than this share of the one before it is a compaction.
export const COMPACTION_DROP = 0.4;
// Below this size a smaller turn is noise, not a compaction.
export const COMPACTION_FLOOR = 10_000;
// The status line reports every minute; a transcript read does not override a sample younger than this.
export const STATUSLINE_FRESH_MS = 2 * 60_000;

// Window of a model by the prefix of its id. Anything not listed has 200 K; the 1 M windows are told by the
// suffix [1m] of the model of the role, by what the status line reports and by the tokens already seen.
export const CONTEXT_WINDOW: readonly (readonly [string, number])[] = [
  ['claude-opus', DEFAULT_WINDOW],
  ['claude-sonnet', DEFAULT_WINDOW],
  ['claude-haiku', DEFAULT_WINDOW],
  ['claude-3', DEFAULT_WINDOW],
];

export type WindowHints = {
  // context_window_size of the status line of the session.
  reported?: number | null;
  // The model configured for the role, which may carry [1m].
  roleModel?: string | null;
  // Tokens of the biggest context seen: above 200 K the window cannot be a 200 K one.
  observed?: number | null;
};

function positive(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function tableWindow(model: string | null | undefined): number {
  const id = (model ?? '').toLowerCase();
  if (id.includes('[1m]')) return BIG_WINDOW;
  for (const [prefix, size] of CONTEXT_WINDOW) {
    if (id.startsWith(prefix)) return size;
  }
  return DEFAULT_WINDOW;
}

export function windowFor(model: string | null | undefined, hints: WindowHints = {}): number {
  const roleBig = (hints.roleModel ?? '').toLowerCase().includes('[1m]') ? BIG_WINDOW : 0;
  const seenBig = positive(hints.observed) > DEFAULT_WINDOW ? BIG_WINDOW : 0;
  return Math.max(positive(hints.reported), roleBig, tableWindow(model), seenBig);
}

// What a turn holds in the window: everything it read plus what it cached, not what it wrote.
export function contextOf(tokens: Pick<TokenTotals, 'input' | 'cacheRead' | 'cacheCreate'>): number {
  return tokens.input + tokens.cacheRead + tokens.cacheCreate;
}

export function isCompaction(previous: number | null | undefined, next: number): boolean {
  const before = positive(previous);
  return before >= COMPACTION_FLOOR && next < before * (1 - COMPACTION_DROP);
}

export function usedPctOf(tokens: number, window: number): number {
  return window > 0 ? Math.min(100, Math.max(0, (tokens / window) * 100)) : 0;
}

export function agentContext(
  tokens: number,
  window: number,
  compactions: number,
  source: AgentContext['source'],
  at: number,
  usedPct: number | null = null,
): AgentContext {
  return { usedPct: usedPct ?? usedPctOf(tokens, window), tokens, window, compactions, source, at };
}
