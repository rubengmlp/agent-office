import type { AgentState, AgentView, RoleKind, Stack } from './types';

export const ROLE_LABELS: Record<RoleKind, string> = {
  director: 'Director',
  lead: 'Jefe de planta',
  dev: 'Desarrollador',
  tester: 'Tester',
  reviewer: 'Revisor',
  intern: 'Becario',
};

export const ROLE_ORDER: readonly RoleKind[] = ['director', 'lead', 'dev', 'tester', 'reviewer', 'intern'];

export const STATE_LABELS: Record<AgentState, string> = {
  idle: 'Libre',
  working: 'Trabajando',
  reading: 'Leyendo',
  testing: 'En tests',
  checking: 'Revisando',
  asking: 'Pregunta',
  talking: 'Hablando',
  blocked: 'Bloqueado',
  done: 'Terminado',
  failed: 'Fallido',
};

export const STATE_COLORS: Record<AgentState, string> = {
  idle: '#94a3b8',
  working: '#4f7cff',
  reading: '#14b8a6',
  testing: '#a78bfa',
  checking: '#eab308',
  asking: '#fb923c',
  talking: '#f472b6',
  blocked: '#ef4444',
  done: '#22c55e',
  failed: '#9f1239',
};

export const STACK_LABELS: Record<Stack, string> = {
  flutter: 'Flutter',
  laravel: 'Laravel',
  node: 'Node',
  generic: 'Genérico',
};

export function agentName(agent: Pick<AgentView, 'key' | 'name' | 'role'>): string {
  return agent.name || agent.role || agent.key.slice(0, 8);
}

export function roleRank(kind: RoleKind): number {
  return ROLE_ORDER.indexOf(kind);
}

export function compareAgents(a: AgentView, b: AgentView): number {
  const byRole = roleRank(a.roleKind) - roleRank(b.roleKind);
  if (byRole !== 0) return byRole;
  return agentName(a).localeCompare(agentName(b), 'es');
}
