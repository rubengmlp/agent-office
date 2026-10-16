import { Box3, CanvasTexture, Group, Mesh, PlaneGeometry, SRGBColorSpace, Vector3, type MeshStandardMaterial } from 'three';
import { currentLang, t } from '../i18n';
import { floorLabel, stackLabel } from '../labels';
import type { FloorView } from '../types';
import { Batcher, disposeMeshes, transform } from './batch';
import {
  AISLE_Z,
  CLEAR_H,
  COFFEE_DX,
  COFFEE_Z,
  CORRIDOR_LEN,
  DEPTH,
  DOOR_H,
  DOOR_HALF,
  GARDEN_FAR_Z,
  HALF_D,
  LAB_BENCH_DX,
  LAB_BENCH_LEN,
  LEAD_DESK_DX,
  LEAD_ZONE,
  LIFT_GAP,
  LIFT_W,
  MEET_D,
  MEET_DX,
  MEET_W,
  MEET_Z,
  OFFICE_PARTITION_DX,
  PITCH,
  PLINTH_H,
  SIDEWALK_Y,
  SLAB_T,
  STOREY_H,
  TOWER_DOOR_W,
  UTIL_ZONE,
  WALL_T,
} from './constants';
import {
  bookshelf,
  coffeeCorner,
  credenza,
  floorLamp,
  glassOffice,
  labBench,
  labScreen,
  meetingTable,
  pegboard,
  plant,
  sofa,
  toolShelf,
  UNIT_PLANE,
  whiteboard,
} from './furniture';
import { buildingOf, STREET, streetNav, type BuildingId, type FloorNav, type Nav } from './layout';
import { buildingKit, floorStyle, furnitureKit, hashString, std, type FloorStyle } from './materials';

type Opening = { x0: number; x1: number };

