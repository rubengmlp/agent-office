import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
  type Matrix4,
  type MeshStandardMaterial,
} from 'three';
import { Batcher, transform } from './batch';
import {
  DESK_D,
  DESK_H,
  DESK_H_SEATED,
  DESK_W,
  LEAD_DESK_D,
  LEAD_DESK_W,
  LEAD_STAND_OFFSET,
  STAND_OFFSET,
} from './constants';
import { buildingKit, codeTexture, furnitureKit, prng, std, type FurnitureKit } from './materials';

export const UNIT_PLANE = new PlaneGeometry(1, 1);

let glowTextureCache: CanvasTexture | null = null;

export function glowTexture(): CanvasTexture {
  if (glowTextureCache) return glowTextureCache;
  const element = document.createElement('canvas');
  element.width = 128;
  element.height = 128;
  const ctx = element.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D no disponible');
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  glowTextureCache = new CanvasTexture(element);
  glowTextureCache.colorSpace = SRGBColorSpace;
  return glowTextureCache;
}

export type DeskVariant = 'standard' | 'lead' | 'executive' | 'writing' | 'workbench';

type Part = { geometry: BufferGeometry; material: Material; cast: boolean; receive: boolean };

type DeskTemplate = { top: Part[]; frame: Part[]; chair: Part[]; screens: Matrix4[]; glows: Matrix4[] };

function collect(batcher: Batcher): Part[] {
  const holder = new Group();
  return batcher.build(holder).map((mesh) => ({
    geometry: mesh.geometry,
    material: mesh.material as Material,
    cast: mesh.castShadow,
    receive: mesh.receiveShadow,
  }));
}

function meshOf(part: Part): Mesh {
  const mesh = new Mesh(part.geometry, part.material);
  mesh.castShadow = part.cast;
  mesh.receiveShadow = part.receive;
  return mesh;
}

