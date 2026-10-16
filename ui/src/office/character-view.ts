import { Rectangle, type Container } from 'pixi.js';
import { buildCharacter, type CharacterParts, type Look } from '../sprites/sprites';
import type { AgentState, TestResult } from '../types';
import {
  BADGE_VISIBLE_S,
  CHAR_H,
  CHAR_W,
  EXIT_FADE_S,
  FADE_HOLD_S,
  FADE_S,
  TALK_VISIBLE_S,
  WALK_SPEED,
} from './constants';
import { Overlay, type BadgeKind, type IconKind } from './effects';
import type { DeskParts } from './furniture';
import type { Point } from './layout';

export type TargetKind = 'desk' | 'lab' | 'meeting' | 'exit';

export type Target = {
  id: string;
  kind: TargetKind;
  x: number;
  y: number;
  z: number;
  desk: DeskParts | null;
};

export type FrameInput = {
  dt: number;
  now: number;
  state: AgentState;
  scale: number;
  selected: boolean;
  asking: boolean;
  ended: boolean;
  lastTest: TestResult | null;
};

const FADING: ReadonlySet<AgentState> = new Set<AgentState>(['done', 'failed']);

export class CharacterView {
  readonly root: Container;

  private readonly parts: CharacterParts;
  private readonly overlay = new Overlay();
  private target: Target | null = null;
  private path: Point[] = [];
  private x = 0;
  private y = 0;
  private seconds = 0;
  private walkClock = 0;
  private lastState: AgentState | null = null;
  private stateStart = 0;
  private fadeStart: number | null = null;
  private seenTestTs: number | null | undefined = undefined;
  private badge: BadgeKind | null = null;
  private badgeUntil = 0;
  private interactive = true;
  private placed = false;
  private exitAt: number | null = null;
  private left = false;

  constructor(
    readonly key: string,
    look: Look,
    onSelect: (key: string) => void,
  ) {
    this.parts = buildCharacter(look);
    this.root = this.parts.root;
    this.root.addChild(this.overlay.root);
    this.root.eventMode = 'static';
    this.root.cursor = 'pointer';
    this.root.interactiveChildren = false;
    this.root.hitArea = new Rectangle(0, 0, CHAR_W, CHAR_H);
    this.root.on('pointertap', () => onSelect(key));
  }

  get position(): Point {
    return { x: this.x, y: this.y };
  }

  get moving(): boolean {
    return this.path.length > 0;
  }

  get leaving(): boolean {
    return this.target?.kind === 'exit';
  }

  get gone(): boolean {
    return this.left;
  }

  placeAt(point: Point): void {
    this.x = point.x;
    this.y = point.y;
    this.path = [];
    this.placed = true;
  }

  get talkingActive(): boolean {
    return this.lastState === 'talking' && this.seconds - this.stateStart < TALK_VISIBLE_S;
  }

  setTarget(target: Target, path: Point[]): void {
    const previous = this.target;
    this.target = target;
    if (!previous && this.placed) {
      this.path = path;
      return;
    }
    if (!previous) {
      this.x = target.x;
      this.y = target.y;
      this.path = [];
      return;
    }
    if (previous.id !== target.id) {
      this.path = path;
      return;
    }
    if (previous.x === target.x && previous.y === target.y) return;
    if (this.path.length > 0) {
      this.path[this.path.length - 1] = { x: target.x, y: target.y };
    } else {
      this.x = target.x;
      this.y = target.y;
    }
  }

  update(input: FrameInput): void {
    this.seconds += input.dt;
    const t = this.seconds;
    this.advance(input.dt);
    this.trackState(input.state);
    this.trackTest(input);
    this.resetPose();

    if (this.moving) this.poseWalking();
    else this.poseFor(input.state, t);

    this.overlay.setIcon(this.iconFor(input.state), t);
    this.overlay.setProgress(input.state === 'testing', t);
    this.overlay.setSelected(input.selected);
    this.overlay.setAsking(input.asking, t);
    this.overlay.setBadge(this.badgeUntil > t ? this.badge : null);

    this.applyDeskGlow(input.state, t);
    this.applyTransform(input);
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }

