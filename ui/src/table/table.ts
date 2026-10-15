import { stateBadge } from '../badge';
import { el } from '../dom';
import { agentName, compareAgents, ROLE_LABELS, STACK_LABELS } from '../labels';
import type { Store } from '../store';
import { relativeTime } from '../time';
import type { AgentView, FloorKind, FloorView } from '../types';

const COLUMNS = ['Agente', 'Rol', 'Estado', 'Detalle', 'Último test', 'Desde'] as const;

const KIND_LABELS: Record<FloorKind, string> = {
  direccion: 'Dirección',
  managed: 'Gestionada',
  observed: 'Observada',
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

function floorSection(store: Store, floor: FloorView, agents: readonly AgentView[], now: number): HTMLElement {
  const header = el(
    'header',
    'floor-header',
    el('h2', 'floor-title', floor.label),
    el('span', 'chip', STACK_LABELS[floor.stack]),
    el('span', 'chip chip-kind', KIND_LABELS[floor.kind]),
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

  return el('section', `floor-section floor-${floor.kind}`, header, el('table', 'agents-table', head, body));
}

export function mountTable(host: HTMLElement, store: Store): void {
  let scheduled = false;
  let scrolledTo: string | null = null;

  const render = (): void => {
    const now = store.now();
    const byFloor = new Map<string, AgentView[]>();
    for (const agent of store.visibleAgents()) {
      const list = byFloor.get(agent.floor) ?? [];
      list.push(agent);
      byFloor.set(agent.floor, list);
    }
    const floors = store.floorList();
    if (floors.length === 0) {
      host.replaceChildren(el('p', 'placeholder', 'Esperando agentes…'));
      return;
    }
    const fragment = document.createDocumentFragment();
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
    const key = target.closest<HTMLElement>('tr[data-key]')?.dataset.key;
    if (key) store.select(key);
  });

  store.watch(['agents', 'floors', 'questions', 'selection', 'tick'], schedule);
}
