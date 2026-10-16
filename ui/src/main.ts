import './styles.css';
import { liveActions, replayActions, type Actions } from './actions';
import { OfficeApi } from './api';
import { browserPanelEnv, forgetPanelToken, panelCredential } from './auth';
import { el } from './dom';
import { Heartbeat } from './heartbeat';
import { applyLang, readStoredLang, t, type MessageKey, type Params } from './i18n';
import { LiveConnection } from './live';
import { Notifier } from './notify';
import type { OfficeHandle } from './office/office';
import { mountSettings } from './settings/settings';
import { mountPanel } from './panel/panel';
import { mountPlans } from './plans/plans';
import { loadRecording, mountReplayControls, ReplayPlayer } from './replay';
import { Store } from './store';
import { mountBoard } from './board/board';
import { mountChat, type ChatHandle } from './chat/chat';
import { mountTable } from './table/table';
import { mountToasts } from './toasts';
import { mountTopbar, type Tab } from './topbar';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function boot(): Promise<void> {
  applyLang(readStoredLang());
  const root = document.getElementById('app');
  if (!root) return;

  const store = new Store();
  const replayUrl = new URLSearchParams(location.search).get('replay');
  const panelEnv = replayUrl ? null : browserPanelEnv();
  const token = panelEnv ? await panelCredential(panelEnv) : null;

  let tab: Tab = 'office';
  let office: OfficeHandle | null = null;
  let chat: ChatHandle | null = null;

  const officeHost = el('div', 'view office-view active');
  const tableHost = el('div', 'view table-view');
  const boardHost = el('div', 'view board-view');
  const plansHost = el('div', 'view plans-view');
  const chatHost = el('div', 'view chat-view');
  const settingsHost = el('div', 'view settings-view');
  const view = new URLSearchParams(location.search).get('view') === '3d' ? '3d' : '2d';
  const notice = el('div', 'notice');
  notice.hidden = true;
  const panelHost = el('aside', 'panel');
  const toastHost = el('div', 'toasts');

  let noticeText: { key: MessageKey; params?: Params } | null = null;
  const paintNotice = (): void => {
    notice.hidden = noticeText === null;
    notice.textContent = noticeText ? t(noticeText.key, noticeText.params) : '';
  };
  const setNotice = (key: MessageKey | null, params?: Params): void => {
    noticeText = key === null ? null : { key, params };
    paintNotice();
  };
  store.watch(['lang'], paintNotice);

  const showTab = (next: Tab): void => {
    tab = next;
    topbar.setTab(next);
    officeHost.classList.toggle('active', next === 'office');
    tableHost.classList.toggle('active', next === 'table');
    boardHost.classList.toggle('active', next === 'board');
    plansHost.classList.toggle('active', next === 'plans');
    chatHost.classList.toggle('active', next === 'chat');
    settingsHost.classList.toggle('active', next === 'settings');
    office?.setActive(next === 'office');
    chat?.setActive(next === 'chat');
  };

  const topbar = mountTopbar(store, showTab);
  root.replaceChildren(topbar.root, el('main', 'main', officeHost, tableHost, boardHost, plansHost, chatHost, settingsHost, notice), panelHost, toastHost);

  let live: LiveConnection | null = null;
  let expired = false;
  const expire = (): void => {
    if (expired) return;
    expired = true;
    forgetPanelToken(panelEnv?.storage ?? null);
    live?.stop();
    store.setConnection('denied');
    setNotice('auth.expired');
  };

  const api = replayUrl || !token ? null : new OfficeApi(token, expire);
  const actions: Actions = api ? liveActions(store, api) : replayActions(store);

  mountTable(tableHost, store, api);
  mountPanel(panelHost, store, actions, api);
  mountBoard(boardHost, store, api);
  mountPlans(plansHost, store, api);
  chat = mountChat(chatHost, store, api);
  const notifier = api ? new Notifier(store) : null;
  mountSettings(settingsHost, store, api, notifier);
  mountToasts(toastHost, store);

  const mountView: Promise<OfficeHandle> =
    view === '3d'
      ? import('./scene/scene').then((module) => module.mountScene(officeHost, store))
      : import('./office/office').then((module) => module.mountOffice(officeHost, store));
  mountView
    .then((handle) => {
      office = handle;
      handle.setActive(tab === 'office');
    })
    .catch((error: unknown) => {
      const failure = el('p', 'placeholder');
      officeHost.replaceChildren(failure);
      store.watch(['lang'], () => {
        failure.textContent = t('main.officeFailed', { error: messageOf(error) });
      });
    });

  if (replayUrl) {
    loadRecording(replayUrl)
      .then((recording) => {
        const player = new ReplayPlayer(recording, store);
        mountReplayControls(topbar.replayHost, player, store);
        player.start();
      })
      .catch((error: unknown) => {
        store.setConnection('offline');
        setNotice('main.replayFailed', { error: messageOf(error) });
      });
    return;
  }

  if (!token) {
    store.setConnection('nokey');
    setNotice('auth.locked');
    return;
  }

  const heartbeat = new Heartbeat((message) => live?.send(message) ?? false);
  live = new LiveConnection(token, {
    onStatus: (status) => {
      if (status === 'denied') return expire();
      store.setConnection(status);
      setNotice(null);
    },
    onMessage: (message) => {
      store.apply(message);
      notifier?.observe(message);
    },
    onOpen: () => heartbeat.pulse(),
  });
  heartbeat.start();
  live.start();
}

void boot();
