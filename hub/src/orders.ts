import { slugify } from './floors';
import type { OrderStatus } from './types';

// The four columns of the Tablero, in order; descartado is not a column.
export const BOARD_COLUMNS: readonly OrderStatus[] = ['pendiente', 'en-curso', 'revision', 'hecho'];

export const OPEN_STATUSES: readonly OrderStatus[] = ['pendiente', 'en-curso', 'revision'];

export const BRIEF_TITLE_MAX = 100;
export const BRIEF_DESCRIPTION_MAX = 2000;
const SLUG_BASE_MAX = 40;

// What an event does to a card. Everything else (a merge, a pull request) leaves the status alone.
export type OrderEvent = 'activity' | 'done' | 'discard';

// activity: the first event whose cwd is inside the folder starts the work. done: an accepted HECHO closes the
// card, or sends it to revision when a review is pending. A repeated HECHO of a finished card stays finished.
export function nextStatus(from: OrderStatus, event: OrderEvent, reviewPending = false): OrderStatus | null {
  switch (event) {
    case 'activity':
      return from === 'pendiente' ? 'en-curso' : null;
    case 'done':
      if (from === 'descartado') return null;
      if (from === 'hecho') return 'hecho';
      return reviewPending ? 'revision' : 'hecho';
    case 'discard':
      return from === 'descartado' ? null : 'descartado';
  }
}

// A move by hand (the arrows or a drag). Leaving hecho always reopens the card as en-curso; discarding has its
// own action and a discarded card does not come back.
export function manualTarget(from: OrderStatus, to: OrderStatus): OrderStatus | null {
  if (from === 'descartado' || to === 'descartado' || from === to) return null;
  if (from === 'hecho') return 'en-curso';
  return to;
}

// Every way out of hecho opens a new cycle.
export function leavesDone(from: OrderStatus, to: OrderStatus): boolean {
  return from === 'hecho' && to !== 'hecho';
}

// The slug of an order: the title in a-z0-9 and dashes, cut to a length, and a short suffix to tell equal titles apart.
export function orderSlug(title: string, suffix: string): string {
  const base = slugify(title).slice(0, SLUG_BASE_MAX).replace(/-+$/, '') || 'encargo';
  return `${base}-${suffix}`;
}

export function randomSuffix(random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < 4; i += 1) out += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)];
  return out;
}

// The brief of a director is ENCARGO: <short title> — <what> — criteria — out of scope: the title is what comes
// before the first dash with spaces around it, the rest the description.
export function splitBrief(text: string, prefix: RegExp): { title: string; description: string } {
  const body = text.replace(prefix, '').trim();
  const lines = body.split('\n');
  const first = (lines.shift() ?? '').trim();
  const dash = /\s[—–]\s/.exec(first);
  const head = dash ? first.slice(0, dash.index).trim() : first;
  const tail = dash ? first.slice(dash.index + dash[0].length).trim() : '';
  const title = head.length > BRIEF_TITLE_MAX ? `${head.slice(0, BRIEF_TITLE_MAX - 1).trimEnd()}…` : head;
  const rest = [head.length > BRIEF_TITLE_MAX ? head : '', tail, ...lines].filter((part) => part !== '').join('\n').trim();
  return { title: title || 'Encargo', description: rest.slice(0, BRIEF_DESCRIPTION_MAX) };
}

// The text of an accepted HECHO without its prefix and the encargo it names: what the popup shows.
export function doneSummary(body: string): string {
  return body
    .replace(/^\s*HECHO\s*:\s*/i, '')
    .replace(/^`?encargo\/[a-z0-9-]+`?\s*(?:[—–:-]\s*)?/i, '')
    .trim()
    .slice(0, 600);
}
