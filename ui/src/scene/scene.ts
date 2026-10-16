import './scene.css';
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  Fog,
  Frustum,
  Group,
  HemisphereLight,
  Matrix4,
  PCFShadowMap,
  PMREMGenerator,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { agentName } from '../labels';
import type { OfficeHandle } from '../office/office';
import type { Store } from '../store';
import type { AgentView, FloorView } from '../types';
import { AssetLibrary, loadManifest } from './assets';
import { disposeBatchMaterials } from './batch';
import { Site } from './buildings';
import { CameraRig, OVERVIEW } from './camera';
import { Character } from './characters';
import {
  CLEAR_H,
  HALF_D,
  LEAD_ZONE,
  MEETING_REFRESH_S,
  MIN_COLS,
  MIN_COLS_ANNEX,
  PITCH,
  SLAB_T,
  STOREY_H,
  UTIL_ZONE,
} from './constants';
import { disposeProps, TalkLines } from './effects';
import { Desk, disposeDeskTemplates, type DeskVariant } from './furniture';
import {
  buildingOf,
  computeFloorPlan,
  deskCount,
  deskTarget,
  findMeetingPairs,
  labTarget,
  latestRecipient,
  meetingTarget,
  MEETING_SEATS,
  requiredCols,
  type DeskSlot,
  type FloorPlan,
  type Target,
} from './layout';
import { applyTheme as applyMaterialTheme, disposeSharedMaterials, floorStyle, hashString } from './materials';
import { Picker, pulseRings } from './picking';

type Entry = { character: Character; agent: AgentView; slot: DeskSlot | null };

type MeetingSeat = { floor: string; seat: number };

const FALLBACK_BACKGROUND = '#0b0e12';
const SUN_DIRECTION = new Vector3(0.35, 0.62, 1).normalize();
const _from = new Vector3();
const _to = new Vector3();
const _point = new Vector3();
const _matrix = new Matrix4();
const _frustum = new Frustum();

function canvasBackground(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
  return value || FALLBACK_BACKGROUND;
}

function deskKey(floor: string, slot: DeskSlot): string {
  return `${floor}|${slot.index}`;
}

function deskVariant(floor: FloorView, slot: DeskSlot): DeskVariant {
  if (slot.kind === 'lead') return floor.kind === 'direccion' ? 'executive' : 'lead';
  if (floor.kind === 'redaccion') return 'writing';
  if (floor.kind === 'mantenimiento') return 'workbench';
  return 'standard';
}

function el(tag: 'div', className: string, text = ''): HTMLDivElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

class OfficeScene {
  private readonly renderer: WebGLRenderer;
  private readonly labels = new CSS2DRenderer();
  private readonly scene = new Scene();
  private readonly site = new Site();
  private readonly actors = new Group();
  private readonly cameraRig: CameraRig;
  private readonly picker: Picker;
  private readonly talkLines = new TalkLines();
  private readonly sun = new DirectionalLight(0xfff0dc, 2.1);
  private readonly fill = new DirectionalLight(0xe6eefc, 0.95);
  private readonly hemi = new HemisphereLight(0xdfe9f5, 0x3a3430, 0.55);
  private readonly environment: WebGLRenderTarget;
  private readonly entries = new Map<string, Entry>();
  private readonly desks = new Map<string, Desk>();
  private readonly firstSeen = new Map<string, number>();
  private readonly unsubscribers: (() => void)[] = [];
  private readonly ui = el('div', 'scene-ui');
  private readonly status = el('div', 'scene-status');
  private readonly resizeObserver: ResizeObserver;
  private readonly mutationObserver: MutationObserver;
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');
  private plans = new Map<string, FloorPlan>();
  private meetings = new Map<string, MeetingSeat>();
  private seenCounter = 0;
  private mainCols = 0;
  private annexCols = 0;
  private floorKeys = '';
  private dirty = true;
  private active = false;
  private disposed = false;
  private elapsed = 0;
  private meetingTimer = 0;
  private lastTime = 0;
  private lastErrorAt = -Infinity;
  private statusText = '';

