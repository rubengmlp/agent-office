import './chat.css';
import type { OfficeApi } from '../api';
import { button, el } from '../dom';
import { t, type MessageKey } from '../i18n';
import { floorLabel, roleLabel } from '../labels';
import type { Store } from '../store';
import { clockTime } from '../time';
import type { ChatKind, ChatMessageView, RoleId, RoleKind } from '../types';
import { openClaims } from './claims';

export type ChatHandle = { setActive(active: boolean): void };

const GLOBAL = 'global';
const HISTORY_PAGE = 100;
const BOTTOM_PX = 40;

// role.* texts go by RoleKind; the hub sends the RoleId of each author.
const ROLE_KIND_OF: Record<RoleId, RoleKind> = {
  lead: 'lead',
  dev: 'dev',
  tester: 'tester',
  director: 'director',
  reviewer: 'reviewer',
  redactor: 'writer',
  'revisor-planes': 'planReviewer',
  artesano: 'skillwright',
  'revisor-skills': 'skillReviewer',
};

const KIND_KEYS: Partial<Record<ChatKind, MessageKey>> = {
  toca: 'chat.kind.toca',
  listo: 'chat.kind.listo',
  pregunta: 'chat.kind.pregunta',
};

function shortTime(ts: number): string {
  return clockTime(ts).slice(0, 5);
}