function subtitleFor(view: FloorView): string {
  const stack = stackLabel(view.stack);
  switch (view.kind) {
    case 'direccion':
      return t('scene.sub.direccion');
    case 'redaccion':
      return t('scene.sign.redaccion');
    case 'mantenimiento':
      return t('scene.sub.mantenimiento');
    case 'observed':
      return t('scene.sub.observed', { stack });
    default:
      return stack;
  }
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export function signTexture(title: string, subtitle: string, accent: string, width = 1024, height = 224): CanvasTexture {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const ctx = element.getContext('2d');
  if (!ctx) throw new Error(t('scene.noCanvas'));
  ctx.fillStyle = '#121820';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 22, height);
  ctx.fillRect(22, height - 8, width - 22, 8);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f4f7fb';
  ctx.font = `700 ${Math.round(height * 0.42)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(fitText(ctx, title, width - 90), 56, height * 0.55);
  ctx.fillStyle = '#9fb0c3';
  ctx.font = `500 ${Math.round(height * 0.2)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(fitText(ctx, subtitle, width - 90), 58, height * 0.85);
  const texture = new CanvasTexture(element);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

type Owned = { mesh: Mesh; material: MeshStandardMaterial; texture: CanvasTexture | null };

function signMesh(texture: CanvasTexture, width: number, height: number): Owned {
  const material = std(0xffffff, 0.45, 0, { map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.45 });
  const mesh = new Mesh(UNIT_PLANE, material);
  mesh.scale.set(width, height, 1);
  return { mesh, material, texture };
}

function worldUvPlane(width: number, depth: number, tile: number): PlaneGeometry {
  const geometry = new PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let index = 0; index < position.count; index += 1) {
    uv.setXY(index, position.getX(index) / tile, -position.getZ(index) / tile);
  }
  uv.needsUpdate = true;
  return geometry;
}

function wallAlongX(b: Batcher, style: FloorStyle, width: number, openings: readonly Opening[], y0: number, y1: number): void {
  const kit = buildingKit();
  const layers: { material: MeshStandardMaterial; thick: number; z: number }[] = [
    { material: style.paint, thick: 0.05, z: -HALF_D - 0.025 },
    { material: kit.cladding, thick: WALL_T - 0.05, z: -HALF_D - 0.05 - (WALL_T - 0.05) / 2 },
  ];
  const left = -width / 2 - WALL_T;
  const right = width / 2 + WALL_T;
  for (const layer of layers) {
    const span = right - left;
    b.box(layer.material, span, y0, layer.thick, (left + right) / 2, y0 / 2, layer.z);
    b.box(layer.material, span, CLEAR_H - y1, layer.thick, (left + right) / 2, (y1 + CLEAR_H) / 2, layer.z);
    let cursor = left;
    for (const opening of [...openings, { x0: right, x1: right }]) {
      if (opening.x0 > cursor + 0.001) b.box(layer.material, opening.x0 - cursor, y1 - y0, layer.thick, (cursor + opening.x0) / 2, (y0 + y1) / 2, layer.z);
      cursor = opening.x1;
    }
  }
  for (const opening of openings) {
    const cx = (opening.x0 + opening.x1) / 2;
    const w = opening.x1 - opening.x0;
    const z = -HALF_D - WALL_T / 2;
    b.box(kit.windowGlass, w, y1 - y0, 0.02, cx, (y0 + y1) / 2, z, { cast: false, receive: false });
    b.box(kit.frame, w, 0.05, WALL_T + 0.02, cx, y0 + 0.025, z, { cast: false });
    b.box(kit.frame, w, 0.05, WALL_T + 0.02, cx, y1 - 0.025, z, { cast: false });
    b.box(kit.frame, 0.05, y1 - y0, WALL_T + 0.02, opening.x0 + 0.025, (y0 + y1) / 2, z, { cast: false });
    b.box(kit.frame, 0.05, y1 - y0, WALL_T + 0.02, opening.x1 - 0.025, (y0 + y1) / 2, z, { cast: false });
    b.box(kit.frame, 0.04, y1 - y0, 0.06, cx, (y0 + y1) / 2, z, { cast: false });
    b.box(kit.frame, w + 0.1, 0.04, 0.14, cx, y0 - 0.02, -HALF_D + 0.07, { cast: false });
  }
  b.box(kit.skirting, width, 0.08, 0.015, 0, 0.04, -HALF_D + 0.008, { cast: false });
}

function sideWall(b: Batcher, style: FloorStyle, width: number, side: -1 | 1, door: boolean): void {
  const kit = buildingKit();
  const z0 = -HALF_D - WALL_T;
  const z1 = HALF_D;
  const doorFrom = AISLE_Z - DOOR_HALF;
  const doorTo = AISLE_Z + DOOR_HALF;
  const layers: { material: MeshStandardMaterial; thick: number; x: number }[] = [
    { material: style.paint, thick: 0.05, x: side * (width / 2 + 0.025) },
    { material: kit.cladding, thick: WALL_T - 0.05, x: side * (width / 2 + 0.05 + (WALL_T - 0.05) / 2) },
  ];
  for (const layer of layers) {
    const segment = (a: number, c: number, y0: number, y1: number): void => {
      if (c - a < 0.001) return;
      b.box(layer.material, layer.thick, y1 - y0, c - a, layer.x, (y0 + y1) / 2, (a + c) / 2);
    };
    if (door) {
      segment(z0, doorFrom, 0, CLEAR_H);
      segment(doorTo, z1, 0, CLEAR_H);
      segment(doorFrom, doorTo, DOOR_H, CLEAR_H);
    } else {
      segment(z0, z1, 0, CLEAR_H);
    }
  }
  if (door) {
    const x = side * (width / 2 + WALL_T / 2);
    b.box(kit.frame, WALL_T + 0.04, 0.06, DOOR_HALF * 2 + 0.1, x, DOOR_H + 0.03, AISLE_Z, { cast: false });
    for (const z of [doorFrom, doorTo]) b.box(kit.frame, WALL_T + 0.04, DOOR_H, 0.05, x, DOOR_H / 2, z, { cast: false });
  }
}

function glassWalls(b: Batcher, style: FloorStyle, width: number, doorSide: -1 | 1 | 0): void {
  const kit = buildingKit();
  const z = -HALF_D - WALL_T / 2;
  const span = width + WALL_T * 2;
  b.box(style.paint, span, 0.12, WALL_T, 0, 0.06, z);
  b.box(kit.windowGlass, span, CLEAR_H - 0.12, 0.02, 0, 0.12 + (CLEAR_H - 0.12) / 2, z, { cast: false, receive: false });
  b.box(kit.frame, span, 0.06, WALL_T, 0, CLEAR_H - 0.03, z, { cast: false });
  b.box(kit.frame, span, 0.04, 0.08, 0, 1.1, z, { cast: false });
  const mullions = Math.max(2, Math.round(span / 1.5));
  for (let index = 0; index <= mullions; index += 1) {
    b.box(kit.frame, 0.05, CLEAR_H, 0.08, -span / 2 + (span / mullions) * index, CLEAR_H / 2, z, { cast: false });
  }
  for (const side of [-1, 1] as const) {
    const x = side * (width / 2 + WALL_T / 2);
    const doorFrom = AISLE_Z - DOOR_HALF;
    const doorTo = AISLE_Z + DOOR_HALF;
    const pieces: [number, number][] = side === doorSide ? [[-HALF_D - WALL_T, doorFrom], [doorTo, HALF_D]] : [[-HALF_D - WALL_T, HALF_D]];
    for (const [a, c] of pieces) {
      b.box(kit.glass, 0.02, CLEAR_H - 0.12, c - a, x, 0.12 + (CLEAR_H - 0.12) / 2, (a + c) / 2, { cast: false, receive: false });
      b.box(style.paint, WALL_T, 0.12, c - a, x, 0.06, (a + c) / 2);
      b.box(kit.frame, WALL_T, 0.06, c - a, x, CLEAR_H - 0.03, (a + c) / 2, { cast: false });
      for (const edge of [a, c]) b.box(kit.frame, 0.08, CLEAR_H, 0.05, x, CLEAR_H / 2, edge, { cast: false });
    }
    if (side === doorSide) b.box(kit.frame, 0.08, CLEAR_H - DOOR_H, DOOR_HALF * 2, x, (DOOR_H + CLEAR_H) / 2, AISLE_Z, { cast: false });
  }
}

export class FloorRoom {
  readonly group = new Group();
  readonly origin = new Vector3();
  view: FloorView;
  building: BuildingId;
  level = 0;
  width = 0;
  private meshes: Mesh[] = [];
  private owned: Owned[] = [];
  private signature = '';
  private coffeeLed: Mesh | null = null;
  private labLamp: Owned | null = null;

  constructor(view: FloorView) {
    this.view = view;
    this.building = buildingOf(view);
  }

  get slug(): string {
    return this.view.slug;
  }

  get style(): FloorStyle {
    return floorStyle(this.view);
  }

  configure(view: FloorView, width: number, level: number, origin: Vector3): void {
    this.view = view;
    this.building = buildingOf(view);
    this.level = level;
    this.origin.copy(origin);
    this.group.position.copy(origin);
    this.group.updateMatrixWorld(true);
    const signature = [view.kind, view.stack, view.label, currentLang(), this.building, width.toFixed(2)].join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.width = width;
    this.rebuild();
  }

  tick(seconds: number, labActive: boolean): void {
    if (this.coffeeLed) this.coffeeLed.visible = Math.floor(seconds / 0.6) % 2 === 0;
    if (this.labLamp) this.labLamp.material.emissiveIntensity = labActive ? 1.6 + Math.sin(seconds * 6) * 1.2 : 0.25;
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }

  private clear(): void {
    disposeMeshes(this.meshes);
    this.meshes = [];
    for (const item of this.owned) {
      item.mesh.removeFromParent();
      item.material.dispose();
      item.texture?.dispose();
    }
    this.owned = [];
    this.coffeeLed?.removeFromParent();
    this.coffeeLed = null;
    this.labLamp = null;
  }

  private rebuild(): void {
    this.clear();
    const style = this.style;
    const kit = furnitureKit(style.muted);
    const shell = buildingKit();
    const width = this.width;
    const half = width / 2;
    const b = new Batcher();
    const seed = hashString(this.view.slug);

    b.box(shell.concrete, width + WALL_T * 2, SLAB_T, DEPTH + WALL_T, 0, -SLAB_T / 2, -WALL_T / 2);
    const floorPlane = worldUvPlane(width, DEPTH, style.floorTile);
    b.geometry(floorPlane, style.floor, 0, 0.002, 0, { cast: false });
    floorPlane.dispose();

    const doorSide: -1 | 1 = this.building === 'annex' ? -1 : 1;
    if (style.glass) {
      glassWalls(b, style, width, doorSide);
    } else {
      const openings: Opening[] = [];
      const deskStart = -half + LEAD_ZONE;
      const columns = Math.floor((width - LEAD_ZONE - UTIL_ZONE) / PITCH + 0.001);
      for (let col = 0; col < columns; col += 1) {
        const cx = deskStart + PITCH * (col + 0.5);
        openings.push({ x0: cx - 0.75, x1: cx + 0.75 });
      }
      const annex = this.building === 'annex';
      wallAlongX(b, style, width, openings, annex ? 2.15 : 1.0, annex ? 2.85 : 2.5);
      sideWall(b, style, width, -1, doorSide === -1);
      sideWall(b, style, width, 1, doorSide === 1);
      if (annex) {
        for (let col = 0; col < columns; col += 1) pegboard(b, kit, deskStart + PITCH * (col + 0.5), -HALF_D + 0.012, 1.4, seed + col);
      }
    }

    for (let x = -half + 1.5; x < half - 0.5; x += 3) {
      for (const z of [-2.1, 1.3]) b.box(shell.ceilingPanel, 1.2, 0.04, 0.6, x, CLEAR_H - 0.03, z, { cast: false, receive: false });
    }

    const leadX = -half + LEAD_DESK_DX;
    switch (this.view.kind) {
      case 'direccion':
        glassOffice(b, width, OFFICE_PARTITION_DX, HALF_D - 0.25, AISLE_Z - 0.7, AISLE_Z + 0.7, HALF_D, CLEAR_H);
        credenza(b, kit, leadX, -HALF_D + 0.3, 1.8, seed);
        floorLamp(b, kit, -half + 0.45, -HALF_D + 0.5);
        plant(b, kit, -half + 3.55, -HALF_D + 0.45, 1.6, seed + 2);
        plant(b, kit, -half + 0.5, HALF_D - 0.8, 1.2, seed + 3);
        break;
      case 'redaccion':
        bookshelf(b, kit, leadX, -HALF_D + 0.19, 2.0, 2.1, seed);
        floorLamp(b, kit, -half + 0.45, -HALF_D + 0.5);
        plant(b, kit, -half + 3.55, -HALF_D + 0.45, 1.4, seed + 2);
        bookshelf(b.within(transform(-half + 0.19, 0, 0.6, 1, 1, 1, { ry: Math.PI / 2 })), kit, 0, 0, 1.6, 1.9, seed + 5);
        break;
      case 'mantenimiento':
        toolShelf(b, kit, leadX, -HALF_D + 0.25, 2.0, seed);
        toolShelf(b.within(transform(-half + 0.25, 0, 0.5, 1, 1, 1, { ry: Math.PI / 2 })), kit, 0, 0, 1.4, seed + 7);
        plant(b, kit, -half + 3.55, -HALF_D + 0.45, 0.8, seed + 2);
        break;
      case 'observed':
        sofa(b, kit, -half + 2.0, -2.6, 0);
        floorLamp(b, kit, -half + 0.45, -HALF_D + 0.5);
        plant(b, kit, -half + 3.6, -HALF_D + 0.45, 1.2, seed + 2);
        break;
      default:
        credenza(b, kit, leadX, -HALF_D + 0.3, 1.8, seed);
        floorLamp(b, kit, -half + 0.45, -HALF_D + 0.5);
        plant(b, kit, -half + 3.55, -HALF_D + 0.45, 1.5, seed + 2);
    }

    const labX = half - LAB_BENCH_DX;
    const labZ = -HALF_D + 0.36;
    labBench(b, kit, labX, labZ, LAB_BENCH_LEN);
    meetingTable(b, kit, half - MEET_DX, MEET_Z, MEET_W, MEET_D);
    if (!style.glass) whiteboard(b, kit, half - 3.2, -HALF_D + 0.03, 1.4);
    const led = coffeeCorner(b, kit, half - COFFEE_DX, COFFEE_Z);
    plant(b, kit, half - 0.55, HALF_D - 0.55, 1.3, seed + 11);
    plant(b, kit, half - 3.2, -HALF_D + 0.4, 0.7, seed + 13);

    this.meshes = b.build(this.group);
    this.group.add(led);
    this.coffeeLed = led;

    const screen = labScreen(labX, labZ);
    this.group.add(screen);
    this.owned.push({ mesh: screen, material: screen.material as MeshStandardMaterial, texture: null });

    const lampMaterial = std(0x40ff80, 0.4, 0, { emissive: 0x20ff60, emissiveIntensity: 0.25 });
    const lamp = new Mesh(UNIT_PLANE, lampMaterial);
    lamp.position.set(labX + 0.4, 1.18, labZ - 0.08);
    lamp.rotation.x = -Math.PI / 2;
    lamp.scale.set(0.12, 0.2, 1);
    this.group.add(lamp);
    this.labLamp = { mesh: lamp, material: lampMaterial, texture: null };
    this.owned.push(this.labLamp);

    const sign = signMesh(signTexture(floorLabel(this.view), subtitleFor(this.view), style.accentCss), 2.8, 0.61);
    sign.mesh.position.set(-half + 0.4 + 1.4, CLEAR_H - 0.55, -HALF_D + (style.glass ? 0.04 : 0.012));
    this.group.add(sign.mesh);
    this.owned.push(sign);
    this.group.updateMatrixWorld(true);
  }
}

export type SiteFloor = { room: FloorRoom; nav: FloorNav };

export class Site {
  readonly root = new Group();
  readonly bounds = new Box3();
  nav: Nav = { floors: new Map(), mainGround: null, annexGround: null };
  mainWidth = 0;
  annexWidth = 0;
  annexX = 0;
  mainLevels = 0;
  annexLevels = 0;
  private readonly rooms = new Map<string, FloorRoom>();
  private order: FloorRoom[] = [];
  private siteMeshes: Mesh[] = [];
  private siteOwned: Owned[] = [];
  private siteSignature = '';
  private street: Vector3 | null = null;
  private stops: Map<string, number> = new Map();
  private readonly ground: Mesh;

  constructor() {
    const kit = buildingKit();
    this.ground = new Mesh(new PlaneGeometry(600, 600), kit.ground);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.root.add(this.ground);
  }

  get floors(): readonly FloorRoom[] {
    return this.order;
  }

  room(slug: string): FloorRoom | undefined {
    return this.rooms.get(slug);
  }

  get streetOrigin(): Vector3 | null {
    return this.street;
  }

  get liftX(): number | null {
    return this.mainLevels > 0 ? this.mainWidth / 2 + LIFT_GAP + LIFT_W / 2 : null;
  }

  get span(): { left: number; right: number } | null {
    if (this.mainLevels === 0 && this.annexLevels === 0) return null;
    const left = this.mainLevels > 0 ? -this.mainWidth / 2 - WALL_T : this.annexX - this.annexWidth / 2 - WALL_T;
    const right = this.annexLevels > 0 ? this.annexX + this.annexWidth / 2 + WALL_T : this.mainWidth / 2 + LIFT_GAP + LIFT_W;
    return { left, right };
  }

  get liftStops(): ReadonlyMap<string, number> {
    return this.stops;
  }

  origin(slug: string): Vector3 | null {
    if (slug === STREET) return this.street;
    return this.rooms.get(slug)?.origin ?? null;
  }

  occludes(point: Vector3, eye: Vector3): boolean {
    for (const room of this.order) {
      const ceiling = room.origin.y + CLEAR_H;
      if (point.y >= ceiling || eye.y <= ceiling) continue;
      const t = (ceiling - point.y) / (eye.y - point.y);
      const x = point.x + (eye.x - point.x) * t - room.origin.x;
      const z = point.z + (eye.z - point.z) * t - room.origin.z;
      if (Math.abs(x) <= room.width / 2 && z >= -HALF_D && z <= HALF_D) return true;
    }
    return false;
  }

  update(floors: readonly FloorView[], mainWidth: number, annexWidth: number): boolean {
    const main = floors.filter((floor) => buildingOf(floor) === 'main');
    const annex = floors.filter((floor) => buildingOf(floor) === 'annex');
    const live = new Set(floors.map((floor) => floor.slug));
    let changed = false;
    for (const [slug, room] of this.rooms) {
      if (live.has(slug)) continue;
      room.dispose();
      this.rooms.delete(slug);
      changed = true;
    }

    this.mainWidth = main.length > 0 ? mainWidth : 0;
    this.annexWidth = annex.length > 0 ? annexWidth : 0;
    this.mainLevels = main.length;
    this.annexLevels = annex.length;
    this.annexX = main.length > 0 ? mainWidth / 2 + LIFT_GAP + LIFT_W + CORRIDOR_LEN + WALL_T + annexWidth / 2 : 0;

    const navFloors = new Map<string, FloorNav>();
    let mainGround: string | null = null;
    let annexGround: string | null = null;
    const order: FloorRoom[] = [];
    const place = (list: readonly FloorView[], building: BuildingId, width: number, cx: number): void => {
      list.forEach((view, index) => {
        const level = list.length - 1 - index;
        let room = this.rooms.get(view.slug);
        if (!room) {
          room = new FloorRoom(view);
          this.rooms.set(view.slug, room);
          this.root.add(room.group);
          changed = true;
        }
        const origin = new Vector3(cx, PLINTH_H + level * STOREY_H, 0);
        if (!room.origin.equals(origin) || room.width !== width || room.level !== level) changed = true;
        room.configure(view, width, level, origin);
        order.push(room);
        const exitX = building === 'main' ? width / 2 + LIFT_GAP + LIFT_W / 2 : -width / 2 - WALL_T - 0.7;
        navFloors.set(view.slug, { slug: view.slug, building, level, width, exitX });
        if (level === 0 && building === 'main') mainGround = view.slug;
        if (level === 0 && building === 'annex') annexGround = view.slug;
      });
    };
    place(main, 'main', mainWidth, 0);
    place(annex, 'annex', annexWidth, this.annexX);
    const groundSlug: string | null = mainGround ?? annexGround;
    const ground = groundSlug === null ? undefined : navFloors.get(groundSlug);
    const groundRoom = groundSlug === null ? undefined : this.rooms.get(groundSlug);
    if (ground && groundRoom) {
      navFloors.set(STREET, streetNav(ground));
      this.street = new Vector3(groundRoom.origin.x, SIDEWALK_Y, groundRoom.origin.z);
    } else {
      this.street = null;
    }
    const stops = new Map<string, number>();
    for (const room of order) if (room.building === 'main') stops.set(room.slug, room.origin.y);
    const mainRoom = mainGround === null ? undefined : this.rooms.get(mainGround);
    if (mainRoom) stops.set(STREET, mainRoom.origin.y);
    this.stops = stops;
    this.order = order;
    this.nav = { floors: navFloors, mainGround, annexGround };

    const sizes = [this.mainWidth, this.annexWidth, this.mainLevels, this.annexLevels].map((value) => value.toFixed(2));
    const signature = [...sizes, currentLang()].join('|');
    if (signature !== this.siteSignature) {
      this.siteSignature = signature;
      this.rebuildSite();
      changed = true;
    }
    this.computeBounds();
    return changed;
  }

  tick(seconds: number, labActive: ReadonlySet<string>): void {
    for (const room of this.order) room.tick(seconds, labActive.has(room.slug));
  }

  retheme(): void {
    this.rebuildSite();
  }

  dispose(): void {
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
    this.clearSite();
    this.ground.geometry.dispose();
    this.root.removeFromParent();
  }

  private computeBounds(): void {
    this.bounds.makeEmpty();
    if (this.mainLevels > 0) {
      this.bounds.expandByPoint(new Vector3(-this.mainWidth / 2 - WALL_T, 0, -HALF_D - WALL_T));
      this.bounds.expandByPoint(new Vector3(this.mainWidth / 2 + LIFT_GAP + LIFT_W, PLINTH_H + this.mainLevels * STOREY_H + 0.6, HALF_D));
    }
    if (this.annexLevels > 0) {
      this.bounds.expandByPoint(new Vector3(this.annexX - this.annexWidth / 2 - WALL_T, 0, -HALF_D - WALL_T));
      this.bounds.expandByPoint(new Vector3(this.annexX + this.annexWidth / 2 + WALL_T, PLINTH_H + this.annexLevels * STOREY_H + 0.6, HALF_D));
    }
    if (!this.bounds.isEmpty()) this.bounds.max.z = Math.max(this.bounds.max.z, GARDEN_FAR_Z);
  }

  private clearSite(): void {
    disposeMeshes(this.siteMeshes);
    this.siteMeshes = [];
    for (const item of this.siteOwned) {
      item.mesh.removeFromParent();
      item.material.dispose();
      item.texture?.dispose();
    }
    this.siteOwned = [];
  }

  private rebuildSite(): void {
    this.clearSite();
    const kit = buildingKit();
    const b = new Batcher();
    const hasMain = this.mainLevels > 0;
    const hasAnnex = this.annexLevels > 0;
    const left = hasMain ? -this.mainWidth / 2 - WALL_T : this.annexX - this.annexWidth / 2 - WALL_T;
    const right = hasAnnex ? this.annexX + this.annexWidth / 2 + WALL_T : this.mainWidth / 2 + LIFT_GAP + LIFT_W;
    if (hasMain || hasAnnex) {
      b.box(kit.sidewalk, right - left + 8, SIDEWALK_Y, DEPTH + 9, (left + right) / 2, SIDEWALK_Y / 2, 0.5, { cast: false });
    }

    const roof = (cx: number, width: number, levels: number, title: string, accent: string): void => {
      const top = PLINTH_H + levels * STOREY_H - SLAB_T;
      const span = width + WALL_T * 2;
      b.box(kit.plinth, span + 0.8, PLINTH_H, DEPTH + WALL_T + 0.8, cx, PLINTH_H / 2, -WALL_T / 2, { cast: false });
      b.box(kit.roof, span + 0.2, SLAB_T, DEPTH + WALL_T + 0.2, cx, top + SLAB_T / 2, -WALL_T / 2);
      const parapetY = top + SLAB_T + 0.25;
      b.box(kit.cladding, span + 0.2, 0.5, 0.15, cx, parapetY, HALF_D + 0.025);
      b.box(kit.cladding, span + 0.2, 0.5, 0.15, cx, parapetY, -HALF_D - WALL_T - 0.025);
      b.box(kit.cladding, 0.15, 0.5, DEPTH + WALL_T + 0.2, cx - span / 2 - 0.025, parapetY, -WALL_T / 2);
      b.box(kit.cladding, 0.15, 0.5, DEPTH + WALL_T + 0.2, cx + span / 2 + 0.025, parapetY, -WALL_T / 2);
      const units = Math.max(1, Math.floor(width / 7));
      for (let index = 0; index < units; index += 1) {
        const x = cx - width / 2 + 2.5 + index * ((width - 5) / Math.max(1, units - 1 || 1));
        b.box(kit.rooftop, 1.4, 0.9, 1.1, x, top + SLAB_T + 0.45, -HALF_D + 1.4);
        b.cylinder(kit.claddingDark, 0.35, 0.12, x, top + SLAB_T + 0.96, -HALF_D + 1.4, { segments: 18 });
      }
      for (let level = 0; level < levels; level += 1) {
        const y = PLINTH_H + level * STOREY_H - SLAB_T / 2;
        b.box(kit.claddingDark, span + 0.06, 0.08, 0.04, cx, y + SLAB_T / 2 - 0.04, HALF_D + 0.02, { cast: false });
      }
      const sign = signMesh(signTexture(title, '', accent, 1024, 200), Math.min(6, width * 0.45), 1.05);
      sign.mesh.position.set(cx, top + SLAB_T + 1.15, HALF_D - 0.6);
      this.root.add(sign.mesh);
      this.siteOwned.push(sign);
      b.box(kit.frame, 0.08, 0.7, 0.08, cx - Math.min(6, width * 0.45) / 2 + 0.3, top + SLAB_T + 0.35, HALF_D - 0.65);
      b.box(kit.frame, 0.08, 0.7, 0.08, cx + Math.min(6, width * 0.45) / 2 - 0.3, top + SLAB_T + 0.35, HALF_D - 0.65);
    };

    if (hasMain) {
      roof(0, this.mainWidth, this.mainLevels, 'Agent Office', '#4f7cff');
      const x0 = this.mainWidth / 2 + LIFT_GAP;
      const x1 = x0 + LIFT_W;
      const z0 = AISLE_Z - LIFT_W / 2;
      const z1 = AISLE_Z + LIFT_W / 2;
      const height = this.mainLevels * STOREY_H + 0.4;
      const cx = (x0 + x1) / 2;
      const y = PLINTH_H + height / 2;
      b.box(kit.plinth, LIFT_W + 0.4, PLINTH_H, LIFT_W + 0.4, cx, PLINTH_H / 2, AISLE_Z, { cast: false });
      const outerFrom = hasAnnex ? PLINTH_H + 2.85 : PLINTH_H;
      const outerTo = PLINTH_H + height;
      if (outerTo > outerFrom) b.box(kit.glass, 0.02, outerTo - outerFrom, LIFT_W, x1, (outerFrom + outerTo) / 2, AISLE_Z, { cast: false, receive: false });
      b.box(kit.glass, LIFT_W, height, 0.02, cx, y, z0, { cast: false, receive: false });
      const doorTop = PLINTH_H + DOOR_H;
      const jamb = (LIFT_W - TOWER_DOOR_W) / 2;
      b.box(kit.glass, LIFT_W, PLINTH_H + height - doorTop, 0.02, cx, (doorTop + PLINTH_H + height) / 2, z1, { cast: false, receive: false });
      for (const side of [-1, 1]) {
        b.box(kit.glass, jamb, DOOR_H, 0.02, cx + side * (TOWER_DOOR_W / 2 + jamb / 2), PLINTH_H + DOOR_H / 2, z1, { cast: false, receive: false });
        b.box(kit.frame, 0.06, DOOR_H, 0.08, cx + side * (TOWER_DOOR_W / 2), PLINTH_H + DOOR_H / 2, z1, { cast: false });
      }
      b.box(kit.frame, TOWER_DOOR_W + 0.06, 0.06, 0.08, cx, doorTop, z1, { cast: false });
      for (const [px, pz] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]] as const) b.box(kit.frame, 0.1, height, 0.1, px, y, pz);
      for (let level = 0; level <= this.mainLevels; level += 1) {
        const ly = PLINTH_H + level * STOREY_H - 0.04;
        b.box(kit.frame, 0.08, 0.08, LIFT_W, x1, ly, AISLE_Z, { cast: false });
        b.box(kit.frame, LIFT_W, 0.08, 0.08, cx, ly, z0, { cast: false });
        b.box(kit.frame, LIFT_W, 0.08, 0.08, cx, ly, z1, { cast: false });
      }
      b.box(kit.claddingDark, LIFT_W + 0.2, 0.25, LIFT_W + 0.2, cx, PLINTH_H + height + 0.125, AISLE_Z);
      b.cylinder(kit.chrome, 0.05, height, cx, y, z0 + 0.2, { segments: 8, cast: false });

      if (hasAnnex) {
        const cx0 = x1;
        const cx1 = this.annexX - this.annexWidth / 2 - WALL_T;
        const length = cx1 - cx0;
        const mid = (cx0 + cx1) / 2;
        const zA = AISLE_Z - 1.0;
        const zB = AISLE_Z + 1.0;
        b.box(kit.plinth, length, PLINTH_H, 2.4, mid, PLINTH_H / 2, AISLE_Z, { cast: false });
        b.box(kit.concrete, length, 0.02, 2.0, mid, PLINTH_H + 0.01, AISLE_Z, { cast: false });
        b.box(kit.roof, length, 0.18, 2.3, mid, PLINTH_H + 2.75, AISLE_Z);
        for (const z of [zA, zB]) {
          b.box(kit.glass, length, 2.6, 0.02, mid, PLINTH_H + 1.32, z, { cast: false, receive: false });
          b.box(kit.frame, length, 0.06, 0.06, mid, PLINTH_H + 0.03, z, { cast: false });
          b.box(kit.frame, length, 0.06, 0.06, mid, PLINTH_H + 2.63, z, { cast: false });
          const posts = Math.max(1, Math.round(length / 1.5));
          for (let index = 0; index <= posts; index += 1) b.box(kit.frame, 0.06, 2.6, 0.06, cx0 + (length / posts) * index, PLINTH_H + 1.3, z);
        }
      }
    }
    if (hasAnnex) {
      roof(this.annexX, this.annexWidth, this.annexLevels, t('floor.mantenimiento'), '#f59e0b');
      if (this.annexLevels > 1) {
        const sx = this.annexX - this.annexWidth / 2 - WALL_T - 0.7;
        const from = PLINTH_H + 2.85;
        const to = PLINTH_H + this.annexLevels * STOREY_H;
        const sy = (from + to) / 2;
        b.box(kit.glass, 1.4, to - from, 0.02, sx, sy, AISLE_Z - 0.7, { cast: false, receive: false });
        b.box(kit.glass, 1.4, to - from, 0.02, sx, sy, AISLE_Z + 0.7, { cast: false, receive: false });
        b.box(kit.glass, 0.02, to - from, 1.4, sx - 0.7, sy, AISLE_Z, { cast: false, receive: false });
        for (const [px, pz] of [[sx - 0.7, AISLE_Z - 0.7], [sx - 0.7, AISLE_Z + 0.7], [sx + 0.7, AISLE_Z - 0.7], [sx + 0.7, AISLE_Z + 0.7]] as const) {
          b.box(kit.frame, 0.08, to - PLINTH_H, 0.08, px, (PLINTH_H + to) / 2, pz);
        }
      }
    }

    this.siteMeshes = b.build(this.root);
  }
}
