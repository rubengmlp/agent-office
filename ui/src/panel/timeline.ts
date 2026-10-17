import type { OfficeApi } from '../api';
import { el, setStateColor } from '../dom';
import { plural, t } from '../i18n';
import { hubText } from '../i18n/hub';
import { agentName, STATE_COLORS } from '../labels';
import type { Store } from '../store';
import { clockTime } from '../time';
import { EMPTY_FILTERS, matchesQuery, searchPath, SEARCH_DELAY_MS } from '../table/history';
import type { ActivityView, MessageView, SearchHit } from '../types';
import { panelSection } from './section';

const ACTIVITY_LIMIT = 50;
const MESSAGE_LIMIT = 30;
const RESULT_LIMIT = 30;

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
  return el('li', 'act', el('time', 'muted', clockTime(entry.ts)), dot, el('span', 'act-text', hubText(entry.summary)));
}

function section(title: string, items: readonly HTMLElement[], empty: string): HTMLElement {
  return el(
    'section',
    'timeline-section',
    el('h3', 'section-title', title),
    items.length > 0 ? el('ul', 'timeline-list', ...items) : el('p', 'muted hint', empty),
  );
}

type Remote = { q: string; state: 'loading' | 'done' | 'failed'; hits: SearchHit[]; error: string };

function hitItem(hit: SearchHit): HTMLElement {
  return el('li', 'act', el('time', 'muted', clockTime(hit.ts)), el('span', 'act-text', hubText(hit.text)));
}

// api null is a replay: nothing to ask, so the box filters what the recording has already delivered.
export function mountTimeline(host: HTMLElement, store: Store, api: OfficeApi | null): void {
  let signature = '';
  let query = '';
  let remote: Remote | null = null;
  let generation = 0;
  let timer: number | undefined;
  let lastKey: string | null = null;
  const card = panelSection({ id: 'timeline', title: () => t('timeline.title'), host });
  const search = el('input', 'timeline-search');
  search.type = 'text';
  search.autocomplete = 'off';
  const lists = el('div', 'timeline-lists');
  card.body.append(search, lists);
  host.hidden = true;

  const paintSearch = (): void => {
    search.placeholder = t('timeline.search.placeholder');
    search.setAttribute('aria-label', t('timeline.search.label'));
  };
  paintSearch();

  const runRemote = async (): Promise<void> => {
    const key = store.selectedKey;
    const q = query.trim();
    const mine = ++generation;
    if (!api || !q || key === null) {
      remote = null;
      render();
      return;
    }
    remote = { q, state: 'loading', hits: [], error: '' };
    render();
    const result = await api.search(searchPath({ ...EMPTY_FILTERS, q, agent: key }, null, RESULT_LIMIT));
    if (mine !== generation) return;
    remote = result.ok ? { q, state: 'done', hits: result.data.hits, error: '' } : { q, state: 'failed', hits: [], error: result.message };
    render();
  };

  const render = (): void => {
    const key = store.selectedKey;
    if (key === null) {
      signature = '';
      host.hidden = true;
      lists.replaceChildren();
      return;
    }
    host.hidden = false;
    const filtering = api === null && query.trim() !== '';
    const wanted = (text: string): boolean => !filtering || matchesQuery(text, query);
    const activity = newestFirst(store.activity, (entry) => entry.agentKey === key && wanted(hubText(entry.summary)), ACTIVITY_LIMIT);
    const mine = (message: MessageView): boolean => message.fromKey === key || message.toKey === key;
    const messages = newestFirst(store.messages, (message) => mine(message) && wanted(message.text ?? ''), MESSAGE_LIMIT);
    const total = store.messages.filter(mine).length;
    const next = [store.lang, key, query, remote?.state ?? '', remote?.hits.length ?? 0, activity.length, activity[0]?.ts ?? 0, total, messages.length, messages[0]?.id ?? 0].join(':');
    if (next === signature) return;
    signature = next;
    card.setTitle();
    card.setMeta(plural('panel.sectionMeta.messages', total));
    if (remote) {
      let content: HTMLElement;
      if (remote.state === 'loading') content = el('p', 'muted hint', t('timeline.search.loading'));
      else if (remote.state === 'failed') content = el('p', 'muted hint', t('timeline.search.failed', { error: remote.error }));
      else content = section(t('timeline.search.results'), remote.hits.map(hitItem), t('timeline.search.none'));
      lists.replaceChildren(content);
      return;
    }
    const none = filtering ? t('timeline.search.none') : '';
    lists.replaceChildren(
      section(t('timeline.messages'), messages.map((message) => messageItem(store, key, message)), none || t('timeline.noMessages')),
      section(t('timeline.activity'), activity.map(activityItem), none || t('timeline.noActivity')),
    );
  };

  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      query = search.value;
      if (api) void runRemote();
      else render();
    }, SEARCH_DELAY_MS);
  });

  store.watch(['selection', 'activity', 'messages', 'agents', 'lang'], () => {
    paintSearch();
    if (store.selectedKey !== lastKey) {
      lastKey = store.selectedKey;
      if (api && query.trim()) {
        void runRemote();
        return;
      }
    }
    render();
  });
}
