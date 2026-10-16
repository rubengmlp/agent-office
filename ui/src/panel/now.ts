import { el, setStateColor } from '../dom';
import { AWAY_ICON, doingPhrase, isAway, STATE_COLORS, STATE_ICONS } from '../labels';
import type { Store } from '../store';
import { clockTime, relativeTime } from '../time';
import type { ActivityView, AgentView } from '../types';

const STEP_LIMIT = 5;

type TimeNode = { node: HTMLElement; ts: number; prefix: string };

function lastSteps(store: Store, key: string): ActivityView[] {
  const steps: ActivityView[] = [];
  for (let index = store.activity.length - 1; index >= 0 && steps.length < STEP_LIMIT; index -= 1) {
    const entry = store.activity[index];
    if (entry.agentKey === key) steps.push(entry);
  }
  return steps;
}

function stepItem(entry: ActivityView): HTMLElement {
  const dot = el('span', 'now-step-dot');
  if (entry.state) setStateColor(dot, STATE_COLORS[entry.state]);
  else dot.classList.add('now-step-dot-empty');
  return el('li', 'now-step', dot, el('span', 'now-step-text', entry.summary), el('time', 'muted', clockTime(entry.ts)));
}

function chips(agent: AgentView, now: number, times: TimeNode[]): HTMLElement | null {
  const items: HTMLElement[] = [];
  if (agent.tool) items.push(el('span', 'chip now-chip', 'Herramienta ', el('code', '', agent.tool)));
  if (agent.file) {
    const file = el('span', 'chip now-chip', 'Fichero ', el('code', '', agent.file));
    file.title = agent.file;
    items.push(file);
  }
  if (agent.lastTest) {
    const { ok, ts, command } = agent.lastTest;
    const when = el('span', 'muted', relativeTime(ts, now));
    times.push({ node: when, ts, prefix: '' });
    const test = el('span', `chip now-chip ${ok ? 'now-test-ok' : 'now-test-fail'}`, ok ? '✓ tests ' : '✗ tests ', when);
    test.title = command;
    items.push(test);
  }
  return items.length > 0 ? el('div', 'now-chips', ...items) : null;
}

export function mountNow(host: HTMLElement, store: Store): void {
  let times: TimeNode[] = [];

  store.watch(['selection', 'agents', 'activity'], () => {
    times = [];
    const key = store.selectedKey;
    const agent = key === null ? undefined : store.agents.get(key);
    if (key === null || !agent) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    host.hidden = false;
    const now = store.now();
    const state = store.shownState(agent);
    const away = isAway(agent);
    const icon = el('span', 'now-icon', agent.away && agent.endedAt === null ? AWAY_ICON : STATE_ICONS[state]);
    setStateColor(icon, away && agent.endedAt === null ? 'var(--muted)' : STATE_COLORS[state]);
    const sinceTs = agent.endedAt ?? agent.stateSince;
    const sincePrefix = agent.endedAt !== null ? 'terminó ' : 'desde ';
    const since = el('p', 'now-since muted', `${sincePrefix}${relativeTime(sinceTs, now)}`);
    times.push({ node: since, ts: sinceTs, prefix: sincePrefix });
    const steps = lastSteps(store, key);
    host.replaceChildren(
      el(
        'section',
        `panel-card now-card${away ? ' now-away' : ''}`,
        el('div', 'now-head', icon, el('div', 'now-headline', el('p', 'now-title', doingPhrase(agent, state)), since)),
        chips(agent, now, times),
        agent.task ? el('p', 'now-task', el('span', 'muted', 'Encargo: '), agent.task) : null,
        el('h4', 'now-steps-title section-title', 'Últimos pasos'),
        steps.length > 0 ? el('ul', 'now-steps', ...steps.map(stepItem)) : el('p', 'muted hint', 'Sin actividad todavía.'),
      ),
    );
  });

  store.watch(['tick'], () => {
    if (host.hidden) return;
    const now = store.now();
    for (const { node, ts, prefix } of times) node.textContent = `${prefix}${relativeTime(ts, now)}`;
  });
}
