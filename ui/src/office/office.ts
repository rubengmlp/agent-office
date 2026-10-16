import { Application, Container, Graphics } from 'pixi.js';
import type { Store } from '../store';
import type { AgentView } from '../types';
import { CharacterView, type Target } from './character-view';
import {
  DESK_FEET_Y,
  DESK_SEAT_X,
  FLOOR_GAP,
  LEAD_SEAT_X,
  MEETING_REFRESH_S,
  MIN_WIDTH,
  SCALE,
  SLOT_W,
} from './constants';
import { FloorScene } from './floor-scene';
import { buildDesk, type DeskParts } from './furniture';
import { computeFloorLayout, type DeskSlot, type Point } from './layout';
import { findMeetingPairs } from './meetings';
import { hashString } from './palette';

type Entry = {
  view: CharacterView;
  look: string;
  ownDesk: DeskParts | null;
  desk: DeskParts | null;
  slot: DeskSlot | null;
};

type MeetingSeat = { floor: string; seat: number };

const TALK_LINE_COLOR = 0xf472b6;
const HEAD_HEIGHT = 20;
const FALLBACK_BACKGROUND = '#0b0e12';

export type OfficeHandle = { setActive(active: boolean): void };

function canvasBackground(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
  return value || FALLBACK_BACKGROUND;
}

function dashedLine(g: Graphics, from: Point, to: Point, phase: number, color: number): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return;
  const ux = dx / length;
  const uy = dy / length;
  const dash = 4;
  const period = dash + 3;
  let position = -((phase * 12) % period);
  while (position < length) {
    const start = Math.max(0, position);
    const end = Math.min(length, position + dash);
    if (end > start) g.moveTo(from.x + ux * start, from.y + uy * start).lineTo(from.x + ux * end, from.y + uy * end);
    position += period;
  }
  g.stroke({ width: 1, color, alpha: 0.9 });
}

class OfficeView {
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly backgrounds = new Container();
  private readonly actors = new Container();
  private readonly foregrounds = new Container();
  private readonly lines = new Graphics();
  private readonly scrollbar = new Graphics();
  private readonly scenes = new Map<string, FloorScene>();
  private readonly entries = new Map<string, Entry>();
  private readonly firstSeen = new Map<string, number>();
  private sceneOrder: FloorScene[] = [];
  private meetings = new Map<string, MeetingSeat>();
  private seenCounter = 0;
  private scrollY = 0;
  private worldHeight = 0;
  private logicalWidth = MIN_WIDTH;
  private elapsed = 0;
  private meetingTimer = 0;
  private dirty = true;

  constructor(private readonly store: Store) {}

