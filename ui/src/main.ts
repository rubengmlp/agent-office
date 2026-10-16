import './styles.css';
import { liveActions, replayActions, type Actions } from './actions';
import { OfficeApi } from './api';
import { el } from './dom';
import { Heartbeat } from './heartbeat';
import { applyLang, readStoredLang } from './i18n';
import { LiveConnection } from './live';
import type { OfficeHandle } from './office/office';
import { mountSettings } from './settings/settings';
import { mountPanel } from './panel/panel';
import { loadRecording, mountReplayControls, ReplayPlayer } from './replay';
import { Store } from './store';
import { mountTable } from './table/table';
import { mountToasts } from './toasts';
import { mountTopbar, type Tab } from './topbar';

const NO_KEY_NOTICE = 'Sin key: ejecuta bun run setup y abre la oficina desde el hub';
const DENIED_NOTICE = 'Key rechazada por el hub: abre la oficina desde el hub (bun run setup).';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boot(): void {
  applyLang(readStoredLang());
  const root = document.getElementById('app');
  if (!root) return;

  const store = new Store();
  const replayUrl = new URLSearchParams(location.search).get('replay');
  const key = window.__OFFICE_KEY__ ?? '';

  let tab: Tab = 'office';
  let office: OfficeHandle | null = null;

  const officeHost = el('div', 'view office-view active');
  const tableHost = el('div', 'view table-view');
  const settingsHost = el('div', 'view settings-view');
  const view = new URLSearchParams(location.search).get('view') === '3d' ? '3d' : '2d';
  const notice = el('div', 'notice');
  notice.hidden = true;
  const panelHost = el('aside', 'panel');
  const toastHost = el('div', 'toasts');

  const setNotice = (text: string | null): void => {
    notice.hidden = text === null;
    notice.textContent = text ?? '';
  };

  const showTab = (next: Tab): void => {
    tab = next;
    topbar.setTab(next);
    officeHost.classList.toggle('active', next === 'office');
    tableHost.classList.toggle('active', next === 'table');
    settingsHost.classList.toggle('active', next === 'settings');
    office?.setActive(next === 'office');
  };

  const topbar = mountTopbar(store, showTab);
  root.replaceChildren(topbar.root, el('main', 'main', officeHost, tableHost, settingsHost, notice), panelHost, toastHost);

  const api = replayUrl || !key ? null : new OfficeApi(key);
  const actions: Actions = api ? liveActions(store, api) : replayActions(store);

  mountTable(tableHost, store);
  mountPanel(panelHost, store, actions, api);
  mountSettings(settingsHost, store, api);
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
      officeHost.replaceChildren(el('p', 'placeholder', `No se pudo iniciar la oficina: ${messageOf(error)}`));
    });

  if (replayUrl) {
    loadRecording(replayUrl)
      .then((recording) => {
        const player = new ReplayPlayer(recording, store);
        mountReplayControls(topbar.replayHost, player);
        player.start();
      })
      .catch((error: unknown) => {
        store.setConnection('offline');
        setNotice(`No se pudo cargar el replay: ${messageOf(error)}`);
      });
    return;
  }

  if (!key) {
    store.setConnection('nokey');
    setNotice(NO_KEY_NOTICE);
    return;
  }

  const heartbeat = new Heartbeat((message) => live.send(message));
  const live = new LiveConnection(key, {
    onStatus: (status) => {
      store.setConnection(status);
      setNotice(status === 'denied' ? DENIED_NOTICE : null);
    },
    onMessage: (message) => store.apply(message),
    onOpen: () => heartbeat.pulse(),
  });
  heartbeat.start();
  live.start();
}

boot();