function facing(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

function monitor(top: Batcher, kit: FurnitureKit, screens: Matrix4[], glows: Matrix4[], x: number, z: number, standZ: number, height: number): void {
  const frame = transform(x, height, z, 1, 1, 1, { ry: facing(x, z, 0, standZ) });
  const m = top.within(frame);
  m.box(kit.plastic, 0.22, 0.012, 0.16, 0, 0.006, -0.02);
  m.box(kit.plastic, 0.045, 0.27, 0.03, 0, 0.145, -0.05);
  m.box(kit.plastic, 0.58, 0.35, 0.028, 0, 0.37, -0.03);
  screens.push(frame.clone().multiply(transform(0, 0.37, -0.0135, 0.545, 0.315, 1)));
  glows.push(frame.clone().multiply(transform(0, 0.37, -0.07, 1.05, 0.72, 1, { ry: Math.PI })));
}

function laptop(top: Batcher, kit: FurnitureKit, screens: Matrix4[], glows: Matrix4[], x: number, z: number, standZ: number, height: number): void {
  const frame = transform(x, height, z, 1, 1, 1, { ry: facing(x, z, 0, standZ) });
  const m = top.within(frame);
  m.box(kit.steel, 0.34, 0.016, 0.24, 0, 0.008, 0);
  m.box(kit.keyboard, 0.3, 0.002, 0.12, 0, 0.017, 0.03);
  const tilt = -0.28;
  const cy = 0.016 + 0.11 * Math.cos(tilt);
  const cz = -0.12 + 0.11 * Math.sin(tilt);
  m.box(kit.steel, 0.34, 0.22, 0.01, 0, cy, cz, { rx: tilt });
  screens.push(frame.clone().multiply(transform(0, cy + 0.008 * Math.sin(-tilt), cz + 0.008 * Math.cos(tilt), 0.31, 0.19, 1, { rx: tilt })));
  glows.push(frame.clone().multiply(transform(0, cy - 0.014, cz - 0.05, 0.75, 0.5, 1, { ry: Math.PI, rx: -tilt })));
}

function keyboardAndMouse(top: Batcher, kit: FurnitureKit, z: number, height: number): void {
  top.box(kit.keyboard, 0.42, 0.02, 0.14, -0.02, height + 0.01, z, { rx: 0.04 });
  top.box(kit.plastic, 0.06, 0.025, 0.1, -0.36, height + 0.0125, z);
  top.box(kit.rubber, 0.24, 0.003, 0.2, -0.36, height + 0.0015, z, { cast: false });
}

function deskPlant(top: Batcher, kit: FurnitureKit, x: number, z: number, height: number): void {
  top.cylinder(kit.ceramic, 0.055, 0.1, x, height + 0.05, z, { topRatio: 1.15, segments: 12 });
  top.sphere(kit.leaf, 0.09, x, height + 0.15, z, { sy: 0.8 });
  top.sphere(kit.leafDark, 0.06, x + 0.04, height + 0.2, z - 0.02);
}

function deskLamp(top: Batcher, kit: FurnitureKit, x: number, z: number, height: number, brass: boolean): void {
  const metal = brass ? kit.brass : kit.metal;
  top.cylinder(metal, 0.07, 0.02, x, height + 0.01, z, { segments: 14 });
  top.box(metal, 0.018, 0.36, 0.018, x, height + 0.19, z, { rz: 0.18 });
  top.box(metal, 0.018, 0.24, 0.018, x - 0.07, height + 0.4, z + 0.05, { rz: -0.9, rx: -0.3 });
  top.cylinder(kit.lampShade, 0.07, 0.1, x - 0.17, height + 0.42, z + 0.09, { topRatio: 0.45, segments: 14, rx: 0.5 });
}

function paperStack(top: Batcher, kit: FurnitureKit, x: number, z: number, height: number, sheets: number, ry: number): void {
  top.box(kit.paper, 0.21, 0.004 * sheets, 0.297, x, height + 0.002 * sheets, z, { ry });
}

function books(top: Batcher, kit: FurnitureKit, x: number, z: number, height: number, random: () => number): void {
  const covers = [kit.binderA, kit.binderB, kit.binderC, kit.leather];
  let y = height;
  for (let index = 0; index < 3; index += 1) {
    const thick = 0.03 + random() * 0.03;
    top.box(covers[Math.floor(random() * covers.length)], 0.17 + random() * 0.05, thick, 0.24, x, y + thick / 2, z, { ry: (random() - 0.5) * 0.5 });
    y += thick;
  }
}

function chairParts(kit: FurnitureKit, standZ: number): Part[] {
  const b = new Batcher();
  const z = standZ - 0.05;
  b.box(kit.fabric, 0.48, 0.08, 0.46, 0, 0.48, z);
  b.box(kit.fabric, 0.46, 0.52, 0.06, 0, 0.82, z - 0.24, { rx: -0.08 });
  b.cylinder(kit.chrome, 0.03, 0.36, 0, 0.27, z, { segments: 10 });
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2;
    b.box(kit.metal, 0.05, 0.03, 0.3, Math.sin(angle) * 0.15, 0.06, z + Math.cos(angle) * 0.15, { ry: angle });
    b.sphere(kit.rubber, 0.03, Math.sin(angle) * 0.29, 0.03, z + Math.cos(angle) * 0.29);
  }
  return collect(b);
}

function legs(frame: Batcher, material: Material, width: number, depth: number, height: number, inset: number): void {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      frame.box(material, 0.05, height, 0.05, sx * (width / 2 - inset), height / 2, sz * (depth / 2 - inset));
    }
  }
}