  constructor(
    private readonly host: HTMLElement,
    private readonly store: Store,
    private readonly assets: AssetLibrary,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const renderer = this.renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.domElement.className = 'scene-canvas';

    this.labels.domElement.className = 'scene-labels';
    this.status.hidden = true;
    host.replaceChildren(renderer.domElement, this.labels.domElement, this.ui);
    this.ui.append(this.status);

    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.45;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 4;
    this.fill.position.set(-0.3, 1, 0.5);
    this.scene.add(this.sun, this.sun.target, this.fill, this.hemi, this.site.root, this.actors, this.talkLines.mesh);
    this.applyTheme();

    this.cameraRig = new CameraRig(this.ui, renderer.domElement, {
      onFloor: (slug) => this.focusFloor(slug),
      onOverview: () => this.focusOverview(),
      onStopFollow: () => this.cameraRig.stopFollow(),
    });
    this.picker = new Picker(renderer.domElement, this.cameraRig.camera, () => this.pickTargets(), {
      select: (key) => this.store.select(key),
      follow: (key) => this.follow(key),
    });

    this.unsubscribers.push(
      store.watch(['agents', 'floors', 'tick'], () => {
        this.dirty = true;
      }),
      store.watch(['messages'], () => {
        this.meetingTimer = MEETING_REFRESH_S;
      }),
      store.watch(['selection'], () => this.onSelection()),
    );

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.mutationObserver = new MutationObserver(() => {
      if (!this.host.isConnected) this.dispose();
    });
    this.mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('keydown', this.onKey);
    this.media.addEventListener('change', this.onThemeChange);
    this.resize();
  }

  setActive(active: boolean): void {
    if (this.disposed) return;
    this.active = active;
    if (active) {
      this.dirty = true;
      this.lastTime = 0;
      this.resize();
      this.renderer.setAnimationLoop(this.frame);
    } else {
      this.renderer.setAnimationLoop(null);
    }
  }

