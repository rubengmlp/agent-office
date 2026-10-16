import { stateBadge } from '../badge';
import { el } from '../dom';
import { agentName, ROLE_LABELS } from '../labels';
import type { Store } from '../store';
import { relativeTime } from '../time';

export function mountHeader(host: HTMLElement, store: Store): void {
  store.watch(['selection', 'agents', 'floors', 'tick'], () => {
    const key = store.selectedKey;
    if (key === null) {
      host.replaceChildren(el('p', 'hint muted', 'Selecciona un agente en la lista, en la oficina o en la tabla.'));
      return;
    }
    const agent = store.agents.get(key);
    if (!agent) {
      host.replaceChildren(el('h2', 'panel-title', key.slice(0, 8)), el('p', 'hint muted', 'Agente no disponible.'));
      return;
    }
    const floor = store.floorBySlug(agent.floor);
    const now = store.now();
    const since = agent.endedAt !== null ? `terminó ${relativeTime(agent.endedAt, now)}` : `desde ${relativeTime(agent.stateSince, now)}`;
    host.replaceChildren(
      el('div', 'panel-title-row', el('h2', 'panel-title', agentName(agent)), stateBadge(store.shownState(agent))),
      el(
        'div',
        'panel-meta',
        el('span', 'chip', ROLE_LABELS[agent.roleKind]),
        el('span', 'chip', floor?.label ?? agent.floor),
        el('span', 'muted', since),
      ),
    );
  });
}
