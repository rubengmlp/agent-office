import { stateBadge } from '../badge';
import { button, el } from '../dom';
import {
  agentName,
  ALERT_LEVEL_LABELS,
  compareAgents,
  DOCUMENT_STATUS_LABELS,
  documentKindFor,
  FLOOR_KIND_LABELS,
  ROLE_LABELS,
  scoreText,
  STACK_LABELS,
} from '../labels';
import { documentBadge, openDocument } from '../panel/deliverables';
import type { Store } from '../store';
import { relativeTime } from '../time';
import type { AgentView, DocumentKind, DocumentView, FloorView, GuardAlert } from '../types';

const COLUMNS = ['Agente', 'Rol', 'Estado', 'Detalle', 'Último test', 'Desde'] as const;
const ALERT_COUNT = 5;

const ALERT_HINTS: Record<GuardAlert['level'], string> = {
  alerta: 'Cambio en la planta sin que trabajara ningún agente de ella',
  posible: 'Puede venir de un comando Bash de un agente de la planta',
};

type Row = { agent: AgentView; depth: number };

function orderRows(agents: readonly AgentView[]): Row[] {
  const keys = new Set(agents.map((agent) => agent.key));
  const children = new Map<string, AgentView[]>();
  const roots: AgentView[] = [];
  for (const agent of agents) {
    if (agent.parentKey !== null && agent.parentKey !== agent.key && keys.has(agent.parentKey)) {
      const siblings = children.get(agent.parentKey) ?? [];
      siblings.push(agent);
      children.set(agent.parentKey, siblings);
    } else {
      roots.push(agent);
    }
  }
  const rows: Row[] = [];
  const visited = new Set<string>();
  const visit = (agent: AgentView, depth: number): void => {
    if (visited.has(agent.key)) return;
    visited.add(agent.key);
    rows.push({ agent, depth });
    for (const child of (children.get(agent.key) ?? []).sort(compareAgents)) visit(child, depth + 1);
  };
  for (const root of roots.sort(compareAgents)) visit(root, 0);
  for (const agent of agents) visit(agent, 0);
  return rows;
}

function testCell(agent: AgentView, now: number): HTMLTableCellElement {
  const cell = el('td', 'col-test');
  if (!agent.lastTest) {
    cell.classList.add('muted');
    cell.textContent = '—';
    return cell;
  }
  const { ok, ts, command } = agent.lastTest;
  cell.title = command;
  cell.append(el('span', ok ? 'test-ok' : 'test-fail', ok ? '✓' : '✗'), ' ', el('span', 'muted', relativeTime(ts, now)));
  return cell;
}

function agentRow(store: Store, row: Row, now: number): HTMLTableRowElement {
  const { agent, depth } = row;
  const state = store.shownState(agent);
  const tr = el('tr', 'agent-row');
  tr.dataset.key = agent.key;
  tr.classList.toggle('selected', store.selectedKey === agent.key);
  tr.classList.toggle('ended', agent.endedAt !== null);

  const nameCell = el('td', 'col-agent', depth > 0 ? el('span', 'tree-mark', '↳') : null, el('span', 'agent-name', agentName(agent)));
  nameCell.style.paddingLeft = `${12 + depth * 20}px`;

  const stateCell = el('td', 'col-state', stateBadge(state));
  if (store.questionFor(agent.key)) stateCell.append(el('span', 'ask-flag', '? pregunta pendiente'));

  const detailCell = el('td', 'col-detail', agent.tool ? el('code', 'tool-tag', agent.tool) : null, agent.detail);
  detailCell.title = agent.detail;

  tr.append(
    nameCell,
    el('td', 'col-role', ROLE_LABELS[agent.roleKind]),
    stateCell,
    detailCell,
    testCell(agent, now),
    el('td', 'col-since muted', relativeTime(agent.stateSince, now)),
  );
  return tr;
}

function documentRow(doc: DocumentView): HTMLElement {
  const open = button('', 'doc-row');
  open.dataset.doc = doc.path;
  open.title = doc.path;
  open.append(
    el('span', 'doc-row-title', doc.title),
    documentBadge(doc, DOCUMENT_STATUS_LABELS[doc.status]),
    el('span', 'doc-row-round muted', doc.round > 0 ? `ronda ${doc.round}` : '—'),
    el('span', 'doc-row-score muted', doc.score !== null ? scoreText(doc.score) : '—'),
  );
  return el('li', 'doc-row-item', open);
}

function documentList(store: Store, kind: DocumentKind): HTMLElement {
  const documents = store.documents.filter((doc) => doc.kind === kind).sort((a, b) => b.updatedAt - a.updatedAt);
  const title = kind === 'plan' ? 'Planes' : 'Skills';
  const empty = kind === 'plan' ? 'Sin planes todavía.' : 'Sin skills todavía.';
  return el(
    'div',
    'floor-docs',
    el('h3', 'section-title', title),
    documents.length > 0
      ? el('ul', 'doc-rows', ...documents.map(documentRow))
      : el('p', 'muted floor-docs-empty', empty),
  );
}