  private readonly frame = (time: number): void => {
    if (this.disposed) return;
    const dt = this.lastTime === 0 ? 1 / 60 : Math.min(0.1, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    this.elapsed += dt;
    try {
      this.step(dt);
    } catch (error) {
      if (this.elapsed - this.lastErrorAt > 5) {
        this.lastErrorAt = this.elapsed;
        console.error('Agent Office 3D:', error);
      }
    }
  };

  private step(dt: number): void {
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
    const followed = this.cameraRig.following;
    const entry = followed === null ? undefined : this.entries.get(followed);
    if (followed !== null && !entry) this.cameraRig.stopFollow();
    let followPoint: Vector3 | null = null;
    if (entry && entry.character.root.visible) {
      followPoint = _point.copy(entry.character.root.position);
      followPoint.y += 1.1;
      this.cameraRig.setFollowName(agentName(entry.agent));
    }
    this.cameraRig.update(dt, followPoint);
    this.cameraRig.setActive(this.floorAt(this.cameraRig.target));
    this.picker.update();
    this.renderer.render(this.scene, this.cameraRig.camera);
    this.labels.render(this.scene, this.cameraRig.camera);
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    if (this.host.clientWidth === 0 || this.host.clientHeight === 0) return;
    this.renderer.setSize(width, height);
    this.labels.setSize(width, height);
    this.cameraRig.resize(width, height);
  }

  private sync(): void {
    const floors = this.store.floorList();
    const agents = this.store.visibleAgents();
    for (const agent of agents) {
      if (!this.firstSeen.has(agent.key)) this.firstSeen.set(agent.key, this.seenCounter++);
    }
    const order = (key: string): number => this.firstSeen.get(key) ?? 0;
    const byFloor = new Map<string, AgentView[]>();
    for (const agent of agents) {
      const list = byFloor.get(agent.floor) ?? [];
      list.push(agent);
      byFloor.set(agent.floor, list);
    }

    const floorKeys = floors.map((floor) => `${floor.slug}|${buildingOf(floor)}`).join(',');
    if (floorKeys !== this.floorKeys) {
      this.floorKeys = floorKeys;
      this.mainCols = 0;
      this.annexCols = 0;
    }
    let mainNeed = MIN_COLS;
    let annexNeed = MIN_COLS_ANNEX;
    for (const floor of floors) {
      const desks = deskCount(floor, byFloor.get(floor.slug) ?? [], order);
      if (buildingOf(floor) === 'main') mainNeed = Math.max(mainNeed, requiredCols(desks, MIN_COLS));
      else annexNeed = Math.max(annexNeed, requiredCols(desks, MIN_COLS_ANNEX));
    }
    this.mainCols = Math.max(this.mainCols, mainNeed);
    this.annexCols = Math.max(this.annexCols, annexNeed);
    const mainWidth = LEAD_ZONE + this.mainCols * PITCH + UTIL_ZONE;
    const annexWidth = LEAD_ZONE + this.annexCols * PITCH + UTIL_ZONE;
    if (this.site.update(floors, mainWidth, annexWidth)) {
      this.cameraRig.setBounds(this.site.bounds);
      this.fitShadows();
      this.reframe();
    }
    this.cameraRig.setFloors(
      this.site.floors.map((room) => ({
        slug: room.slug,
        label: room.view.label,
        accent: room.style.accentCss,
        annex: room.building === 'annex',
      })),
    );

    const plans = new Map<string, FloorPlan>();
    for (const floor of floors) {
      const room = this.site.room(floor.slug);
      if (!room) continue;
      const cols = buildingOf(floor) === 'main' ? this.mainCols : this.annexCols;
      plans.set(floor.slug, computeFloorPlan(floor, byFloor.get(floor.slug) ?? [], room.width, cols, order));
    }
    this.plans = plans;
    this.syncDesks();
    this.syncEntries(agents);
    this.refreshMeetings();
  }

  private syncDesks(): void {
    const wanted = new Set<string>();
    for (const plan of this.plans.values()) {
      const room = this.site.room(plan.slug);
      if (!room) continue;
      const muted = floorStyle(plan.view).muted;
      const slots = plan.leadSlot ? [plan.leadSlot, ...plan.slots] : plan.slots;
      for (const slot of slots) {
        const key = deskKey(plan.slug, slot);
        wanted.add(key);
        const variant = deskVariant(plan.view, slot);
        let desk = this.desks.get(key);
        if (desk && (desk.variant !== variant || desk.muted !== muted || desk.group.parent !== room.group)) {
          desk.dispose();
          desk = undefined;
        }
        if (!desk) {
          desk = new Desk(variant, muted, hashString(key));
          room.group.add(desk.group);
          this.desks.set(key, desk);
        }
        desk.place(slot.x, slot.z, slot.scale);
      }
    }
    for (const [key, desk] of this.desks) {
      if (wanted.has(key)) continue;
      desk.dispose();
      this.desks.delete(key);
    }
  }

  private syncEntries(agents: readonly AgentView[]): void {
    const present = new Set<string>();
    for (const agent of agents) {
      const plan = this.plans.get(agent.floor);
      if (!plan) continue;
      present.add(agent.key);
      let entry = this.entries.get(agent.key);
      if (!entry) {
        const character = new Character(
          agent.key,
          this.assets,
          (key) => this.store.select(key),
          (key) => this.follow(key),
        );
        this.actors.add(character.root);
        entry = { character, agent, slot: null };
        this.entries.set(agent.key, entry);
      }
      entry.agent = agent;
      entry.character.setLook({ roleKind: agent.roleKind, muted: floorStyle(plan.view).muted });
      entry.slot = plan.assignment.get(agent.key) ?? null;
      entry.character.desk = entry.slot ? (this.desks.get(deskKey(agent.floor, entry.slot)) ?? null) : null;
    }
    for (const [key, entry] of this.entries) {
      if (present.has(key)) continue;
      entry.character.dispose();
      this.entries.delete(key);
      if (this.cameraRig.following === key) this.cameraRig.stopFollow();
    }
  }

  private pickTargets(): Character['proxy'][] {
    const targets: Character['proxy'][] = [];
    for (const entry of this.entries.values()) {
      if (entry.character.pickable && entry.character.root.visible) targets.push(entry.character.proxy);
    }
    return targets;
  }

  private canMeet(agent: AgentView): boolean {
    if (agent.endedAt !== null || !this.entries.has(agent.key)) return false;
    const state = this.store.shownState(agent);
    return state !== 'done' && state !== 'failed' && state !== 'testing';
  }

  private hostFloor(a: AgentView, b: AgentView): string {
    if (a.floor === b.floor) return a.floor;
    if (this.site.room(a.floor)?.view.kind === 'direccion') return b.floor;
    if (this.site.room(b.floor)?.view.kind === 'direccion') return a.floor;
    return a.key < b.key ? a.floor : b.floor;
  }

  private refreshMeetings(): void {
    const seats = new Map<string, MeetingSeat>();
    const used = new Map<string, number>();
    for (const pair of findMeetingPairs(this.store.messages, this.store.now())) {
      const a = this.store.agents.get(pair.a);
      const b = this.store.agents.get(pair.b);
      if (!a || !b || !this.canMeet(a) || !this.canMeet(b)) continue;
      if (seats.has(a.key) || seats.has(b.key)) continue;
      const floor = this.hostFloor(a, b);
      if (!this.plans.has(floor)) continue;
      const count = used.get(floor) ?? 0;
      used.set(floor, count + 1);
      seats.set(a.key, { floor, seat: (count * 2) % MEETING_SEATS });
      seats.set(b.key, { floor, seat: (count * 2 + 1) % MEETING_SEATS });
    }
    this.meetings = seats;
    const labUse = new Map<string, number>();
    for (const [key, entry] of this.entries) {
      const agent = this.store.agents.get(key) ?? entry.agent;
      const target = this.resolveTarget(agent, entry, labUse);
      if (target) entry.character.setTarget(target, this.site.nav);
    }
  }

  private resolveTarget(agent: AgentView, entry: Entry, labUse: Map<string, number>): Target | null {
    const room = this.site.room(agent.floor);
    if (!room) return null;
    const state = this.store.shownState(agent);
    const leaving = state === 'done' || state === 'failed' || agent.endedAt !== null;
    if (!leaving && state === 'testing') {
      const index = labUse.get(agent.floor) ?? 0;
      labUse.set(agent.floor, index + 1);
      return labTarget(agent.floor, room.width, index);
    }
    const meeting = leaving ? undefined : this.meetings.get(agent.key);
    if (meeting) {
      const host = this.site.room(meeting.floor);
      if (host) return meetingTarget(meeting.floor, host.width, meeting.seat);
    }
    return entry.slot ? deskTarget(agent.floor, entry.slot) : null;
  }

  private animate(dt: number): void {
    const now = this.store.now();
    const camera = this.cameraRig.camera.position;
    const following = this.cameraRig.following;
    const testing = new Set<string>();
    const claimed = new Set<Desk>();
    const resolve = (floor: string): Vector3 | null => this.site.origin(floor);
    let loading = false;
    for (const [key, entry] of this.entries) {
      const agent = this.store.agents.get(key) ?? entry.agent;
      const state = this.store.shownState(agent);
      if (state === 'testing') testing.add(agent.floor);
      entry.character.update(
        {
          dt,
          now,
          state,
          scale: entry.slot?.scale ?? 1,
          selected: key === this.store.selectedKey,
          pending: this.store.questionFor(key) !== undefined,
          ended: agent.endedAt !== null,
          lastTest: agent.lastTest,
          name: agentName(agent),
          following: following === key,
          camera,
        },
        resolve,
      );
      if (entry.character.desk) claimed.add(entry.character.desk);
      if (!entry.character.ready) loading = true;
    }
    for (const desk of this.desks.values()) {
      if (claimed.has(desk)) continue;
      desk.setScreen(0);
      desk.setSeated(false);
    }
    this.site.tick(this.elapsed, testing);
    pulseRings(this.elapsed);
    this.drawTalkLines();
    this.setStatus(loading ? 'Cargando personajes…' : this.site.floors.length === 0 ? 'Esperando a que llegue alguien a la oficina…' : '');
  }

  private drawTalkLines(): void {
    this.talkLines.begin();
    for (const [key, entry] of this.entries) {
      if (!entry.character.talkingActive || !entry.character.root.visible) continue;
      const recipient = latestRecipient(this.store.messages, key);
      const other = recipient === null ? undefined : this.entries.get(recipient);
      if (!other || other === entry || !other.character.root.visible) continue;
      this.talkLines.add(entry.character.headPoint(_from), other.character.headPoint(_to), this.elapsed);
    }
    this.talkLines.end();
  }

  private setStatus(text: string): void {
    if (text === this.statusText) return;
    this.statusText = text;
    this.status.textContent = text;
    this.status.hidden = text === '';
  }

  private floorBox(slug: string): Box3 | null {
    const room = this.site.room(slug);
    if (!room) return null;
    const { origin, width } = room;
    return new Box3(
      new Vector3(origin.x - width / 2 - 0.3, origin.y - SLAB_T, -HALF_D),
      new Vector3(origin.x + width / 2 + 0.3, origin.y + CLEAR_H, HALF_D),
    );
  }

  private focusFloor(slug: string): void {
    const box = this.floorBox(slug);
    if (!box) return;
    this.cameraRig.stopFollow();
    this.cameraRig.focusBox(box, { azimuth: 0.16, elevation: 0.16, margin: 1.02 });
    this.cameraRig.preset = slug;
  }

  private focusOverview(): void {
    this.cameraRig.stopFollow();
    this.cameraRig.focusBox(this.site.bounds);
    this.cameraRig.preset = OVERVIEW;
  }

  private reframe(): void {
    const preset = this.cameraRig.preset;
    if (preset === OVERVIEW) this.focusOverview();
    else if (preset !== null && this.site.room(preset)) this.focusFloor(preset);
  }

  private floorAt(point: Vector3): string | null {
    for (const room of this.site.floors) {
      const { origin, width } = room;
      if (point.x < origin.x - width / 2 - 1.5 || point.x > origin.x + width / 2 + 1.5) continue;
      if (point.y >= origin.y - 0.6 && point.y < origin.y + STOREY_H - 0.6) return room.slug;
    }
    return null;
  }

  private follow(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.cameraRig.follow(key, agentName(entry.agent));
  }

  private onSelection(): void {
    const key = this.store.selectedKey;
    const entry = key === null ? undefined : this.entries.get(key);
    if (!entry || !entry.character.root.visible || this.cameraRig.following !== null) return;
    const camera = this.cameraRig.camera;
    camera.updateMatrixWorld();
    _matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_matrix);
    entry.character.headPoint(_point);
    if (_frustum.containsPoint(_point) && camera.position.distanceTo(_point) < 45) return;
    this.focusFloor(entry.character.floor || entry.agent.floor);
  }

