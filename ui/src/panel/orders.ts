import type { Actions } from '../actions';
import { button, el } from '../dom';
import { t } from '../i18n';
import { agentName, floorLabel } from '../labels';
import type { Store } from '../store';
import type { SessionView } from '../types';
import { panelSection } from './section';

const DIRECTOR_ROLES: ReadonlySet<string> = new Set(['office-director', 'office:director']);

function sessionLabel(store: Store, session: SessionView): string {
  const name = session.name || session.role || session.agentKey.slice(0, 8);
  const known = store.floorBySlug(session.floor);
  const floor = known ? floorLabel(known) : session.floor;
  return `${name} · ${floor}`;
}

function defaultSession(sessions: readonly SessionView[]): SessionView | undefined {
  return sessions.find((session) => session.role !== null && DIRECTOR_ROLES.has(session.role)) ?? sessions[0];
}

export function mountOrders(host: HTMLElement, store: Store, actions: Actions): void {
  const select = el('select', 'orders-select');
  const textarea = el('textarea', 'orders-text');
  textarea.rows = 3;
  const send = button('', 'primary');
  const status = el('p', 'orders-status');
  const targetLabel = el('span', 'field-label muted');

  const section = panelSection({ id: 'orders', title: () => t('orders.title'), host });
  section.body.append(el('label', 'field', targetLabel, select), textarea, el('div', 'orders-actions', send, status));

  let busy = false;
  let manualChoice = false;
  let preselect: string | null = null;
  let assistKey: string | null = null;
  let prefillText: string | null = null;
  let signature: string | null = null;
  let sent = false;

  const eligible = (): SessionView[] =>
    [...store.sessions.values()].filter((session) => session.canReceive && session.endedAt === null);

  const refresh = (): void => {
    const enabled = actions.ordersEnabled;
    textarea.disabled = !enabled || busy;
    select.disabled = !enabled || busy || select.options.length === 0;
    send.disabled = !enabled || busy || textarea.value.trim() === '' || select.value === '';
    send.textContent = busy ? t('panel.sending') : t('orders.send');
    section.setMeta(select.selectedOptions[0]?.textContent ?? null);
  };

  const syncSessions = (): void => {
    const sessions = eligible();
    const previous = select.value;
    const next = sessions.map((session) => `${session.sessionId}|${sessionLabel(store, session)}`).join('\n');
    if (next !== signature) {
      signature = next;
      select.replaceChildren(
        ...sessions.map((session) => {
          const option = el('option', '', sessionLabel(store, session));
          option.value = session.sessionId;
          return option;
        }),
      );
    }
    const ids = new Set(sessions.map((session) => session.sessionId));
    let desired = defaultSession(sessions)?.sessionId ?? '';
    if (manualChoice && ids.has(previous)) desired = previous;
    else if (preselect !== null && ids.has(preselect)) desired = preselect;
    select.value = desired;
  };

  const endAssist = (): void => {
    if (prefillText !== null) {
      if (textarea.value === prefillText) textarea.value = '';
      else manualChoice = true;
    }
    prefillText = null;
    preselect = null;
    assistKey = null;
  };

  const syncBlockedAssist = (): void => {
    const agent = store.selectedKey === null ? undefined : store.agents.get(store.selectedKey);
    const blocked = agent !== undefined && store.shownState(agent) === 'blocked';
    section.setForced(blocked);
    if (!agent || !blocked) {
      if (assistKey !== null) endAssist();
      return;
    }
    if (assistKey === agent.key) return;
    if (assistKey !== null) endAssist();
    assistKey = agent.key;
    if (textarea.value.trim() !== '') return;
    const session = store.sessions.get(agent.sessionId);
    manualChoice = false;
    preselect = session && session.canReceive && session.endedAt === null ? session.sessionId : null;
    prefillText = t('orders.blockReply', { name: agentName(agent) });
    textarea.value = prefillText;
  };

  const sync = (): void => {
    syncBlockedAssist();
    syncSessions();
    refresh();
  };

  const submit = async (): Promise<void> => {
    const text = textarea.value.trim();
    const sessionId = select.value;
    if (busy || !actions.ordersEnabled || text === '' || sessionId === '') return;
    busy = true;
    sent = false;
    status.textContent = '';
    status.classList.remove('error');
    refresh();
    const result = await actions.order({ sessionId, text });
    busy = false;
    if (result.ok) {
      textarea.value = '';
      prefillText = null;
      sent = true;
      status.textContent = t('toast.orderSent');
    } else {
      status.textContent = result.message;
      status.classList.add('error');
    }
    refresh();
  };

  select.addEventListener('change', () => {
    manualChoice = true;
    refresh();
  });
  textarea.addEventListener('input', refresh);
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  });
  send.addEventListener('click', () => void submit());

  const relabel = (): void => {
    section.setTitle();
    targetLabel.textContent = t('orders.target');
    textarea.placeholder = actions.ordersEnabled ? t('orders.placeholder') : t('orders.disabled');
    if (sent) status.textContent = t('toast.orderSent');
  };
  store.watch(['lang'], relabel);

  store.watch(['selection', 'agents', 'sessions', 'floors', 'mode', 'lang'], sync);
}
