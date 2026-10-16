import { record } from './state-machine';
import type { UsageView, UsageWindow } from './types';

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
