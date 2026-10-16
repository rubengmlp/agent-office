import { currentLang, t } from './i18n';
import { hubText } from './i18n/hub';
import type {
  AgentState,
  AgentView,
  DocumentKind,
  DocumentStatus,
  DocumentView,
  FloorKind,
  FloorView,
  GuardAlertLevel,
  HubText,
  RoleKind,
  Stack,
  VerdictKind,
} from './types';

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

export function roleLabel(kind: RoleKind): string {
  return t(`role.${kind}`);
}

export function roleHint(kind: RoleKind): string {
  return t(`role.hint.${kind}`);
}

export function stateLabel(state: AgentState): string {
  const key = `state.${state}` as const;
  const text = t(key);
  return text === key ? state : text;
}

export function stateHint(state: AgentState): string {
  return t(`state.hint.${state}`);
}

export function stackLabel(stack: Stack): string {
  const key = `stack.${stack}` as const;
  const text = t(key);
  return text === key ? stack : text;
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

// An old recording or an older hub may bring no maxRounds: then the round goes alone.
export function hasMaxRounds(doc: Pick<DocumentView, 'maxRounds'>): boolean {
  return typeof doc.maxRounds === 'number';
}

export function documentStatusText(doc: Pick<DocumentView, 'status' | 'round' | 'score' | 'maxRounds'>): string {
  switch (doc.status) {
    case 'revision':
      if (doc.round <= 0) return documentStatusLabel('revision');
      return hasMaxRounds(doc) ? t('docStatus.reviewRoundOfMax', { n: doc.round, max: doc.maxRounds }) : t('docStatus.reviewRound', { n: doc.round });
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

export const STATE_ICONS: Record<AgentState, string> = {
  idle: '…',
  working: '✎',
  reading: '≡',
  testing: '▶',
  checking: '✓',
  asking: '?',
  talking: '»',
  blocked: '!',
  done: '✓',
  failed: '✗',
};

export const AWAY_ICON = '⌂';

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SEARCH_TOOLS: ReadonlySet<string> = new Set(['Grep', 'Glob', 'LS', 'ToolSearch']);
const WEB_TOOLS: ReadonlySet<string> = new Set(['WebFetch', 'WebSearch']);
const SPAWN_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task']);
const THINKING_KEYS: ReadonlySet<string> = new Set(['hub.detail.thinking', 'hub.detail.starting', 'hub.detail.answerReceived', 'hub.detail.waiting']);
const RAW_THINKING: ReadonlySet<string> = new Set(['pensando', 'empieza', 'respuesta recibida', 'esperando']);
const PHRASE_MAX = 90;

function clip(value: string, max = PHRASE_MAX): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function isAway(agent: Pick<AgentView, 'away' | 'endedAt'>): boolean {
  return agent.away || agent.endedAt !== null;
}

function thinking(detail: HubText, text: string): boolean {
  if (typeof detail === 'string') return text === '' || RAW_THINKING.has(text);
  return THINKING_KEYS.has(detail.key);
}

function delegate(detail: HubText): string {
  if (typeof detail === 'string') return /^delega en ([^:]+)/.exec(detail)?.[1]?.trim() ?? '';
  if (detail.key === 'hub.detail.delegatesTo') return hubText(detail.params.who);
  if (detail.key === 'hub.detail.delegates') return hubText(detail.params.what);
  return '';
}

export function doingPhrase(agent: AgentView, state: AgentState = agent.state): string {
  if (agent.endedAt !== null || state === 'done') return t('doing.done');
  if (agent.away) return t('doing.away');
  const detail = agent.detail;
  const text = hubText(detail).trim();
  const tool = agent.tool ?? '';
  const target = agent.file ? fileName(agent.file) : text;
  switch (state) {
    case 'failed':
      return t('doing.failed');
    case 'idle':
      return t('doing.idle');
    case 'asking':
      if (typeof detail !== 'string' && detail.key === 'hub.detail.asks') return clip(t('doing.asksLead', { question: hubText(detail.params.question) }));
      return t('doing.awaitingYou');
    case 'blocked':
      return clip(t('doing.blocked', { reason: text.replace(/^\s*BLOQUEADO\s*:\s*/i, '') || t('doing.noReason') }));
    case 'testing':
      return text ? clip(t('doing.testsWith', { what: text })) : t('doing.tests');
    case 'checking':
      return text ? clip(t('doing.checkingWith', { what: text })) : t('doing.checking');
    case 'talking': {
      const to = text.replace(/^→\s*/, '');
      return to && to !== text ? clip(t('doing.talkingTo', { to })) : t('doing.talking');
    }
    case 'reading':
      if (WEB_TOOLS.has(tool)) return t('doing.web');
      if (SEARCH_TOOLS.has(tool)) return text ? clip(t('doing.searchingFor', { what: text })) : t('doing.searching');
      return target ? clip(t('doing.readingFile', { what: target })) : t('doing.reading');
    case 'working': {
      if (thinking(detail, text)) return t('doing.thinking');
      if (EDIT_TOOLS.has(tool)) return clip(t('doing.editing', { what: target || tool }));
      if (SPAWN_TOOLS.has(tool)) {
        const who = delegate(detail);
        return who ? clip(t('doing.delegatingTo', { who })) : t('doing.delegating');
      }
      if (tool === 'Bash') return text ? clip(t('doing.runningCommand', { what: text })) : t('doing.running');
      return clip(text || t('doing.working'));
    }
  }
}
