import { compareAgents } from './labels';
import type { AgentView } from './types';

export type Row = { agent: AgentView; depth: number };

export function orderRows(agents: readonly AgentView[]): Row[] {
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