  private advance(dt: number): void {
    let budget = WALK_SPEED * dt;
    if (this.path.length > 0) this.walkClock += dt;
    while (budget > 0 && this.path.length > 0) {
      const next = this.path[0];
      const dx = next.x - this.x;
      const dy = next.y - this.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= budget) {
        this.x = next.x;
        this.y = next.y;
        budget -= distance;
        this.path.shift();
      } else {
        this.x += (dx / distance) * budget;
        this.y += (dy / distance) * budget;
        budget = 0;
      }
    }
  }

  private trackState(state: AgentState): void {
    if (state === this.lastState) return;
    this.lastState = state;
    this.stateStart = this.seconds;
    this.fadeStart = FADING.has(state) ? this.seconds : null;
  }

  private trackTest(input: FrameInput): void {
    const ts = input.lastTest?.ts ?? null;
    if (this.seenTestTs === undefined) {
      this.seenTestTs = ts;
      if (input.lastTest && input.now - input.lastTest.ts < BADGE_VISIBLE_S * 1000) this.showBadge(input.lastTest.ok);
      return;
    }
    if (ts === this.seenTestTs) return;
    this.seenTestTs = ts;
    if (input.lastTest) this.showBadge(input.lastTest.ok);
  }

  private showBadge(ok: boolean): void {
    this.badge = ok ? 'ok' : 'fail';
    this.badgeUntil = this.seconds + BADGE_VISIBLE_S;
  }

  private resetPose(): void {
    const p = this.parts;
    p.rig.position.set(0, 0);
    p.head.position.set(0, 0);
    p.legL.position.set(5, 18);
    p.legR.position.set(8, 18);
    p.armL.rotation = 0;
    p.armR.rotation = 0;
    p.cup.visible = false;
    p.folder.visible = false;
    p.flask.visible = false;
    p.stamp.visible = false;
    p.glow.visible = false;
    p.tint.visible = false;
    p.mouth.scale.y = 1;
  }

  private poseWalking(): void {
    const p = this.parts;
    const swing = Math.sin(this.walkClock * 12);
    const stepLeft = Math.floor(this.walkClock * 6) % 2 === 0;
    p.legL.y = stepLeft ? 17 : 18;
    p.legR.y = stepLeft ? 18 : 17;
    p.rig.y = stepLeft ? -1 : 0;
    p.armL.rotation = swing * 0.6;
    p.armR.rotation = -swing * 0.6;
  }

  private poseFor(state: AgentState, t: number): void {
    switch (state) {
      case 'idle':
        return this.poseIdle(t);
      case 'working':
        return this.poseWorking(t);
      case 'reading':
        return this.poseReading(t);
      case 'testing':
        return this.poseTesting(t);
      case 'checking':
        return this.poseChecking(t);
      case 'asking':
        return this.poseAsking(t);
      case 'talking':
        return this.poseTalking(t);
      case 'blocked':
        return this.poseBlocked();
      case 'failed':
        this.parts.head.y = 1;
        return;
      case 'done':
        return;
    }
  }

  private poseIdle(t: number): void {
    const p = this.parts;
    p.rig.y = Math.round(Math.sin(t * 2.2) * 0.5 + 0.5);
    const sipping = t % 6 > 5.2;
    p.armR.rotation = sipping ? 1.55 : 1.0;
    p.cup.visible = true;
    p.cup.rotation = -p.armR.rotation;
    p.steam.alpha = 0.5 + 0.5 * Math.sin(t * 3);
    p.steam.y = -Math.floor((t * 2) % 2);
  }

  private poseWorking(t: number): void {
    const p = this.parts;
    const beat = Math.floor(t * 9) % 2 === 0;
    p.armL.rotation = -0.55 + (beat ? 0.14 : -0.1);
    p.armR.rotation = 0.55 + (beat ? -0.1 : 0.14);
    p.head.y = Math.floor(t * 1.5) % 4 === 0 ? 1 : 0;
    p.glow.visible = true;
    p.glow.alpha = 0.6 + 0.4 * Math.sin(t * 5);
  }

  private poseReading(t: number): void {
    const p = this.parts;
    p.armL.rotation = -0.95;
    p.armR.rotation = 0.95;
    p.head.y = 1;
    p.folder.visible = true;
    const cycle = (t % 1.6) / 1.6;
    p.page.scale.x = cycle < 0.35 ? Math.cos((cycle / 0.35) * Math.PI) : 1;
  }

  private poseTesting(t: number): void {
    const p = this.parts;
    p.armL.rotation = -2.1 + Math.sin(t * 4) * 0.12;
    p.armR.rotation = 0.8 + Math.sin(t * 7) * 0.45;
    p.flask.visible = true;
    p.flask.rotation = -p.armL.rotation;
  }

  private poseChecking(t: number): void {
    const p = this.parts;
    p.armL.rotation = -0.5;
    p.armR.rotation = Math.floor(t * 1.8) % 2 === 0 ? 2.6 : 2.1;
    p.stamp.visible = true;
  }

  private poseAsking(t: number): void {
    this.parts.armR.rotation = Math.PI + 0.25 + Math.sin(t * 6) * 0.12;
  }

  private poseTalking(t: number): void {
    const p = this.parts;
    p.mouth.scale.y = Math.floor(t * 8) % 2 === 0 ? 2 : 1;
    p.armL.rotation = -0.9 + Math.sin(t * 6) * 0.45;
  }

  private poseBlocked(): void {
    const p = this.parts;
    p.armL.rotation = -1.2;
    p.armR.rotation = 1.2;
    p.head.y = 1;
    p.tint.visible = true;
  }

  private iconFor(state: AgentState): IconKind | null {
    switch (state) {
      case 'asking':
        return 'ask';
      case 'talking':
        return this.talkingActive ? 'talk' : null;
      case 'blocked':
        return 'lock';
      case 'checking':
        return 'stamp';
      case 'done':
        return 'check';
      case 'failed':
        return 'cross';
      default:
        return null;
    }
  }

  private applyDeskGlow(state: AgentState, t: number): void {
    const desk = this.target?.desk ?? null;
    if (!desk) return;
    const lit = !this.moving && this.target?.kind === 'desk' && state === 'working';
    desk.glow.visible = lit;
    if (lit) desk.glow.alpha = 0.6 + 0.4 * Math.sin(t * 5);
  }

  private exitAlpha(): number {
    if (this.moving) {
      this.exitAt = null;
      return 1;
    }
    if (this.exitAt === null) this.exitAt = this.seconds;
    const alpha = Math.max(0, 1 - (this.seconds - this.exitAt) / EXIT_FADE_S);
    if (alpha <= 0) this.left = true;
    return alpha;
  }

  private applyTransform(input: FrameInput): void {
    let alpha = 1;
    if (this.leaving) {
      alpha = this.exitAlpha();
    } else {
      this.exitAt = null;
      if (this.fadeStart !== null) {
        alpha = Math.max(0, 1 - (this.seconds - this.fadeStart - FADE_HOLD_S) / FADE_S);
        alpha = Math.min(1, alpha);
      }
      if (input.ended) alpha = Math.min(alpha, 0.45);
    }

    const visible = alpha > 0.01;
    this.root.visible = visible;
    this.root.alpha = alpha;
    if (visible !== this.interactive) {
      this.interactive = visible;
      this.root.eventMode = visible ? 'static' : 'none';
    }

    this.root.position.set(Math.round(this.x), Math.round(this.y));
    this.root.scale.set(input.scale);
    const settled = !this.moving && this.target !== null;
    this.root.zIndex = settled && this.target ? this.target.z : this.y;
  }
}