  async mount(host: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: host,
      background: canvasBackground(),
      antialias: false,
      resolution: window.devicePixelRatio,
      autoDensity: true,
    });
    host.appendChild(this.app.canvas);

    this.actors.sortableChildren = true;
    this.world.scale.set(SCALE);
    this.world.addChild(this.backgrounds, this.actors, this.foregrounds, this.lines);
    this.app.stage.addChild(this.world, this.scrollbar);

    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => {
        this.app.renderer.background.color = canvasBackground();
      });

    this.app.ticker.add((ticker) => this.update(ticker.deltaMS / 1000));
    this.store.watch(['agents', 'floors', 'tick', 'lang'], () => {
      this.dirty = true;
    });
    this.store.watch(['selection'], () => this.focusSelected());
  }

  setActive(active: boolean): void {
    if (active) {
      this.dirty = true;
      this.app.ticker.start();
    } else {
      this.app.ticker.stop();
    }
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.app.screen.height : 1;
    this.scrollY += (event.deltaY * unit) / SCALE;
    this.clampScroll();
  };

  private update(dt: number): void {
    this.elapsed += dt;
    const width = Math.max(MIN_WIDTH, Math.floor(this.app.screen.width / SCALE));
    if (width !== this.logicalWidth) {
      this.logicalWidth = width;
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = false;
      this.sync();
    }
    this.meetingTimer += dt;
    if (this.meetingTimer >= MEETING_REFRESH_S) {
      this.meetingTimer = 0;
      this.refreshMeetings();
    }
    this.animate(dt);
    this.drawLines();
    this.applyScroll();
  }

  private sync(): void {
    const floors = this.store.floorList();
    const agents = this.store.visibleAgents();
    for (const agent of agents) {
      if (!this.firstSeen.has(agent.key)) this.firstSeen.set(agent.key, this.seenCounter++);
    }
    const byFloor = new Map<string, AgentView[]>();
    for (const agent of agents) {
      const list = byFloor.get(agent.floor) ?? [];
      list.push(agent);
      byFloor.set(agent.floor, list);
    }

    const order = (key: string): number => this.firstSeen.get(key) ?? 0;
    const live = new Set<string>();
    this.sceneOrder = [];
    let top = 0;
    for (const floor of floors) {
      const layout = computeFloorLayout(floor, byFloor.get(floor.slug) ?? [], this.logicalWidth, order);
      let scene = this.scenes.get(floor.slug);
      if (scene) {
        scene.update(floor, layout, top);
      } else {
        scene = new FloorScene(this.actors, floor, layout, top);
        this.scenes.set(floor.slug, scene);
        this.backgrounds.addChild(scene.background);
        this.foregrounds.addChild(scene.foreground);
      }
      live.add(floor.slug);
      this.sceneOrder.push(scene);
      top += layout.height + FLOOR_GAP;
    }
    for (const [slug, scene] of this.scenes) {
      if (live.has(slug)) continue;
      scene.destroy();
      this.scenes.delete(slug);
    }
    this.worldHeight = Math.max(0, top - FLOOR_GAP);

    this.syncEntries(agents);
    this.refreshMeetings();
    this.clampScroll();
  }

  private syncEntries(agents: readonly AgentView[]): void {
    const present = new Set<string>();
    for (const agent of agents) {
      const scene = this.scenes.get(agent.floor);
      if (!scene) continue;
      present.add(agent.key);
      const saturation = scene.view.kind === 'observed' ? 0.4 : 1;
      const look = `${agent.roleKind}|${saturation}`;
      let entry = this.entries.get(agent.key);
      if (entry && entry.look !== look) {
        entry.view.destroy();
        entry.view = this.createView(agent, saturation);
        entry.look = look;
      } else if (!entry) {
        entry = { view: this.createView(agent, saturation), look, ownDesk: null, desk: null, slot: null };
        this.entries.set(agent.key, entry);
      }

      const slot = scene.layout.desks.get(agent.key) ?? null;
      entry.slot = slot;
      if (slot?.lead) {
        this.releaseDesk(entry);
        entry.desk = scene.leadDeskParts;
      } else if (slot) {
        if (!entry.ownDesk) {
          entry.ownDesk = buildDesk(SLOT_W, false);
          this.actors.addChild(entry.ownDesk.back, entry.ownDesk.front);
        }
        scene.placeDesk(entry.ownDesk, slot);
        entry.desk = entry.ownDesk;
      } else {
        this.releaseDesk(entry);
        entry.desk = null;
      }
    }

    for (const [key, entry] of this.entries) {
      if (present.has(key)) continue;
      this.releaseDesk(entry);
      entry.view.destroy();
      this.entries.delete(key);
    }
  }

  private createView(agent: AgentView, saturation: number): CharacterView {
    const look = { roleKind: agent.roleKind, seed: hashString(agent.key), saturation };
    const view = new CharacterView(agent.key, look, (key) => this.store.select(key));
    this.actors.addChild(view.root);
    return view;
  }

  private releaseDesk(entry: Entry): void {
    if (!entry.ownDesk) return;
    entry.ownDesk.back.destroy();
    entry.ownDesk.front.destroy({ children: true });
    entry.ownDesk = null;
  }

  private refreshMeetings(): void {
    this.meetings = this.computeMeetings();
    this.assignTargets();
  }

  private canMeet(agent: AgentView): boolean {
    if (agent.endedAt !== null || !this.entries.has(agent.key)) return false;
    const state = this.store.shownState(agent);
    return state !== 'done' && state !== 'failed' && state !== 'testing';
  }

  private hostFloor(a: AgentView, b: AgentView): string {
    if (a.floor === b.floor) return a.floor;
    if (this.scenes.get(a.floor)?.view.kind === 'direccion') return b.floor;
    if (this.scenes.get(b.floor)?.view.kind === 'direccion') return a.floor;
    return a.key < b.key ? a.floor : b.floor;
  }

  private computeMeetings(): Map<string, MeetingSeat> {
    const seats = new Map<string, MeetingSeat>();
    const usedPerFloor = new Map<string, number>();
    for (const pair of findMeetingPairs(this.store.messages, this.store.now())) {
      const a = this.store.agents.get(pair.a);
      const b = this.store.agents.get(pair.b);
      if (!a || !b || !this.canMeet(a) || !this.canMeet(b)) continue;
      if (seats.has(a.key) || seats.has(b.key)) continue;
      const floor = this.hostFloor(a, b);
      const scene = this.scenes.get(floor);
      if (!scene) continue;
      const used = usedPerFloor.get(floor) ?? 0;
      usedPerFloor.set(floor, used + 1);
      const count = scene.layout.seats.length;
      seats.set(a.key, { floor, seat: (used * 2) % count });
      seats.set(b.key, { floor, seat: (used * 2 + 1) % count });
    }
    return seats;
  }

  private assignTargets(): void {
    const labUse = new Map<string, number>();
    for (const [key, entry] of this.entries) {
      const agent = this.store.agents.get(key);
      const scene = agent ? this.scenes.get(agent.floor) : undefined;
      if (!agent || !scene) continue;
      const resolved = this.resolveTarget(agent, entry, scene, labUse);
      if (!resolved) continue;
      entry.view.setTarget(resolved.target, this.buildPath(entry.view.position, resolved.target, resolved.scene));
    }
  }

  private resolveTarget(
    agent: AgentView,
    entry: Entry,
    scene: FloorScene,
    labUse: Map<string, number>,
  ): { target: Target; scene: FloorScene } | null {
    const state = this.store.shownState(agent);
    const leaving = state === 'done' || state === 'failed' || agent.endedAt !== null;

    if (!leaving && state === 'testing') {
      const index = labUse.get(scene.slug) ?? 0;
      labUse.set(scene.slug, index + 1);
      const stands = scene.layout.labStands;
      const world = scene.toWorld(stands[index % stands.length]);
      const x = world.x + Math.floor(index / stands.length) * 4;
      return { scene, target: { id: `lab:${scene.slug}:${index}`, kind: 'lab', x, y: world.y, z: world.y, desk: entry.desk } };
    }

    const meeting = leaving ? undefined : this.meetings.get(agent.key);
    const host = meeting ? this.scenes.get(meeting.floor) : undefined;
    if (meeting && host) {
      const seat = host.layout.seats[meeting.seat];
      const world = host.toWorld(seat);
      const z = seat.behind ? host.tableBaseZ - 1 : world.y;
      return {
        scene: host,
        target: { id: `meet:${host.slug}:${meeting.seat}`, kind: 'meeting', x: world.x, y: world.y, z, desk: entry.desk },
      };
    }

    const slot = entry.slot;
    if (!slot || !entry.desk) return null;
    const seatX = slot.lead ? LEAD_SEAT_X : DESK_SEAT_X;
    return {
      scene,
      target: {
        id: `desk:${agent.key}`,
        kind: 'desk',
        x: slot.x + seatX * slot.scale,
        y: scene.top + slot.y + DESK_FEET_Y * slot.scale,
        z: scene.deskBaseZ(slot) - 1,
        desk: entry.desk,
      },
    };
  }

  private sceneAt(y: number): FloorScene | undefined {
    for (const scene of this.sceneOrder) {
      if (y >= scene.top && y < scene.top + scene.layout.height + FLOOR_GAP) return scene;
    }
    return this.sceneOrder[this.sceneOrder.length - 1];
  }

  private buildPath(from: Point, target: Target, targetScene: FloorScene): Point[] {
    const goal = { x: target.x, y: target.y };
    const origin = this.sceneAt(from.y);
    if (!origin || origin === targetScene) return [goal];
    const gate = (scene: FloorScene): Point => ({
      x: scene.layout.lift.x + scene.layout.lift.w / 2,
      y: scene.top + scene.layout.walkY,
    });
    return [gate(origin), gate(targetScene), goal];
  }

  private animate(dt: number): void {
    const now = this.store.now();
    const asking = new Set(this.store.questions.map((question) => question.agentKey));
    const testingFloors = new Set<string>();
    for (const [key, entry] of this.entries) {
      const agent = this.store.agents.get(key);
      if (!agent) continue;
      const state = this.store.shownState(agent);
      if (state === 'testing') testingFloors.add(agent.floor);
      entry.view.update({
        dt,
        now,
        state,
        scale: entry.slot?.scale ?? 1,
        selected: key === this.store.selectedKey,
        asking: asking.has(key),
        ended: agent.endedAt !== null,
        lastTest: agent.lastTest,
      });
    }
    for (const scene of this.sceneOrder) scene.tick(this.elapsed, testingFloors.has(scene.slug));
  }

  private latestRecipient(fromKey: string): string | null {
    const { messages } = this.store;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].fromKey === fromKey) return messages[index].toKey;
    }
    return null;
  }

  private headPoint(entry: Entry): Point {
    const { x, y } = entry.view.position;
    return { x, y: y - HEAD_HEIGHT * (entry.slot?.scale ?? 1) };
  }

  private drawLines(): void {
    const g = this.lines;
    g.clear();
    for (const [key, entry] of this.entries) {
      if (!entry.view.talkingActive) continue;
      const recipient = this.latestRecipient(key);
      const other = recipient === null ? undefined : this.entries.get(recipient);
      if (!other) continue;
      dashedLine(g, this.headPoint(entry), this.headPoint(other), this.elapsed, TALK_LINE_COLOR);
    }
  }

  private maxScroll(): number {
    return Math.max(0, this.worldHeight - this.app.screen.height / SCALE);
  }

  private clampScroll(): void {
    this.scrollY = Math.min(Math.max(0, this.scrollY), this.maxScroll());
  }

  private applyScroll(): void {
    this.clampScroll();
    this.world.position.set(0, -Math.round(this.scrollY) * SCALE);
    const g = this.scrollbar;
    g.clear();
    const max = this.maxScroll();
    if (max <= 0) return;
    const { width, height } = this.app.screen;
    const track = height - 8;
    const thumb = Math.max(24, (track * (height / SCALE)) / this.worldHeight);
    const thumbY = 4 + (track - thumb) * (this.scrollY / max);
    g.rect(width - 8, 4, 4, track).fill({ color: 0xffffff, alpha: 0.08 });
    g.rect(width - 8, thumbY, 4, thumb).fill({ color: 0xffffff, alpha: 0.35 });
  }

  private focusSelected(): void {
    const key = this.store.selectedKey;
    const entry = key === null ? undefined : this.entries.get(key);
    if (!entry) return;
    const { y } = entry.view.position;
    const viewport = this.app.screen.height / SCALE;
    if (y - 30 < this.scrollY || y + 12 > this.scrollY + viewport) {
      this.scrollY = y - viewport / 2;
      this.clampScroll();
    }
  }
}

export async function mountOffice(host: HTMLElement, store: Store): Promise<OfficeHandle> {
  const office = new OfficeView(store);
  await office.mount(host);
  return { setActive: (active) => office.setActive(active) };
}
