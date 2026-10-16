import { el, setStateColor } from './dom';
import { STATE_COLORS, stateHint, stateLabel } from './labels';
import type { AgentState } from './types';

export function stateBadge(state: AgentState): HTMLSpanElement {
  const badge = el('span', 'badge', el('span', 'badge-dot'), stateLabel(state));
  setStateColor(badge, STATE_COLORS[state]);
  badge.dataset.state = state;
  badge.title = stateHint(state);
  return badge;
}