export function mountChat(host: HTMLElement, store: Store, api: OfficeApi | null): ChatHandle {
  let active = false;
  let selected: string | null = null;
  let signature = '';
  let busy = false;
  let loadingOlder = false;
  const exhausted = new Set<string>();

  const heading = el('h1', 'chat-heading');
  const intro = el('p', 'muted hint');
  const channelsTitle = el('h2', 'chat-channels-title');
  const channelList = el('div', 'chat-channel-list');
  const channelTitle = el('h2', 'chat-channel-title');
  const claimsTitle = el('span', 'chat-claims-title');
  const claimsList = el('div', 'chat-claims-list');
  const older = button('', 'chat-older');
  const list = el('div', 'chat-messages');
  const textarea = el('textarea', 'chat-input');
  textarea.rows = 2;
  const send = button('', 'chat-send primary');

  host.replaceChildren(
    el(
      'div',
      'chat-page',
      el('header', 'chat-head', heading, intro),
      el(
        'div',
        'chat',
        el('nav', 'chat-channels', channelsTitle, channelList),
        el(
          'section',
          'chat-main',
          el('div', 'chat-main-head', channelTitle, el('div', 'chat-claims', claimsTitle, claimsList)),
          list,
          el('div', 'chat-compose', textarea, send),
        ),
      ),
    ),
  );

  const channels = (): string[] => [GLOBAL, ...store.floorList().filter((floor) => floor.kind === 'managed').map((floor) => floor.slug)];

  const channelName = (id: string): string => {
    if (id === GLOBAL) return t('chat.global');
    const floor = store.floorBySlug(id);
    return `#${floor ? floorLabel(floor) : id}`;
  };

  const current = (): string => {
    const all = channels();
    if (selected !== null && all.includes(selected)) return selected;
    return all.find((id) => store.chatOf(id).length > 0) ?? GLOBAL;
  };

  const messageRow = (message: ChatMessageView, channel: string): HTMLElement => {
    const kindKey = KIND_KEYS[message.kind];
    const author = message.origin === 'user' ? t('chat.you') : message.authorName;
    const roleId = message.roleId;
    const floor = store.floorBySlug(message.floor);
    const head = el(
      'div',
      'chat-msg-head',
      el('strong', 'chat-author', author),
      roleId && message.origin === 'agent' ? el('span', 'chip', roleLabel(ROLE_KIND_OF[roleId])) : null,
      channel === GLOBAL && message.origin === 'agent' ? el('span', 'chip', floor ? floorLabel(floor) : message.floor) : null,
      kindKey ? el('span', `chat-kind chat-kind-${message.kind}`, t(kindKey)) : null,
      el('time', 'chat-time muted', shortTime(message.ts)),
    );
    const files = message.files.length > 0 ? el('div', 'chat-files', ...message.files.map((file) => el('code', '', file))) : null;
    const text = message.text ? el('p', 'chat-text', message.text) : null;
    return el('article', `chat-msg${message.origin === 'user' ? ' chat-msg-user' : ''}`, head, files, text);
  };

  const paintChannels = (channel: string): void => {
    channelList.replaceChildren(
      ...channels().map((id) => {
        const unread = store.unreadChat(id);
        const item = button('', `chat-channel${id === channel ? ' active' : ''}`);
        item.append(el('span', 'chat-channel-name', channelName(id)));
        if (unread > 0 && !(active && id === channel)) item.append(el('b', 'tab-count', String(unread)));
        item.addEventListener('click', () => {
          selected = id;
          signature = '';
          paint();
          list.scrollTop = list.scrollHeight;
        });
        return item;
      }),
    );
  };

  const paintClaims = (messages: readonly ChatMessageView[]): void => {
    const claims = openClaims(messages, store.now());
    claimsTitle.textContent = t('chat.claims');
    claimsList.replaceChildren(
      ...(claims.length === 0
        ? [el('span', 'muted', t('chat.noClaims'))]
        : claims.map((claim) => el('span', 'chat-claim', el('code', '', claim.file), ' ', t('chat.claimSince', { who: claim.authorName, time: shortTime(claim.ts) })))),
    );
  };

  const paintMessages = (channel: string, messages: readonly ChatMessageView[]): void => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < BOTTOM_PX;
    const children: HTMLElement[] = [];
    if (api && !exhausted.has(channel)) children.push(older);
    if (messages.length === 0) children.push(el('p', 'muted hint chat-empty', t('chat.empty')));
    else children.push(...messages.map((message) => messageRow(message, channel)));
    list.replaceChildren(...children);
    if (atBottom) list.scrollTop = list.scrollHeight;
  };

  const paint = (): void => {
    const channel = current();
    if (active) store.markChatSeen(channel);
    paintChannels(channel);
    const messages = store.chatOf(channel);
    const next = JSON.stringify([store.lang, channel, messages.length, messages[0]?.id, messages.at(-1)?.id, exhausted.has(channel), loadingOlder]);
    if (next === signature) return;
    signature = next;
    channelTitle.textContent = channelName(channel);
    paintClaims(messages);
    paintMessages(channel, messages);
  };

  const refresh = (): void => {
    send.disabled = api === null || busy || textarea.value.trim() === '';
    textarea.disabled = api === null;
    older.disabled = loadingOlder;
  };

  const relabel = (): void => {
    heading.textContent = t('chat.title');
    intro.textContent = t('chat.intro');
    channelsTitle.textContent = t('chat.channels');
    textarea.placeholder = api ? t('chat.placeholder') : t('chat.readOnly');
    send.textContent = t('chat.send');
    older.textContent = loadingOlder ? t('chat.loading') : t('chat.loadOlder');
    signature = '';
    paint();
  };

  const loadOlder = async (): Promise<void> => {
    if (!api || loadingOlder) return;
    const channel = current();
    loadingOlder = true;
    older.textContent = t('chat.loading');
    refresh();
    const result = await api.chatHistory(channel, store.chatOf(channel)[0]?.id ?? null);
    loadingOlder = false;
    older.textContent = t('chat.loadOlder');
    refresh();
    if (!result.ok) {
      store.toast(result.message, 'error');
      return;
    }
    if (result.data.length < HISTORY_PAGE) exhausted.add(channel);
    const before = list.scrollHeight - list.scrollTop;
    store.prependChat(result.data);
    signature = '';
    paint();
    list.scrollTop = list.scrollHeight - before;
  };

  const submit = async (): Promise<void> => {
    const text = textarea.value.trim();
    if (!api || busy || text === '') return;
    const channel = current();
    busy = true;
    refresh();
    const result = await api.postChat(channel, text);
    busy = false;
    if (result.ok) {
      textarea.value = '';
      store.apply({ type: 'chat', data: result.data.message });
      store.toast(t('chat.sent', { channel }), 'ok');
      if (result.data.delivered === 0 && channel !== GLOBAL) store.toast(t('chat.sentNoLead'), 'info');
      list.scrollTop = list.scrollHeight;
    } else {
      store.toast(result.message, 'error');
    }
    refresh();
  };

  older.addEventListener('click', () => void loadOlder());
  textarea.addEventListener('input', refresh);
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  });
  send.addEventListener('click', () => void submit());

  store.watch(['lang'], relabel);
  store.watch(['chat', 'floors'], paint);
  refresh();

  return {
    setActive(next: boolean): void {
      active = next;
      if (!active) return;
      signature = '';
      paint();
      list.scrollTop = list.scrollHeight;
    },
  };
}
