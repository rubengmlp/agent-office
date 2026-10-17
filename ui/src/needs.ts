import { t } from './i18n';
import { agentName, isAway } from './labels';
import type { Store } from './store';
import type { AgentState, AgentView, DocumentView, OrderView, QuestionView } from './types';

export type NeedKind = 'permission' | 'question' | 'blocked' | 'stalled' | 'plan' | 'checks';

// Most urgent first: this is also the order of the queue.
export const NEED_KINDS: readonly NeedKind[] = ['permission', 'question', 'blocked', 'stalled', 'plan', 'checks'];

export type Need = {
  id: string;
  kind: NeedKind;
  since: number;
  name: string;
  agentKey: string | null;
  floor: string | null;
  docPath: string | null;
  orderSlug: string | null;
};

export type NeedSources = {
  agents: Iterable<AgentView>;
  questions: readonly QuestionView[];
  documents: readonly DocumentView[];
  orders: readonly OrderView[];
  stateOf(agent: AgentView): AgentState;
};

const RANK = new Map<NeedKind, number>(NEED_KINDS.map((kind, index) => [kind, index]));

function agentNeed(kind: NeedKind, agent: AgentView | undefined, key: string, since: number, floor: string | null): Need {
  return {
    id: `agent:${key}`,
    kind,
    since,
    name: agent ? agentName(agent) : key.slice(0, 8),
    agentKey: key,
    floor,
    docPath: null,
    orderSlug: null,
  };
}

function moreUrgent(a: Need, b: Need): boolean {
  const byKind = (RANK.get(a.kind) ?? 0) - (RANK.get(b.kind) ?? 0);
  return byKind !== 0 ? byKind < 0 : a.since < b.since;
}

// What waits for the user, in the order to attend it. An agent counts once, under its most urgent kind, and
// the ones that went home do not count.
export function collectNeeds(sources: NeedSources): Need[] {
  const agents = new Map<string, AgentView>();
  for (const agent of sources.agents) agents.set(agent.key, agent);
  const byAgent = new Map<string, Need>();
  const offer = (need: Need): void => {
    const known = byAgent.get(need.id);
    if (!known || moreUrgent(need, known)) byAgent.set(need.id, need);
  };

  for (const question of sources.questions) {
    const agent = agents.get(question.agentKey);
    if (agent && isAway(agent)) continue;
    offer(agentNeed(question.kind === 'permission' ? 'permission' : 'question', agent, question.agentKey, question.createdAt, question.floor));
  }
  for (const agent of agents.values()) {
    if (isAway(agent)) continue;
    if (sources.stateOf(agent) === 'blocked') offer(agentNeed('blocked', agent, agent.key, agent.stateSince, agent.floor));
    if (agent.stalledSince !== null) offer(agentNeed('stalled', agent, agent.key, agent.stalledSince, agent.floor));
  }

  const needs = [...byAgent.values()];
  for (const doc of sources.documents) {
    if (doc.kind !== 'plan' || doc.status !== 'entregado') continue;
    needs.push({
      id: `plan:${doc.path}`,
      kind: 'plan',
      since: doc.deliveredAt ?? doc.updatedAt,
      name: doc.title,
      agentKey: null,
      floor: doc.base[0]?.floor ?? null,
      docPath: doc.path,
      orderSlug: null,
    });
  }
  for (const order of sources.orders) {
    const open = order.status === 'en-curso' || order.status === 'revision';
    if (!open || !order.checks || order.checks.touched.length === 0 || order.checks.forced) continue;
    needs.push({
      id: `checks:${order.slug}`,
      kind: 'checks',
      since: order.updatedAt,
      name: order.title,
      agentKey: null,
      floor: order.floor,
      docPath: null,
      orderSlug: order.slug,
    });
  }

  return needs.sort((a, b) => (RANK.get(a.kind) ?? 0) - (RANK.get(b.kind) ?? 0) || a.since - b.since || a.id.localeCompare(b.id));
}

export function needsOf(store: Store): Need[] {
  return collectNeeds({
    agents: store.agents.values(),
    questions: store.questions,
    documents: store.documents,
    orders: store.orders,
    stateOf: (agent) => store.shownState(agent),
  });
}

export function needLabel(need: Pick<Need, 'kind' | 'name'>): string {
  return t(`needs.kind.${need.kind}`, { name: need.name });
}

export function needToast(position: number, total: number, need: Need): string {
  return t('needs.toast', { n: position, total, label: needLabel(need) });
}

export type NeedStep = { need: Need; position: number; total: number };

// Remembers the last need visited so N and Shift+N walk the queue: they wrap around, and start over from the
// first (or the last) one when the one visited is gone.
export class NeedCursor {
  private lastId: string | null = null;

  reset(): void {
    this.lastId = null;
  }

  step(needs: readonly Need[], direction: 1 | -1): NeedStep | null {
    if (needs.length === 0) {
      this.lastId = null;
      return null;
    }
    const at = this.lastId === null ? -1 : needs.findIndex((need) => need.id === this.lastId);
    let next: number;
    if (at < 0) next = direction === 1 ? 0 : needs.length - 1;
    else next = (at + direction + needs.length) % needs.length;
    const need = needs[next];
    this.lastId = need.id;
    return { need, position: next + 1, total: needs.length };
  }
}
