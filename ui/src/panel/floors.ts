import { orderRows, type Row } from '../agents-order';
import { el, setStateColor } from '../dom';
import { agentName, doingPhrase, isAway, ROLE_LABELS, STATE_COLORS } from '../labels';
import type { Store } from '../store';
import { relativeTime } from '../time';
import type { AgentView, FloorView } from '../types';

type TimeNode = { node: HTMLElement; ts: number };

function agentRow(store: Store, row: Row, times: TimeNode[], now: number): HTMLElement {
  const { agent, depth } = row;
  const state = store.shownState(agent);
  const away = isAway(agent);
  const dot = el('span', 'floors-dot');
  setStateColor(dot, STATE_COLORS[state]);
  const since = agent.endedAt ?? agent.stateSince;
  const time = el('time', 'floors-time muted', relativeTime(since, now));
  times.push({ node: time, ts: since });
  const item = el(
    'button',
    `floors-row${away ? ' floors-row-away' : ''}${store.selectedKey === agent.key ? ' selected' : ''}`,
    dot,
    el('span', 'floors-name', agentName(agent)),
    el('span', 'chip floors-role', ROLE_LABELS[agent.roleKind]),
    store.questionFor(agent.key) ? el('span', 'floors-ask', '?') : null,
    time,
    el('span', 'floors-doing', doingPhrase(agent, state)),
  );
  item.type = 'button';
  item.dataset.key = agent.key;
  item.style.paddingLeft = `${8 + depth * 14}px`;
  item.title = agent.task ? `Encargo: ${agent.task}` : agentName(agent);
  return el('li', '', item);
}

function floorCard(store: Store, floor: FloorView, agents: readonly AgentView[], open: boolean, times: TimeNode[], now: number): HTMLElement {
  const inside = agents.filter((agent) => !isAway(agent));
  const outside = agents.filter((agent) => isAway(agent));
  const body: HTMLElement[] = [];
  if (inside.length > 0) body.push(el('ul', 'floors-list', ...orderRows(inside).map((row) => agentRow(store, row, times, now))));
  else body.push(el('p', 'floors-empty muted', agents.length > 0 ? 'Nadie en la planta.' : 'Sin agentes.'));
  if (outside.length > 0) {
    body.push(
      el('p', 'floors-away-title section-title', 'Fuera de la oficina'),
      el('ul', 'floors-list', ...orderRows(outside).map((row) => agentRow(store, row, times, now))),
    );
  }
  const details = el(
    'details',
    'floors-card',
    el(
      'summary',
      'floors-summary',
      el('span', 'floors-floor', floor.label),
      el('span', 'chip floors-count', outside.length > 0 ? `${inside.length} · ${outside.length} fuera` : String(inside.length)),
    ),
    el('div', 'floors-body', ...body),
  );
  details.dataset.floor = floor.slug;
  details.dataset.shown = open ? '1' : '0';
  details.open = open;
  return details;
}

export function mountFloors(host: HTMLElement, store: Store): void {
  const open = new Set<string>();
  let touched = false;
  let selectedFloor: string | null = null;
  let scheduled = false;
  let times: TimeNode[] = [];

  const render = (): void => {
    const now = store.now();
    const byFloor = new Map<string, AgentView[]>();
    for (const agent of store.agents.values()) {
      const list = byFloor.get(agent.floor) ?? [];
      list.push(agent);
      byFloor.set(agent.floor, list);
    }
    const selected = store.selectedKey === null ? undefined : store.agents.get(store.selectedKey);
    if (selected && selected.floor !== selectedFloor) {
      selectedFloor = selected.floor;
      open.add(selected.floor);
    }
    const floors = store.floorList();
    times = [];
    if (floors.length === 0) {
      host.replaceChildren(el('p', 'floors-empty muted', 'Esperando agentes…'));
      return;
    }
    if (!touched && !selected) {
      for (const floor of floors) {
        if ((byFloor.get(floor.slug) ?? []).some((agent) => !isAway(agent))) open.add(floor.slug);
      }
    }
    host.replaceChildren(...floors.map((floor) => floorCard(store, floor, byFloor.get(floor.slug) ?? [], open.has(floor.slug), times, now)));
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
    const key = target.closest<HTMLElement>('[data-key]')?.dataset.key;
    if (key) store.select(key);
  });

  host.addEventListener(
    'toggle',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLDetailsElement) || target.dataset.floor === undefined) return;
      if (target.open === (target.dataset.shown === '1')) return;
      const slug = target.dataset.floor;
      target.dataset.shown = target.open ? '1' : '0';
      touched = true;
      if (target.open) open.add(slug);
      else open.delete(slug);
    },
    true,
  );

  store.watch(['agents', 'floors', 'selection', 'questions'], schedule);
  store.watch(['tick'], () => {
    const now = store.now();
    for (const { node, ts } of times) node.textContent = relativeTime(ts, now);
  });
}
