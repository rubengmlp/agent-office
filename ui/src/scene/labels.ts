import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { STATE_COLORS, STATE_LABELS } from '../labels';
import type { AgentState } from '../types';

export type LabelIcon = 'ask' | 'talk' | 'lock' | 'stamp' | 'check' | 'cross';
export type LabelLod = 'near' | 'mid' | 'far';
export type BadgeKind = 'ok' | 'fail';

export type LabelInput = {
  name: string;
  state: AgentState;
  icon: LabelIcon | null;
  progress: boolean;
  badge: BadgeKind | null;
  selected: boolean;
  pending: boolean;
  alpha: number;
  lod: LabelLod;
  following: boolean;
};

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
const LOCK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 10.5V7.5a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/><rect x="5" y="10" width="14" height="11" rx="2.5" fill="currentColor"/><circle cx="12" cy="15.5" r="1.6" fill="#7f1d1d"/></svg>';
const STAMP_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3h5v6.5l2.5 3.5H7l2.5-3.5z" fill="currentColor"/><rect x="4" y="13.5" width="16" height="4.5" rx="1.2" fill="currentColor"/><rect x="5.5" y="19.5" width="13" height="2" rx="1" fill="currentColor" opacity=".55"/></svg>';

const ICON_MARKUP: Record<LabelIcon, string> = {
  ask: '<span class="scene-q">?</span>',
  talk: '<span class="scene-dots"><i></i><i></i><i></i></span>',
  lock: LOCK_SVG,
  stamp: STAMP_SVG,
  check: CHECK_SVG,
  cross: CROSS_SVG,
};

function div(className: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

function span(className: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = className;
  return node;
}

export class AgentLabel {
  readonly object: CSS2DObject;
  private readonly root = div('scene-tag');
  private readonly bubble = div('scene-tag-bubble');
  private readonly progress = div('scene-tag-progress');
  private readonly badge = div('scene-tag-badge');
  private readonly chip = div('scene-tag-chip');
  private readonly nameEl = span('scene-tag-name');
  private readonly stateEl = span('scene-tag-state');
  private name = '';
  private state: AgentState | null = null;
  private icon: LabelIcon | null | undefined = undefined;
  private badgeKind: BadgeKind | null | undefined = undefined;
  private progressOn: boolean | undefined = undefined;
  private flags = '';
  private alpha = -1;

  constructor(key: string, onSelect: (key: string) => void, onFollow: (key: string) => void) {
    const dot = span('scene-tag-dot');
    this.chip.append(dot, this.nameEl, this.stateEl);
    this.progress.append(span('scene-tag-progress-fill'));
    this.bubble.hidden = true;
    this.progress.hidden = true;
    this.badge.hidden = true;
    this.root.append(this.bubble, this.progress, this.badge, this.chip);
    this.chip.addEventListener('click', (event) => {
      event.stopPropagation();
      onSelect(key);
    });
    this.chip.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      onFollow(key);
    });
    this.chip.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.object = new CSS2DObject(this.root);
    this.object.center.set(0.5, 1);
  }

  update(input: LabelInput): void {
    if (input.name !== this.name) {
      this.name = input.name;
      this.nameEl.textContent = input.name;
      this.chip.title = input.name;
    }
    if (input.state !== this.state) {
      this.state = input.state;
      this.stateEl.textContent = STATE_LABELS[input.state] ?? input.state;
      this.root.style.setProperty('--c', STATE_COLORS[input.state] ?? '#94a3b8');
      this.root.dataset.state = input.state;
    }
    if (input.icon !== this.icon) {
      this.icon = input.icon;
      this.bubble.hidden = input.icon === null;
      this.bubble.className = input.icon === null ? 'scene-tag-bubble' : `scene-tag-bubble is-${input.icon}`;
      this.bubble.innerHTML = input.icon === null ? '' : ICON_MARKUP[input.icon];
    }
    if (input.progress !== this.progressOn) {
      this.progressOn = input.progress;
      this.progress.hidden = !input.progress;
    }
    if (input.badge !== this.badgeKind) {
      this.badgeKind = input.badge;
      this.badge.hidden = input.badge === null;
      this.badge.className = input.badge === null ? 'scene-tag-badge' : `scene-tag-badge is-${input.badge}`;
      this.badge.innerHTML = input.badge === 'ok' ? CHECK_SVG : input.badge === 'fail' ? CROSS_SVG : '';
    }
    const flags = `${input.lod}|${input.selected ? 1 : 0}|${input.pending ? 1 : 0}|${input.following ? 1 : 0}`;
    if (flags !== this.flags) {
      this.flags = flags;
      this.root.dataset.lod = input.lod;
      this.root.classList.toggle('is-selected', input.selected);
      this.root.classList.toggle('is-pending', input.pending);
      this.root.classList.toggle('is-following', input.following);
    }
    const alpha = Math.round(Math.max(0, Math.min(1, input.alpha)) * 20) / 20;
    if (alpha !== this.alpha) {
      this.alpha = alpha;
      this.root.style.opacity = alpha >= 1 ? '' : String(alpha);
    }
    const visible = alpha > 0.02;
    if (this.object.visible !== visible) this.object.visible = visible;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.root.remove();
  }
}