function buildTemplate(variant: DeskVariant, muted: boolean, flavour: number): DeskTemplate {
  const kit = furnitureKit(muted);
  const top = new Batcher();
  const frame = new Batcher();
  const screens: Matrix4[] = [];
  const glows: Matrix4[] = [];
  const random = prng(flavour * 97 + variant.length * 13 + (muted ? 5 : 0));
  const h = DESK_H;
  const standZ = variant === 'lead' || variant === 'executive' ? -LEAD_STAND_OFFSET : -STAND_OFFSET;

  switch (variant) {
    case 'standard': {
      top.box(kit.laminate, DESK_W, 0.035, DESK_D, 0, h - 0.0175, 0);
      top.box(kit.birch, DESK_W, 0.012, DESK_D, 0, h - 0.041, 0, { cast: false });
      for (const sx of [-1, 1]) {
        frame.box(kit.metal, 0.07, h - 0.06, 0.07, sx * 0.55, (h - 0.06) / 2, 0);
        frame.box(kit.metal, 0.08, 0.03, 0.62, sx * 0.55, 0.015, 0);
      }
      frame.box(kit.metal, 1.1, 0.05, 0.05, 0, h - 0.09, 0.05);
      keyboardAndMouse(top, kit, -0.2, h);
      monitor(top, kit, screens, glows, 0.36, 0.12, standZ, h);
      if (flavour === 0) deskPlant(top, kit, 0.55, -0.22, h);
      if (flavour === 1) top.cylinder(kit.ceramic, 0.04, 0.1, 0.56, h + 0.05, -0.2, { segments: 12 });
      if (flavour === 2) paperStack(top, kit, -0.5, 0.15, h, 3, 0.2);
      break;
    }
    case 'lead': {
      top.box(kit.oak, LEAD_DESK_W, 0.045, LEAD_DESK_D, 0, h - 0.0225, 0);
      legs(frame, kit.metal, LEAD_DESK_W, LEAD_DESK_D, h - 0.045, 0.08);
      frame.box(kit.metal, LEAD_DESK_W - 0.2, 0.3, 0.02, 0, h - 0.25, LEAD_DESK_D / 2 - 0.08);
      keyboardAndMouse(top, kit, -0.25, h);
      monitor(top, kit, screens, glows, -0.42, 0.14, standZ, h);
      monitor(top, kit, screens, glows, 0.42, 0.14, standZ, h);
      books(top, kit, 0.8, -0.2, h, random);
      deskPlant(top, kit, -0.82, -0.25, h);
      break;
    }
    case 'executive': {
      top.box(kit.walnut, LEAD_DESK_W, 0.05, LEAD_DESK_D, 0, h - 0.025, 0);
      for (const sx of [-1, 1]) frame.box(kit.walnut, 0.05, h - 0.05, LEAD_DESK_D - 0.06, sx * (LEAD_DESK_W / 2 - 0.05), (h - 0.05) / 2, 0);
      frame.box(kit.walnut, LEAD_DESK_W - 0.12, 0.55, 0.03, 0, h - 0.33, LEAD_DESK_D / 2 - 0.05);
      top.box(kit.leather, 0.7, 0.004, 0.42, 0, h + 0.002, -0.18, { cast: false });
      keyboardAndMouse(top, kit, -0.24, h);
      monitor(top, kit, screens, glows, -0.42, 0.16, standZ, h);
      monitor(top, kit, screens, glows, 0.42, 0.16, standZ, h);
      deskLamp(top, kit, 0.82, 0.22, h, true);
      top.box(kit.brass, 0.22, 0.05, 0.03, -0.75, h + 0.025, 0.3, { rx: -0.4 });
      paperStack(top, kit, -0.72, -0.15, h, 4, -0.15);
      break;
    }
    case 'writing': {
      top.box(kit.walnut, DESK_W, 0.04, DESK_D, 0, h - 0.02, 0);
      legs(frame, kit.walnut, DESK_W, DESK_D, h - 0.04, 0.06);
      frame.box(kit.walnut, DESK_W - 0.15, 0.03, DESK_D - 0.15, 0, 0.18, 0);
      laptop(top, kit, screens, glows, 0.36, 0.08, standZ, h);
      top.box(kit.leather, 0.42, 0.012, 0.3, -0.12, h + 0.006, -0.18, { ry: 0.08 });
      top.box(kit.paper, 0.2, 0.004, 0.28, -0.225, h + 0.014, -0.18, { ry: 0.08, rz: 0.03 });
      top.box(kit.paper, 0.2, 0.004, 0.28, -0.02, h + 0.014, -0.165, { ry: 0.08, rz: -0.03 });
      top.box(kit.plastic, 0.012, 0.008, 0.15, 0.05, h + 0.02, -0.2, { ry: 0.6 });
      paperStack(top, kit, -0.5, 0.18, h, 6, 0.1 + random() * 0.3);
      books(top, kit, 0.02, 0.22, h, random);
      deskLamp(top, kit, -0.52, -0.05, h, flavour === 1);
      break;
    }
    case 'workbench': {
      top.box(kit.butcher, 1.4, 0.06, 0.75, 0, h - 0.03, 0);
      legs(frame, kit.steel, 1.4, 0.75, h - 0.06, 0.06);
      frame.box(kit.steel, 1.3, 0.03, 0.65, 0, 0.25, 0);
      frame.box(kit.cardboard, 0.4, 0.25, 0.35, -0.35, 0.39, 0.05);
      frame.box(kit.toolRed, 0.3, 0.18, 0.25, 0.3, 0.355, 0.08);
      laptop(top, kit, screens, glows, -0.05, 0.12, standZ, h);
      top.box(kit.metal, 0.12, 0.1, 0.16, 0.6, h + 0.05, -0.22);
      top.box(kit.metal, 0.16, 0.06, 0.06, 0.6, h + 0.12, -0.22);
      top.box(kit.toolRed, 0.36, 0.16, 0.18, -0.5, h + 0.08, 0.2);
      top.box(kit.oak, 0.025, 0.025, 0.28, 0.32, h + 0.013, -0.15, { ry: 0.5 });
      top.box(kit.metal, 0.09, 0.035, 0.03, 0.39, h + 0.018, -0.03, { ry: 0.5 });
      break;
    }
  }
  return { top: collect(top), frame: collect(frame), chair: chairParts(kit, standZ), screens, glows };
}

