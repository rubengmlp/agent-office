import { button, el } from './dom';
import type { ConnectionStatus, Store } from './store';

export type Tab = 'office' | 'table' | 'settings';

export type Topbar = {
  root: HTMLElement;
  replayHost: HTMLElement;
  setTab(tab: Tab): void;
};

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  nokey: 'Sin key',
  connecting: 'Conectando…',
  online: 'Conectado',
  offline: 'Sin conexión',
  denied: 'Key rechazada',
  replay: 'Replay',
};

const TABS: readonly { tab: Tab; label: string }[] = [
  { tab: 'office', label: 'Oficina' },
  { tab: 'table', label: 'Tabla' },
  { tab: 'settings', label: 'Ajustes' },
];

export function mountTopbar(store: Store, onTab: (tab: Tab) => void): Topbar {
  const dot = el('span', 'status-dot');
  const statusText = el('span', 'status-text');
  const pendingCount = el('b', 'pending-count');
  const pending = button('', 'pending', 'Ir al agente con la pregunta más antigua');
  pending.append('Preguntas pendientes ', pendingCount);
  const replayHost = el('div', 'replay-controls');

  const tabButtons = new Map<Tab, HTMLButtonElement>();
  const tabs = el('nav', 'tabs');
  for (const { tab, label } of TABS) {
    const tabButton = button(label, 'tab');
    tabButton.addEventListener('click', () => onTab(tab));
    tabButtons.set(tab, tabButton);
    tabs.append(tabButton);
  }

  const root = el(
    'header',
    'topbar',
    el('h1', 'brand', 'Agent Office'),
    el('div', 'status', dot, statusText),
    pending,
    replayHost,
    tabs,
  );

  pending.addEventListener('click', () => {
    const oldest = store.oldestQuestion();
    if (oldest) store.select(oldest.agentKey);
  });

  store.watch(['connection'], () => {
    dot.dataset.status = store.connection;
    statusText.textContent = STATUS_TEXT[store.connection];
  });

  store.watch(['questions'], () => {
    const count = store.questions.length;
    pendingCount.textContent = String(count);
    pending.disabled = count === 0;
    pending.classList.toggle('has-pending', count > 0);
  });

  const setTab = (active: Tab): void => {
    for (const [tab, tabButton] of tabButtons) {
      tabButton.classList.toggle('active', tab === active);
      tabButton.setAttribute('aria-selected', String(tab === active));
    }
  };
  setTab('office');

  return { root, replayHost, setTab };
}
