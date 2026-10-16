import type {
  AgentState,
  AgentView,
  DocumentKind,
  DocumentStatus,
  DocumentView,
  FloorKind,
  GuardAlertLevel,
  RoleKind,
  Stack,
  VerdictKind,
} from './types';

export const ROLE_LABELS: Record<RoleKind, string> = {
  director: 'Director',
  lead: 'Jefe de planta',
  dev: 'Desarrollador',
  tester: 'Tester',
  reviewer: 'Revisor',
  writer: 'Redactor',
  planReviewer: 'Revisor de planes',
  skillwright: 'Artesano',
  skillReviewer: 'Revisor de skills',
  intern: 'Becario',
};

export const ROLE_ORDER: readonly RoleKind[] = [
  'director',
  'lead',
  'dev',
  'tester',
  'reviewer',
  'writer',
  'planReviewer',
  'skillwright',
  'skillReviewer',
  'intern',
];

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

export const FLOOR_KIND_LABELS: Record<FloorKind, string> = {
  direccion: 'Dirección',
  managed: 'Gestionada',
  observed: 'Observada',
  redaccion: 'Redacción',
  mantenimiento: 'Mantenimiento',
};

export const VERDICT_LABELS: Record<VerdictKind, string> = {
  tests: 'Tests',
  approved: 'Aprobado',
  improve: 'Mejorar',
  'no-agreement': 'Sin acuerdo',
};

export const ALERT_LEVEL_LABELS: Record<GuardAlertLevel, string> = {
  alerta: 'Alerta',
  posible: 'Posible',
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  borrador: 'Borrador',
  revision: 'En revisión',
  aprobado: 'Aprobado',
  'sin-acuerdo': 'Sin acuerdo',
  entregado: 'Pendiente de decisión',
  aparcado: 'Aparcado',
  ejecutando: 'En ejecución',
  cerrado: 'Cerrado',
  descartado: 'Descartado',
};

export const DOCUMENT_STATUS_COLORS: Record<DocumentStatus, string> = {
  borrador: '#94a3b8',
  revision: '#eab308',
  aprobado: '#22c55e',
  'sin-acuerdo': '#ef4444',
  entregado: '#a855f7',
  aparcado: '#a8a29e',
  ejecutando: '#06b6d4',
  cerrado: '#4f7cff',
  descartado: '#64748b',
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

export function scoreText(score: number): string {
  return `nota ${score}/10`;
}

export function documentStatusText(doc: Pick<DocumentView, 'status' | 'round' | 'score'>): string {
  switch (doc.status) {
    case 'revision':
      return doc.round > 0 ? `En revisión · ronda ${doc.round}` : DOCUMENT_STATUS_LABELS.revision;
    case 'aprobado':
      return doc.score === null ? DOCUMENT_STATUS_LABELS.aprobado : `Aprobado · ${scoreText(doc.score)}`;
    default:
      return DOCUMENT_STATUS_LABELS[doc.status];
  }
}

export function documentKindFor(kind: FloorKind): DocumentKind | null {
  if (kind === 'redaccion') return 'plan';
  if (kind === 'mantenimiento') return 'skill';
  return null;
}