function floorSection(store: Store, floor: FloorView, agents: readonly AgentView[], now: number): HTMLElement {
  const documentKind = documentKindFor(floor.kind);
  const header = el(
    'header',
    'floor-header',
    el('h2', 'floor-title', floor.label),
    documentKind === null ? el('span', 'chip', STACK_LABELS[floor.stack]) : null,
    el('span', 'chip chip-kind', FLOOR_KIND_LABELS[floor.kind]),
    el('code', 'floor-path', floor.path ?? '—'),
  );

  const head = el('thead', '', el('tr', '', ...COLUMNS.map((title) => el('th', '', title))));
  const body = el('tbody');
  const rows = orderRows(agents);
  if (rows.length === 0) {
    const empty = el('td', 'empty muted', 'Sin agentes');
    empty.colSpan = COLUMNS.length;
    body.append(el('tr', 'empty-row', empty));
  }
  for (const row of rows) body.append(agentRow(store, row, now));

  return el(
    'section',
    `floor-section floor-${floor.kind}`,
    header,
    el('table', 'agents-table', head, body),
    documentKind === null ? null : documentList(store, documentKind),
  );
}

function alertItem(store: Store, alert: GuardAlert, now: number, open: boolean): HTMLElement {
  const floor = store.floorBySlug(alert.floor)?.label ?? alert.floor;
  const agent = store.agents.get(alert.agentKey);
  const count = alert.files.length;

  const level = el('span', `alert-level alert-level-${alert.level}`, ALERT_LEVEL_LABELS[alert.level]);
  level.title = ALERT_HINTS[alert.level];

  const files = el(
    'details',
    'alert-files',
    el('summary', '', `${count} ${count === 1 ? 'fichero' : 'ficheros'}`),
    el('ul', 'alert-file-list', ...alert.files.map((file) => el('li', '', el('code', '', file)))),
  );
  files.dataset.alert = String(alert.id);
  files.open = open;

  return el(
    'li',
    `alert alert-${alert.level}`,
    level,
    el('span', 'alert-floor', floor),
    files,
    agent ? el('span', 'alert-agent muted', `tras ${agentName(agent)}`) : null,
    el('time', 'alert-time muted', relativeTime(alert.ts, now)),
  );
}

function alertsSection(store: Store, openAlerts: ReadonlySet<number>, now: number): HTMLElement | null {
  const latest = [...store.alerts].sort((a, b) => a.ts - b.ts).slice(-ALERT_COUNT).reverse();
  if (latest.length === 0) return null;
  return el(
    'section',
    'alerts',
    el('h2', 'alerts-title', 'Alertas de la guardia'),
    el('ul', 'alert-list', ...latest.map((alert) => alertItem(store, alert, now, openAlerts.has(alert.id)))),
  );
}

export function mountTable(host: HTMLElement, store: Store): void {
  let scheduled = false;
  let scrolledTo: string | null = null;
  const openAlerts = new Set<number>();

  const render = (): void => {
    const now = store.now();
    const byFloor = new Map<string, AgentView[]>();
    for (const agent of store.visibleAgents()) {
      const list = byFloor.get(agent.floor) ?? [];
      list.push(agent);
      byFloor.set(agent.floor, list);
    }
    const floors = store.floorList();
    const fragment = document.createDocumentFragment();
    const alerts = alertsSection(store, openAlerts, now);
    if (alerts) fragment.append(alerts);
    if (floors.length === 0) {
      fragment.append(el('p', 'placeholder', 'Esperando agentes…'));
      host.replaceChildren(fragment);
      return;
    }
    for (const floor of floors) fragment.append(floorSection(store, floor, byFloor.get(floor.slug) ?? [], now));
    host.replaceChildren(fragment);

    if (store.selectedKey !== scrolledTo) {
      scrolledTo = store.selectedKey;
      host.querySelector('tr.selected')?.scrollIntoView({ block: 'nearest' });
    }
  };

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  };

  host.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const path = target.closest<HTMLElement>('[data-doc]')?.dataset.doc;
    if (path !== undefined) {
      const doc = store.documents.find((item) => item.path === path);
      if (doc) openDocument(store, doc);
      return;
    }
    const key = target.closest<HTMLElement>('tr[data-key]')?.dataset.key;
    if (key) store.select(key);
  });

  host.addEventListener(
    'toggle',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLDetailsElement) || target.dataset.alert === undefined) return;
      const id = Number(target.dataset.alert);
      if (target.open) openAlerts.add(id);
      else openAlerts.delete(id);
    },
    true,
  );

  store.watch(['agents', 'floors', 'questions', 'selection', 'tick', 'alerts', 'documents'], schedule);
}