const templates = new Map<string, DeskTemplate>();

export function disposeDeskTemplates(): void {
  for (const template of templates.values()) {
    for (const part of [...template.top, ...template.frame, ...template.chair]) part.geometry.dispose();
  }
  templates.clear();
  glowTextureCache?.dispose();
  glowTextureCache = null;
}

function deskTemplate(variant: DeskVariant, muted: boolean, flavour: number): DeskTemplate {
  const key = `${variant}|${muted ? 1 : 0}|${flavour}`;
  let template = templates.get(key);
  if (!template) {
    template = buildTemplate(variant, muted, flavour);
    templates.set(key, template);
  }
  return template;
}

export class Desk {
  readonly group = new Group();
  private readonly top = new Group();
  private readonly frame = new Group();
  private readonly chair = new Group();
  private readonly screen: MeshStandardMaterial;
  private readonly glow: MeshBasicMaterial;
  private seated = false;
  private level = -1;

  constructor(
    readonly variant: DeskVariant,
    readonly muted: boolean,
    seed: number,
  ) {
    const template = deskTemplate(variant, muted, seed % 3);
    for (const part of template.top) this.top.add(meshOf(part));
    for (const part of template.frame) this.frame.add(meshOf(part));
    for (const part of template.chair) this.chair.add(meshOf(part));
    this.screen = std(0x0a0f1a, 0.3, 0, { emissive: 0xffffff, emissiveMap: codeTexture(), emissiveIntensity: 0.06 });
    this.glow = new MeshBasicMaterial({
      color: muted ? 0x9fb3c4 : 0x5fc8ff,
      map: glowTexture(),
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    for (const matrix of template.screens) {
      const mesh = new Mesh(UNIT_PLANE, this.screen);
      mesh.applyMatrix4(matrix);
      this.top.add(mesh);
    }
    for (const matrix of template.glows) {
      const mesh = new Mesh(UNIT_PLANE, this.glow);
      mesh.applyMatrix4(matrix);
      mesh.renderOrder = 3;
      this.top.add(mesh);
    }
    this.chair.visible = false;
    this.group.add(this.frame, this.top, this.chair);
  }

  place(x: number, z: number, scale: number): void {
    this.group.position.set(x, 0, z);
    this.group.scale.setScalar(scale);
  }

  setSeated(seated: boolean): void {
    if (seated === this.seated) return;
    this.seated = seated;
    this.top.position.y = seated ? DESK_H_SEATED - DESK_H : 0;
    this.frame.scale.y = seated ? DESK_H_SEATED / DESK_H : 1;
    this.chair.visible = seated;
  }

  setScreen(level: number): void {
    const rounded = Math.round(level * 50) / 50;
    if (rounded === this.level) return;
    this.level = rounded;
    this.screen.emissiveIntensity = 0.06 + rounded * 1.1;
    this.glow.opacity = rounded * 0.55;
    this.glow.visible = rounded > 0.01;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.screen.dispose();
    this.glow.dispose();
  }
}

export function labBench(b: Batcher, kit: FurnitureKit, cx: number, cz: number, length: number): void {
  b.box(kit.cabinet, length, 0.86, 0.64, cx, 0.43, cz);
  for (let index = 1; index < 4; index += 1) {
    b.box(kit.metal, 0.01, 0.74, 0.006, cx - length / 2 + (length / 4) * index, 0.45, cz + 0.322, { cast: false });
  }
  for (let index = 0; index < 4; index += 1) {
    b.box(kit.chrome, 0.12, 0.015, 0.02, cx - length / 2 + (length / 4) * (index + 0.5), 0.72, cz + 0.33, { cast: false });
  }
  b.box(kit.epoxy, length + 0.04, 0.04, 0.72, cx, 0.88, cz);
  for (const dx of [-length / 2 + 0.1, length / 2 - 0.1]) b.box(kit.metal, 0.03, 0.5, 0.2, cx + dx, 1.15, cz - 0.25);
  b.box(kit.epoxy, length - 0.1, 0.025, 0.24, cx, 1.4, cz - 0.24);
  const random = prng(Math.round(cx * 10) + 3);
  for (let index = 0; index < 9; index += 1) {
    const x = cx - length / 2 + 0.25 + index * ((length - 0.5) / 8);
    const tall = 0.12 + random() * 0.12;
    b.cylinder(index % 3 === 0 ? kit.binderA : kit.glassware, 0.035, tall, x, 1.4125 + tall / 2, cz - 0.24, { segments: 10 });
  }
  b.box(kit.plastic, 0.32, 0.05, 0.1, cx - 1.0, 0.925, cz + 0.05);
  for (let index = 0; index < 6; index += 1) {
    const x = cx - 1.13 + index * 0.052;
    b.cylinder(kit.glassware, 0.012, 0.15, x, 1.0, cz + 0.05, { segments: 8 });
    b.cylinder(kit.liquid, 0.01, 0.07, x, 0.97, cz + 0.05, { segments: 8, cast: false });
  }
  b.cylinder(kit.glassware, 0.075, 0.17, cx - 0.55, 0.985, cz + 0.08, { topRatio: 0.3, segments: 16 });
  b.cylinder(kit.glassware, 0.022, 0.07, cx - 0.55, 1.105, cz + 0.08, { segments: 12 });
  b.cylinder(kit.liquid, 0.06, 0.08, cx - 0.55, 0.94, cz + 0.08, { topRatio: 0.55, segments: 16, cast: false });
  b.box(kit.plastic, 0.42, 0.26, 0.3, cx + 0.25, 1.03, cz - 0.08);
  for (let index = 0; index < 5; index += 1) b.box(kit.ledGreen, 0.03, 0.012, 0.005, cx + 0.1 + index * 0.06, 1.06, cz + 0.072, { cast: false });
  b.box(kit.plastic, 0.025, 0.25, 0.025, cx + 0.95, 1.025, cz - 0.05);
  b.box(kit.plastic, 0.56, 0.34, 0.03, cx + 0.95, 1.26, cz - 0.03);
}

export function labScreen(cx: number, cz: number): Mesh {
  const material = std(0x061108, 0.3, 0, { emissive: 0x7dffa8, emissiveMap: codeTexture(), emissiveIntensity: 0.7 });
  const mesh = new Mesh(UNIT_PLANE, material);
  mesh.position.set(cx + 0.95, 1.26, cz - 0.012);
  mesh.scale.set(0.52, 0.3, 1);
  return mesh;
}

export function chair(b: Batcher, kit: FurnitureKit, x: number, z: number, ry: number): void {
  const local = b.within(transform(x, 0, z, 1, 1, 1, { ry }));
  local.box(kit.fabric, 0.46, 0.07, 0.44, 0, 0.47, 0);
  local.box(kit.fabric, 0.44, 0.42, 0.05, 0, 0.74, -0.21, { rx: -0.1 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) local.cylinder(kit.chrome, 0.012, 0.44, sx * 0.19, 0.22, sz * 0.18, { segments: 8 });
  }
}

export function meetingTable(b: Batcher, kit: FurnitureKit, cx: number, cz: number, width: number, depth: number): void {
  b.box(kit.walnut, width, 0.05, depth, cx, 0.745, cz);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.cylinder(kit.chrome, 0.025, 0.72, cx + sx * (width / 2 - 0.12), 0.36, cz + sz * (depth / 2 - 0.12), { segments: 10 });
  }
  chair(b, kit, cx - 0.5, cz - depth / 2 - 0.3, 0);
  chair(b, kit, cx + 0.5, cz - depth / 2 - 0.3, 0);
  b.box(kit.steel, 0.34, 0.02, 0.24, cx - 0.35, 0.78, cz - 0.1, { ry: 0.3 });
  b.box(kit.paper, 0.21, 0.004, 0.297, cx + 0.15, 0.772, cz + 0.1, { ry: -0.2 });
  b.box(kit.paper, 0.21, 0.004, 0.297, cx + 0.38, 0.772, cz + 0.05, { ry: 0.4 });
  b.cylinder(kit.glassware, 0.05, 0.22, cx + 0.7, 0.88, cz - 0.15, { segments: 14, topRatio: 0.8 });
  b.cylinder(kit.glassware, 0.03, 0.09, cx + 0.55, 0.815, cz - 0.25, { segments: 10 });
}

export function whiteboard(b: Batcher, kit: FurnitureKit, cx: number, cz: number, width: number): void {
  b.box(kit.steel, width + 0.06, 1.06, 0.03, cx, 1.55, cz);
  b.box(kit.whiteboard, width, 1.0, 0.02, cx, 1.55, cz + 0.012, { cast: false });
  b.box(kit.steel, width * 0.6, 0.03, 0.08, cx, 1.03, cz + 0.04);
  const random = prng(Math.round(cx * 7) + 1);
  const inks = [kit.binderA, kit.binderB, kit.binderC, kit.plastic];
  for (let index = 0; index < 7; index += 1) {
    const length = 0.2 + random() * (width * 0.45);
    b.box(inks[index % inks.length], length, 0.018, 0.004, cx - width / 2 + 0.12 + length / 2 + random() * 0.2, 1.88 - index * 0.11, cz + 0.024, {
      cast: false,
      rz: (random() - 0.5) * 0.06,
    });
  }
}

export function coffeeCorner(b: Batcher, kit: FurnitureKit, cx: number, cz: number): Mesh {
  b.box(kit.laminate, 2.2, 0.86, 0.58, cx, 0.43, cz);
  b.box(kit.walnut, 2.24, 0.04, 0.62, cx, 0.88, cz);
  for (let index = 1; index < 4; index += 1) b.box(kit.metal, 0.008, 0.76, 0.005, cx - 1.1 + index * 0.55, 0.45, cz + 0.292, { cast: false });
  b.box(kit.laminate, 2.2, 0.62, 0.34, cx, 1.95, cz - 0.12);
  b.box(kit.steel, 0.36, 0.46, 0.38, cx + 0.62, 1.13, cz - 0.04);
  b.box(kit.plastic, 0.3, 0.2, 0.01, cx + 0.62, 1.22, cz + 0.152, { cast: false });
  b.box(kit.plastic, 0.24, 0.02, 0.14, cx + 0.62, 0.92, cz + 0.12);
  b.cylinder(kit.ceramic, 0.04, 0.09, cx + 0.62, 0.975, cz + 0.11, { segments: 12 });
  b.cylinder(kit.steel, 0.08, 0.22, cx + 0.05, 1.01, cz - 0.05, { segments: 16, topRatio: 0.7 });
  for (let index = 0; index < 4; index += 1) {
    b.cylinder(index % 2 === 0 ? kit.ceramic : kit.binderB, 0.04, 0.095, cx - 0.35 - index * 0.12, 0.9475, cz + 0.05 - (index % 2) * 0.12, { segments: 12 });
  }
  const led = new Mesh(UNIT_PLANE, kit.ledRed);
  led.position.set(cx + 0.7, 1.3, cz + 0.158);
  led.scale.set(0.025, 0.025, 1);
  return led;
}

export function plant(b: Batcher, kit: FurnitureKit, x: number, z: number, height: number, seed: number): void {
  const random = prng(seed);
  const pot = random() > 0.5 ? kit.terracotta : kit.ceramic;
  const potH = Math.min(0.45, 0.22 + height * 0.12);
  const potR = 0.14 + height * 0.05;
  b.cylinder(pot, potR, potH, x, potH / 2, z, { topRatio: 1.18, segments: 16 });
  b.cylinder(kit.soil, potR * 1.05, 0.02, x, potH - 0.015, z, { segments: 16, cast: false });
  if (height > 1) {
    b.cylinder(kit.oak, 0.025, height - potH, x, potH + (height - potH) / 2, z, { segments: 8 });
  }
  const crown = Math.max(potH + 0.15, height - 0.25);
  const blobs = height > 1 ? 7 : 5;
  for (let index = 0; index < blobs; index += 1) {
    const angle = random() * Math.PI * 2;
    const spread = (height > 1 ? 0.28 : 0.16) * random();
    const y = height > 1 ? crown - random() * 0.5 : potH + 0.12 + random() * 0.18;
    b.sphere(index % 2 === 0 ? kit.leaf : kit.leafDark, (height > 1 ? 0.2 : 0.13) + random() * 0.08, x + Math.cos(angle) * spread, y, z + Math.sin(angle) * spread, { sy: 0.85 });
  }
}

export function floorLamp(b: Batcher, kit: FurnitureKit, x: number, z: number): void {
  b.cylinder(kit.metal, 0.16, 0.03, x, 0.015, z, { segments: 18 });
  b.cylinder(kit.metal, 0.015, 1.5, x, 0.78, z, { segments: 8 });
  b.cylinder(kit.lampShade, 0.2, 0.28, x, 1.62, z, { topRatio: 0.7, segments: 20 });
}

export function bookshelf(b: Batcher, kit: FurnitureKit, cx: number, cz: number, width: number, height: number, seed: number): void {
  const depth = 0.34;
  const wood = kit.oak;
  b.box(wood, 0.03, height, depth, cx - width / 2, height / 2, cz);
  b.box(wood, 0.03, height, depth, cx + width / 2, height / 2, cz);
  b.box(wood, width, height, 0.015, cx, height / 2, cz - depth / 2 + 0.008, { cast: false });
  const shelves = Math.max(3, Math.round(height / 0.4));
  const random = prng(seed);
  const covers = [kit.binderA, kit.binderB, kit.binderC, kit.leather, kit.paper, kit.walnut];
  for (let level = 0; level <= shelves; level += 1) {
    const y = (level / shelves) * (height - 0.03) + 0.015;
    b.box(wood, width, 0.03, depth, cx, y, cz);
    if (level === shelves) continue;
    let x = cx - width / 2 + 0.04;
    while (x < cx + width / 2 - 0.08) {
      if (random() < 0.12) {
        x += 0.12;
        continue;
      }
      const thick = 0.025 + random() * 0.035;
      const tall = 0.22 + random() * 0.1;
      b.box(covers[Math.floor(random() * covers.length)], thick, tall, 0.22, x + thick / 2, y + 0.015 + tall / 2, cz + 0.02, { cast: false });
      x += thick + 0.003;
    }
  }
}

export function credenza(b: Batcher, kit: FurnitureKit, cx: number, cz: number, width: number, seed: number): void {
  b.box(kit.walnut, width, 0.72, 0.45, cx, 0.36, cz);
  for (let index = 1; index < 3; index += 1) b.box(kit.metal, 0.006, 0.6, 0.005, cx - width / 2 + (width / 3) * index, 0.38, cz + 0.227, { cast: false });
  books(b, kit, cx - width / 2 + 0.3, cz, 0.72, prng(seed));
  plant(b.within(transform(0, 0.72, 0, 1, 1, 1)), kit, cx + width / 2 - 0.25, cz, 0.45, seed + 1);
}

export function toolShelf(b: Batcher, kit: FurnitureKit, cx: number, cz: number, width: number, seed: number): void {
  const depth = 0.45;
  const height = 2.0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.box(kit.steel, 0.035, height, 0.035, cx + sx * (width / 2 - 0.02), height / 2, cz + sz * (depth / 2 - 0.02));
  }
  const random = prng(seed);
  const bins = [kit.cardboard, kit.cardboard, kit.toolRed, kit.binderA, kit.plastic];
  for (let level = 0; level < 4; level += 1) {
    const y = 0.12 + level * 0.6;
    b.box(kit.steel, width, 0.025, depth, cx, y, cz);
    let x = cx - width / 2 + 0.05;
    while (x < cx + width / 2 - 0.25) {
      const w = 0.25 + random() * 0.25;
      const h = 0.15 + random() * 0.25;
      if (random() > 0.2) b.box(bins[Math.floor(random() * bins.length)], w - 0.03, h, depth * 0.8, x + w / 2, y + 0.0125 + h / 2, cz);
      x += w;
    }
  }
}

