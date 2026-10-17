import type { Database } from 'bun:sqlite';
import { record, text } from './state-machine';
import type { UsageForecast, UsageView, UsageWindow } from './types';

export type UsageSpan = 'five' | 'seven';

export type UsageSample = { ts: number; usedPct: number; resetsAt: number };

// What the status line says about the window of the context of a session, before it is turned into an AgentContext.
export type StatuslineContext = {
  sessionId: string;
  model: string | null;
  window: number | null;
  usedPct: number | null;
  tokens: number | null;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
// Samples of a window that reset at the same time, give or take the rounding of the status line.
const RESET_TOLERANCE_MS = 90_000;
const FIT_MS: Record<UsageSpan, number> = { five: 45 * MINUTE_MS, seven: 6 * HOUR_MS };
const MIN_SPREAD_MS: Record<UsageSpan, number> = { five: 10 * MINUTE_MS, seven: 2 * HOUR_MS };
const MIN_POINTS = 3;
// At or below this pace (percent per hour) nothing is going to run out.
export const SAFE_RATE = 0.1;
// What the desk keeps in memory (the longest fit) and what it keeps in the database.
const KEEP_MS = 7 * HOUR_MS;
export const SAMPLE_RETENTION_MS = 8 * 24 * HOUR_MS;

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

// Least squares over the samples of the current window in the last stretch: pace in percent per hour, the moment
// the window runs dry at that pace and whether that comes after it resets. With too few points it only says so.
export function forecast(samples: readonly UsageSample[], now: number, window: UsageWindow, span: UsageSpan): UsageForecast {
  const points = samples.filter((p) => p.ts <= now && p.ts >= now - FIT_MS[span] && Math.abs(p.resetsAt - window.resetsAt) <= RESET_TOLERANCE_MS);
  const spread = points.length > 0 ? Math.max(...points.map((p) => p.ts)) - Math.min(...points.map((p) => p.ts)) : 0;
  if (points.length < MIN_POINTS || spread < MIN_SPREAD_MS[span]) return { rate: 0, exhaustsAt: null, safe: false, basis: 'thin' };
  const n = points.length;
  const meanT = points.reduce((sum, p) => sum + p.ts, 0) / n;
  const meanU = points.reduce((sum, p) => sum + p.usedPct, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (const p of points) {
    covariance += (p.ts - meanT) * (p.usedPct - meanU);
    variance += (p.ts - meanT) ** 2;
  }
  const rate = variance > 0 ? (covariance / variance) * HOUR_MS : 0;
  if (rate <= SAFE_RATE + 1e-6) return { rate, exhaustsAt: null, safe: true, basis: 'fit' };
  const exhaustsAt = now + (Math.max(0, 100 - window.usedPct) / rate) * HOUR_MS;
  return { rate, exhaustsAt, safe: exhaustsAt >= window.resetsAt, basis: 'fit' };
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export class UsageDesk {
  private readonly samples: Record<UsageSpan, UsageSample[]> = { five: [], seven: [] };
  private fiveHour: UsageWindow | null = null;
  private sevenDay: UsageWindow | null = null;
  private at: number | null = null;

  constructor(
    private readonly now: () => number,
    private readonly onChange: (view: UsageView) => void,
    private readonly db: Database | null = null,
  ) {
    if (!db) return;
    const rows = db
      .query<{ ts: number; win: string; used_pct: number; resets_at: number | null }, [number]>(
        'SELECT ts, win, used_pct, resets_at FROM usage_samples WHERE ts >= ? ORDER BY ts',
      )
      .all(now() - KEEP_MS);
    for (const row of rows) {
      if ((row.win === 'five' || row.win === 'seven') && row.resets_at !== null) {
        this.samples[row.win].push({ ts: row.ts, usedPct: row.used_pct, resetsAt: row.resets_at });
      }
    }
  }

  view(): UsageView {
    const now = this.now();
    const live = (w: UsageWindow | null, span: UsageSpan): UsageWindow | null =>
      w && w.resetsAt > now ? { ...w, forecast: forecast(this.samples[span], now, w, span) } : null;
    return { fiveHour: live(this.fiveHour, 'five'), sevenDay: live(this.sevenDay, 'seven'), at: this.at };
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
    if (fiveHour) this.sample('five', fiveHour, now);
    if (sevenDay) this.sample('seven', sevenDay, now);
    const view = this.view();
    this.onChange(view);
    return usageLine(view);
  }

  // One sample per window and minute, or sooner when the value moves; several sessions report the same number.
  private sample(span: UsageSpan, window: UsageWindow, now: number): void {
    const list = this.samples[span];
    const last = list[list.length - 1];
    if (last && now - last.ts < MINUTE_MS && last.usedPct === window.usedPct && last.resetsAt === window.resetsAt) return;
    list.push({ ts: now, usedPct: window.usedPct, resetsAt: window.resetsAt });
    while (list.length > 0 && list[0].ts < now - KEEP_MS) list.shift();
    this.db
      ?.query('INSERT OR REPLACE INTO usage_samples (ts, win, used_pct, resets_at) VALUES (?, ?, ?, ?)')
      .run(now, span, window.usedPct, window.resetsAt);
  }
}
