import { record, text } from './state-machine';
import type { UsageView, UsageWindow } from './types';

// What the status line says about the context window of a session, before it is turned into an AgentContext.
export type StatuslineContext = {
  sessionId: string;
  model: string | null;
  window: number | null;
  usedPct: number | null;
  tokens: number | null;
};

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function windowOf(value: unknown): UsageWindow | null {
  const raw = record(value);
  const used = raw.used_percentage;
  const resets = raw.resets_at;
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  if (typeof resets !== 'number' || !Number.isFinite(resets) || resets <= 0) return null;
  return { usedPct: Math.min(100, Math.max(0, used)), resetsAt: Math.round(resets * 1000) };
}

function clock(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function usageLine(view: UsageView): string {
  const parts: string[] = [];
  if (view.fiveHour) parts.push(`5 h ${Math.round(view.fiveHour.usedPct)} %`, `reinicio ${clock(view.fiveHour.resetsAt)}`);
  if (view.sevenDay) parts.push(`semana ${Math.round(view.sevenDay.usedPct)} %`);
  return parts.join(' · ');
}

export class UsageDesk {
  private fiveHour: UsageWindow | null = null;
  private sevenDay: UsageWindow | null = null;
  private at: number | null = null;

  constructor(
    private readonly now: () => number,
    private readonly onChange: (view: UsageView) => void,
  ) {}

  view(): UsageView {
    const now = this.now();
    const live = (w: UsageWindow | null): UsageWindow | null => (w && w.resetsAt > now ? w : null);
    return { fiveHour: live(this.fiveHour), sevenDay: live(this.sevenDay), at: this.at };
  }

  // The context window that the status line of a session reports. used_percentage is null until the first
  // answer of the session has been counted.
  contextOf(raw: unknown): StatuslineContext | null {
    const body = record(raw);
    const sessionId = text(body.session_id);
    const context = body.context_window;
    if (!sessionId || typeof context !== 'object' || context === null || Array.isArray(context)) return null;
    const window = record(context);
    const usage = record(window.current_usage);
    const parts = [usage.input_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens].map(numberOf);
    const known = parts.some((part) => part !== null);
    const pct = numberOf(window.used_percentage);
    const size = numberOf(window.context_window_size);
    const model = record(body.model).id;
    return {
      sessionId,
      model: typeof model === 'string' ? model : null,
      window: size !== null && size > 0 ? size : null,
      usedPct: pct === null ? null : Math.min(100, pct),
      tokens: known ? parts.reduce<number>((sum, part) => sum + (part ?? 0), 0) : null,
    };
  }

  ingest(raw: unknown): string {
    const limits = record(record(raw).rate_limits);
    const now = this.now();
    const fresh = (value: unknown): UsageWindow | null => {
      const w = windowOf(value);
      return w && w.resetsAt > now ? w : null;
    };
    const fiveHour = fresh(limits.five_hour);
    const sevenDay = fresh(limits.seven_day);
    if (!fiveHour && !sevenDay) return '';
    if (fiveHour) this.fiveHour = fiveHour;
    if (sevenDay) this.sevenDay = sevenDay;
    this.at = now;
    const view = this.view();
    this.onChange(view);
    return usageLine(view);
  }
}