export function pegboard(b: Batcher, kit: FurnitureKit, cx: number, cz: number, width: number, seed: number): void {
  b.box(kit.pegboard, width, 0.9, 0.02, cx, 1.55, cz, { cast: false });
  const random = prng(seed);
  const tools = [kit.metal, kit.toolRed, kit.steel, kit.oak];
  for (let index = 0; index < Math.floor(width / 0.18); index += 1) {
    const x = cx - width / 2 + 0.12 + index * 0.18;
    const length = 0.15 + random() * 0.25;
    b.box(tools[index % tools.length], 0.03, length, 0.025, x, 1.75 - length / 2, cz + 0.025, { rz: (random() - 0.5) * 0.3, cast: false });
  }
}

export function sofa(b: Batcher, kit: FurnitureKit, cx: number, cz: number, ry: number): void {
  const local = b.within(transform(cx, 0, cz, 1, 1, 1, { ry }));
  local.box(kit.sofa, 1.9, 0.4, 0.85, 0, 0.2, 0);
  local.box(kit.sofa, 0.85, 0.14, 0.7, -0.44, 0.47, 0.06);
  local.box(kit.sofa, 0.85, 0.14, 0.7, 0.44, 0.47, 0.06);
  local.box(kit.sofa, 1.9, 0.5, 0.2, 0, 0.62, -0.33);
  local.box(kit.sofa, 0.18, 0.28, 0.85, -0.95, 0.54, 0);
  local.box(kit.sofa, 0.18, 0.28, 0.85, 0.95, 0.54, 0);
  local.box(kit.oak, 1.0, 0.04, 0.55, 0, 0.42, 0.95);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) local.box(kit.metal, 0.03, 0.4, 0.03, sx * 0.45, 0.2, 0.95 + sz * 0.23);
  }
}

export function glassOffice(b: Batcher, width: number, partitionX: number, frontZ: number, doorFrom: number, doorTo: number, halfDepth: number, height: number): void {
  const kit = buildingKit();
  const x = -width / 2 + partitionX;
  const pane = (x0: number, z0: number, x1: number, z1: number): void => {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    b.box(kit.glass, length, height - 0.08, 0.02, mx, height / 2, mz, { ry, cast: false });
    b.box(kit.frame, length, 0.05, 0.05, mx, 0.025, mz, { ry, cast: false });
    b.box(kit.frame, length, 0.05, 0.05, mx, height - 0.025, mz, { ry, cast: false });
  };
  pane(x, -halfDepth, x, doorFrom);
  pane(x, doorTo, x, frontZ);
  pane(-width / 2, frontZ, x, frontZ);
  for (const z of [doorFrom, doorTo, frontZ]) b.box(kit.frame, 0.06, height, 0.06, x, height / 2, z, { cast: false });
  b.box(kit.frame, 0.06, 0.08, doorTo - doorFrom, x, 2.3, (doorFrom + doorTo) / 2, { cast: false });
}
