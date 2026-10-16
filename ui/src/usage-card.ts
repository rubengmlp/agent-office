import { el } from './dom';
import { t } from './i18n';
import type { Store } from './store';
import { duration, relativeTime } from './time';
import type { UsageWindow } from './types';

export const STALE_USAGE_MS = 15 * 60_000;
const WARN_PCT = 70;
const DANGER_PCT = 90;

type Row = { root: HTMLElement; label: HTMLElement; pct: HTMLElement; fill: HTMLElement; reset: HTMLElement };

function row(text: string): Row {
  const label = el('span', 'usage-label', text);
  const pct = el('span', 'usage-pct');
  const fill = el('span', 'usage-fill');
  const reset = el('span', 'usage-reset');
  const root = el('div', 'usage-row', label, pct, el('span', 'usage-bar', fill), reset);
  return { root, label, pct, fill, reset };
}

function level(pct: number): string {
  if (pct >= DANGER_PCT) return 'danger';
  return pct >= WARN_PCT ? 'warn' : 'ok';
}

function paint(target: Row, sample: UsageWindow | null, now: number): void {
  const live = sample !== null && sample.resetsAt > now ? sample : null;
  target.root.hidden = live === null;
  if (!live) return;
  const pct = Math.round(live.usedPct);
  target.pct.textContent = `${pct} %`;
  target.fill.style.width = `${Math.min(100, Math.max(0, live.usedPct))}%`;
  target.fill.dataset.level = level(live.usedPct);
  target.reset.textContent = t('usage.resetsIn', { time: duration(live.resetsAt - now) });
}

export function mountUsageCard(store: Store): { root: HTMLElement; destroy: () => void } {
  const five = row('5 h');
  const seven = row('');
  const note = el('p', 'usage-note');
  const title = el('h3', 'usage-title');
  const root = el('section', 'usage-card', title, five.root, seven.root, note);

  const render = (): void => {
    title.textContent = t('usage.title');
    root.setAttribute('aria-label', t('usage.title'));
    seven.label.textContent = t('usage.week');
    const now = store.now();
    const usage = store.usage;
    paint(five, usage?.fiveHour ?? null, now);
    paint(seven, usage?.sevenDay ?? null, now);
    const shown = !five.root.hidden || !seven.root.hidden;
    const stale = usage?.at != null && now - usage.at > STALE_USAGE_MS;
    root.classList.toggle('is-stale', shown && stale);
    note.hidden = shown && !stale;
    if (usage?.at == null) note.textContent = t('usage.noData');
    else if (!shown) note.textContent = t('usage.noWindow', { time: relativeTime(usage.at, now) });
    else note.textContent = t('usage.lastSample', { time: relativeTime(usage.at, now) });
  };

  const destroy = store.watch(['usage', 'tick', 'lang'], render);
  return { root, destroy };
}
