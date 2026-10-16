import { currentLang, t } from './i18n';
import type {
  AgentState,
  AgentView,
  DocumentKind,
  DocumentStatus,
  DocumentView,
  FloorKind,
  FloorView,
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
  cerrado: 'Entregado',
  descartado: 'Descartado',
};

export const DOCUMENT_STATUS_COLORS: Record<DocumentStatus, string> = {
  borrador: '#94a3b8',
  revision: '#eab308',
  aprobado: '#22c55e',
  'sin-acuerdo': '#ef4444',
  cerrado: '#4f7cff',
  descartado: '#64748b',
};

export function roleLabel(kind: RoleKind): string {
  return t(`role.${kind}`);
}

export function roleHint(kind: RoleKind): string {
  return t(`role.hint.${kind}`);
}

export function stateLabel(state: AgentState): string {
  return t(`state.${state}`);
}

export function stateHint(state: AgentState): string {
  return t(`state.hint.${state}`);
}

export function stackLabel(stack: Stack): string {
  return t(`stack.${stack}`);
}

export function floorKindLabel(kind: FloorKind): string {
  return t(`floorKind.${kind}`);
}

export function floorKindHint(kind: FloorKind): string {
  return t(`floorKind.hint.${kind}`);
}

export function floorLabel(floor: Pick<FloorView, 'kind' | 'label'>): string {
  switch (floor.kind) {
    case 'direccion':
    case 'redaccion':
    case 'mantenimiento':
      return t(`floor.${floor.kind}`);
    default:
      return floor.label;
  }
}

export function verdictLabel(kind: VerdictKind): string {
  return t(`verdict.${kind}`);
}

export function alertLevelLabel(level: GuardAlertLevel): string {
  return t(`alert.${level}`);
}

export function alertLevelHint(level: GuardAlertLevel): string {
  return t(`alert.hint.${level}`);
}

export function documentStatusLabel(status: DocumentStatus): string {
  return t(`docStatus.${status}`);
}

export function documentStatusHint(status: DocumentStatus): string {
  return t(`docStatus.hint.${status}`);
}

export function agentName(agent: Pick<AgentView, 'key' | 'name' | 'role'>): string {
  return agent.name || agent.role || agent.key.slice(0, 8);
}

export function roleRank(kind: RoleKind): number {
  return ROLE_ORDER.indexOf(kind);
}

export function compareAgents(a: AgentView, b: AgentView): number {
  const byRole = roleRank(a.roleKind) - roleRank(b.roleKind);
  if (byRole !== 0) return byRole;
  return agentName(a).localeCompare(agentName(b), currentLang());
}

export function scoreText(score: number): string {
  return t('docStatus.score', { score });
}

export function documentStatusText(doc: Pick<DocumentView, 'status' | 'round' | 'score'>): string {
  switch (doc.status) {
    case 'revision':
      return doc.round > 0 ? t('docStatus.reviewRound', { n: doc.round }) : documentStatusLabel('revision');
    case 'aprobado':
      return doc.score === null ? documentStatusLabel('aprobado') : t('docStatus.approvedScore', { score: doc.score });
    default:
      return documentStatusLabel(doc.status);
  }
}

export function documentKindFor(kind: FloorKind): DocumentKind | null {
  if (kind === 'redaccion') return 'plan';
  if (kind === 'mantenimiento') return 'skill';
  return null;
}
