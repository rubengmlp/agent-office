import { stateBadge } from '../badge';
import { el } from '../dom';
import { t } from '../i18n';
import { agentName, floorLabel, roleLabel } from '../labels';
import type { Store } from '../store';
import { relativeTime } from '../time';

export function mountHeader(host: HTMLElement, store: Store): void {
  store.watch(['selection', 'agents', 'floors', 'tick', 'lang'], () => {
    const key = store.selectedKey;
    if (key === null) {
      host.replaceChildren(el('p', 'hint muted', t('panel.selectHint')));
      return;
    }
    const agent = store.agents.get(key);
    if (!agent) {
      host.replaceChildren(el('h2', 'panel-title', key.slice(0, 8)), el('p', 'hint muted', t('panel.unavailable')));
      return;
    }
    const floor = store.floorBySlug(agent.floor);
    const now = store.now();
    const since =
      agent.endedAt !== null
        ? t('panel.ended', { time: relativeTime(agent.endedAt, now) })
        : t('panel.since', { time: relativeTime(agent.stateSince, now) });
    host.replaceChildren(
      el('div', 'panel-title-row', el('h2', 'panel-title', agentName(agent)), stateBadge(store.shownState(agent))),
      el(
        'div',
        'panel-meta',
        el('span', 'chip', roleLabel(agent.roleKind)),
        el('span', 'chip', floor ? floorLabel(floor) : agent.floor),
        el('span', 'muted', since),
      ),
    );
  });
}
