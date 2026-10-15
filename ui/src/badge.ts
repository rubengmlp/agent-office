import { el, setStateColor } from './dom';
import { STATE_COLORS, STATE_LABELS } from './labels';
import type { AgentState } from './types';

export function stateBadge(state: AgentState): HTMLSpanElement {
  const badge = el('span', 'badge', el('span', 'badge-dot'), STATE_LABELS[state]);
  setStateColor(badge, STATE_COLORS[state]);
  badge.dataset.state = state;
  return badge;
}
