import { el, setStateColor } from '../dom';
import { agentName, STATE_COLORS } from '../labels';
import type { Store } from '../store';
import { clockTime } from '../time';
import type { ActivityView, MessageView } from '../types';

const ACTIVITY_LIMIT = 50;
const MESSAGE_LIMIT = 30;

function newestFirst<T>(items: readonly T[], keep: (item: T) => boolean, limit: number): T[] {
  const picked: T[] = [];
  for (let index = items.length - 1; index >= 0 && picked.length < limit; index -= 1) {
    const item = items[index];
    if (keep(item)) picked.push(item);
  }
  return picked;
}

function messageItem(store: Store, selectedKey: string, message: MessageView): HTMLElement {
  const outgoing = message.fromKey === selectedKey;
  const sender = store.agents.get(message.fromKey);
  const peer = outgoing ? `→ ${message.toName}` : `← ${sender ? agentName(sender) : message.fromKey.slice(0, 8)}`;
  return el(
    'li',
    `msg ${outgoing ? 'msg-out' : 'msg-in'}`,
    el('div', 'msg-head', el('span', 'msg-dir', peer), el('time', 'muted', clockTime(message.ts))),
    message.text !== null ? el('p', 'msg-text', message.text) : null,
  );
}

function activityItem(entry: ActivityView): HTMLElement {
  const dot = el('span', 'act-dot');
  if (entry.state) setStateColor(dot, STATE_COLORS[entry.state]);
  else dot.classList.add('act-dot-empty');
  return el('li', 'act', el('time', 'muted', clockTime(entry.ts)), dot, el('span', 'act-text', entry.summary));
}

function section(title: string, items: readonly HTMLElement[], empty: string): HTMLElement {
  return el(
    'section',
    'timeline-section',
    el('h3', 'section-title', title),
    items.length > 0 ? el('ul', 'timeline-list', ...items) : el('p', 'muted hint', empty),
  );
}

export function mountTimeline(host: HTMLElement, store: Store): void {
  let signature = '';

  store.watch(['selection', 'activity', 'messages', 'agents'], () => {
    const key = store.selectedKey;
    if (key === null) {
      signature = '';
      host.replaceChildren();
      return;
    }
    const activity = newestFirst(store.activity, (entry) => entry.agentKey === key, ACTIVITY_LIMIT);
    const messages = newestFirst(store.messages, (m) => m.fromKey === key || m.toKey === key, MESSAGE_LIMIT);
    const next = [key, activity.length, activity[0]?.ts ?? 0, messages.length, messages[0]?.id ?? 0].join(':');
    if (next === signature) return;
    signature = next;
    host.replaceChildren(
      section('Mensajes', messages.map((message) => messageItem(store, key, message)), 'Sin mensajes.'),
      section('Actividad', activity.map(activityItem), 'Sin actividad.'),
    );
  });
}