  private fitShadows(): void {
    const box = this.site.bounds;
    const center = box.getCenter(new Vector3());
    const radius = box.getSize(new Vector3()).length() / 2 + 2;
    this.sun.position.copy(center).addScaledVector(SUN_DIRECTION, radius * 2);
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();
    const shadow = this.sun.shadow.camera;
    shadow.left = -radius;
    shadow.right = radius;
    shadow.top = radius;
    shadow.bottom = -radius;
    shadow.near = 0.5;
    shadow.far = radius * 4.5;
    shadow.updateProjectionMatrix();
    this.fill.position.copy(center).add(new Vector3(-0.3, 1, 0.5).multiplyScalar(radius));
    this.fill.target.position.copy(center);
    this.fill.target.updateMatrixWorld();
    const far = Math.max(160, radius * 7);
    this.scene.fog = new Fog(this.scene.fog instanceof Fog ? this.scene.fog.color : new Color(canvasBackground()), far * 0.55, far);
  }

  private applyTheme(): void {
    const background = new Color(canvasBackground());
    this.scene.background = background;
    if (this.scene.fog instanceof Fog) this.scene.fog.color.copy(background);
    else this.scene.fog = new Fog(background.clone(), 90, 220);
    applyMaterialTheme(this.media.matches);
    this.site.retheme();
  }

  private readonly onThemeChange = (): void => {
    this.applyTheme();
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.active || this.cameraRig.following === null) return;
    this.cameraRig.stopFollow();
  };

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.resizeObserver.disconnect();
    this.mutationObserver.disconnect();
    window.removeEventListener('keydown', this.onKey);
    this.media.removeEventListener('change', this.onThemeChange);
    this.picker.dispose();
    this.cameraRig.dispose();
    for (const entry of this.entries.values()) entry.character.dispose();
    this.entries.clear();
    for (const desk of this.desks.values()) desk.dispose();
    this.desks.clear();
    this.talkLines.dispose();
    this.site.dispose();
    this.assets.dispose();
    disposeProps();
    disposeDeskTemplates();
    disposeSharedMaterials();
    disposeBatchMaterials();
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
    this.ui.remove();
  }
}

export async function mountScene(host: HTMLElement, store: Store): Promise<OfficeHandle> {
  const base = `${import.meta.env.BASE_URL}assets/characters/`;
  const manifest = await loadManifest(`${base}manifest.json`);
  const office = new OfficeScene(host, store, new AssetLibrary(base, manifest));
  return { setActive: (active) => office.setActive(active) };
}
