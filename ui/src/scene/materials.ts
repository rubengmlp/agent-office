import {
  CanvasTexture,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type ColorRepresentation,
  type MeshStandardMaterialParameters,
} from 'three';
import { t } from '../i18n';
import type { FloorKind, FloorView, Stack } from '../types';

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mute(color: Color, amount: number): Color {
  const luma = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  return color.clone().lerp(new Color(luma, luma, luma), amount);
}

export function cssColor(color: Color): string {
  return `#${color.getHexString()}`;
}

function canvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const element = document.createElement('canvas');
  element.width = size;
  element.height = size;
  const ctx = element.getContext('2d');
  if (!ctx) throw new Error(t('scene.noCanvas'));
  return { canvas: element, ctx };
}

function tileTexture(element: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(element);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function rgb(r: number, g: number, b: number): string {
  const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
  return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
}

function woodTexture(base: [number, number, number], seed: number): CanvasTexture {
  const size = 512;
  const { canvas: element, ctx } = canvas(size);
  const random = prng(seed);
  const plank = 64;
  for (let row = 0; row < size / plank; row += 1) {
    let x = -Math.floor(random() * 300);
    while (x < size) {
      const length = 220 + Math.floor(random() * 260);
      const shade = 0.86 + random() * 0.24;
      ctx.fillStyle = rgb(base[0] * shade, base[1] * shade, base[2] * shade);
      ctx.fillRect(x, row * plank, length, plank);
      for (let line = 0; line < 9; line += 1) {
        const y = row * plank + 4 + random() * (plank - 8);
        ctx.strokeStyle = `rgba(60,35,15,${0.05 + random() * 0.1})`;
        ctx.lineWidth = 1 + random() * 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + length * 0.3, y + random() * 6 - 3, x + length * 0.7, y + random() * 6 - 3, x + length, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,24,10,0.55)';
      ctx.fillRect(x, row * plank, 2, plank);
      x += length;
    }
    ctx.fillStyle = 'rgba(40,24,10,0.6)';
    ctx.fillRect(0, row * plank, size, 2);
  }
  return tileTexture(element);
}

function speckleTexture(base: [number, number, number], spread: number, seed: number, blotches: number): CanvasTexture {
  const size = 512;
  const { canvas: element, ctx } = canvas(size);
  const random = prng(seed);
  ctx.fillStyle = rgb(base[0], base[1], base[2]);
  ctx.fillRect(0, 0, size, size);
  for (let index = 0; index < blotches; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = 30 + random() * 90;
    const tone = (random() - 0.5) * spread * 1.4;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${tone > 0 ? '255,255,255' : '0,0,0'},${Math.abs(tone) / 255})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  for (let index = 0; index < 9000; index += 1) {
    const tone = (random() - 0.5) * spread;
    ctx.fillStyle = rgb(base[0] + tone, base[1] + tone, base[2] + tone);
    ctx.fillRect(random() * size, random() * size, 1 + random() * 1.5, 1 + random() * 1.5);
  }
  return tileTexture(element);
}

let codeTextureCache: CanvasTexture | null = null;

export function codeTexture(): CanvasTexture {
  if (codeTextureCache) return codeTextureCache;
  const element = document.createElement('canvas');
  element.width = 256;
  element.height = 160;
  const ctx = element.getContext('2d');
  if (!ctx) throw new Error(t('scene.noCanvas'));
  const random = prng(7);
  ctx.fillStyle = '#0d1524';
  ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = '#16233a';
  ctx.fillRect(0, 0, 40, 160);
  const palette = ['#7dd3fc', '#f472b6', '#a78bfa', '#5fd68a', '#fbbf24', '#e2e8f0'];
  for (let line = 0; line < 15; line += 1) {
    let x = 48 + Math.floor(random() * 4) * 10;
    const y = 8 + line * 10;
    ctx.fillStyle = '#334155';
    ctx.fillRect(10, y, 18, 4);
    const tokens = 1 + Math.floor(random() * 5);
    for (let token = 0; token < tokens; token += 1) {
      const width = 10 + Math.floor(random() * 40);
      ctx.fillStyle = palette[Math.floor(random() * palette.length)];
      ctx.fillRect(x, y, width, 4);
      x += width + 6;
      if (x > 240) break;
    }
  }
  const texture = new CanvasTexture(element);
  texture.colorSpace = SRGBColorSpace;
  codeTextureCache = texture;
  return texture;
}

export function std(color: ColorRepresentation, roughness: number, metalness = 0, extra: MeshStandardMaterialParameters = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

export type BuildingKit = {
  concrete: MeshStandardMaterial;
  cladding: MeshStandardMaterial;
  claddingDark: MeshStandardMaterial;
  annexCladding: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  windowGlass: MeshStandardMaterial;
  frame: MeshStandardMaterial;
  skirting: MeshStandardMaterial;
  ceilingPanel: MeshStandardMaterial;
  roof: MeshStandardMaterial;
  plinth: MeshStandardMaterial;
  ground: MeshStandardMaterial;
  sidewalk: MeshStandardMaterial;
  liftPad: MeshStandardMaterial;
  rooftop: MeshStandardMaterial;
  chrome: MeshStandardMaterial;
};

let buildingKitCache: BuildingKit | null = null;

export function buildingKit(): BuildingKit {
  if (buildingKitCache) return buildingKitCache;
  buildingKitCache = {
    concrete: std(0xb9bcc0, 0.85),
    cladding: std(0xd9d6cf, 0.7),
    claddingDark: std(0x50555d, 0.6, 0.2),
    annexCladding: std(0x8c7a68, 0.8),
    glass: std(0xdff1fb, 0.04, 0, {
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: DoubleSide,
      envMapIntensity: 1.6,
    }),
    windowGlass: std(0x9cc6e2, 0.05, 0, {
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      emissive: 0x9fc9ea,
      emissiveIntensity: 0.35,
      envMapIntensity: 1.4,
    }),
    frame: std(0x2e333b, 0.45, 0.6),
    skirting: std(0x3a3f47, 0.6),
    ceilingPanel: std(0xffffff, 0.4, 0, { emissive: 0xfff6e6, emissiveIntensity: 1.1 }),
    roof: std(0x6b7078, 0.9),
    plinth: std(0x9aa0a6, 0.9),
    ground: std(0x2a2f36, 0.95),
    sidewalk: std(0x7d838b, 0.9),
    liftPad: std(0x9aa3ad, 0.35, 0.7),
    rooftop: std(0x8b9098, 0.55, 0.4),
    chrome: std(0xd7dbe0, 0.22, 0.95),
  };
  return buildingKitCache;
}

export type GardenKit = {
  grass: MeshStandardMaterial;
  soil: MeshStandardMaterial;
  asphalt: MeshStandardMaterial;
  marking: MeshStandardMaterial;
  paving: MeshStandardMaterial;
  hedge: MeshStandardMaterial;
  trunk: MeshStandardMaterial;
  leaf: MeshStandardMaterial;
  leafDark: MeshStandardMaterial;
  flowers: MeshStandardMaterial[];
  paints: MeshStandardMaterial[];
  carGlass: MeshStandardMaterial;
  tyre: MeshStandardMaterial;
  headlight: MeshStandardMaterial;
  taillight: MeshStandardMaterial;
  lamp: MeshStandardMaterial;
  pole: MeshStandardMaterial;
  blocks: MeshStandardMaterial[];
};

let gardenKitCache: GardenKit | null = null;

export function gardenKit(): GardenKit {
  if (gardenKitCache) return gardenKitCache;
  gardenKitCache = {
    grass: std(0x5f9a45, 0.95),
    soil: std(0x5a3f2b, 1),
    asphalt: std(0x3a3e45, 0.92),
    marking: std(0xe8e4d8, 0.7),
    paving: std(0xcdbf9f, 0.9),
    hedge: std(0x3b7436, 0.85),
    trunk: std(0x6b4a2b, 0.9),
    leaf: std(0x4b8a3c, 0.75),
    leafDark: std(0x2f6630, 0.8),
    flowers: [std(0xf472b6, 0.6), std(0xfbbf24, 0.6), std(0xf87171, 0.6)],
    paints: [0xc0392b, 0x2f6fd6, 0x2f9e6a, 0xe0b13a, 0xf4f4f4, 0x2b2f36].map((color) => std(color, 0.35, 0.4)),
    carGlass: std(0x1d2a38, 0.15, 0.3),
    tyre: std(0x15161b, 0.85),
    headlight: std(0xfff6d8, 0.3, 0, { emissive: 0xfff1b8, emissiveIntensity: 0 }),
    taillight: std(0xff3b30, 0.4, 0, { emissive: 0xff2020, emissiveIntensity: 0 }),
    lamp: std(0xfff6e6, 0.4, 0, { emissive: 0xffe9c2, emissiveIntensity: 0.6 }),
    pole: std(0x2e333b, 0.5, 0.6),
    blocks: [0x8d949c, 0x9aa1a8, 0x7f868e].map((color) => std(color, 0.95)),
  };
  return gardenKitCache;
}

export function applyTheme(dark: boolean): void {
  const kit = buildingKit();
  kit.ground.color.set(dark ? 0x23282f : 0xc3cad2);
  kit.sidewalk.color.set(dark ? 0x5b6169 : 0xe2e6ea);
  const garden = gardenKit();
  garden.grass.color.set(dark ? 0x2f5a2c : 0x5f9a45);
  garden.asphalt.color.set(dark ? 0x25282d : 0x3a3e45);
  garden.lamp.emissiveIntensity = dark ? 1.6 : 0.6;
  garden.blocks.forEach((block, index) => block.color.set(dark ? [0x2c323b, 0x323943, 0x272c34][index] : [0x8d949c, 0x9aa1a8, 0x7f868e][index]));
}

export type FurnitureKit = {
  laminate: MeshStandardMaterial;
  birch: MeshStandardMaterial;
  walnut: MeshStandardMaterial;
  oak: MeshStandardMaterial;
  butcher: MeshStandardMaterial;
  metal: MeshStandardMaterial;
  chrome: MeshStandardMaterial;
  steel: MeshStandardMaterial;
  plastic: MeshStandardMaterial;
  keyboard: MeshStandardMaterial;
  fabric: MeshStandardMaterial;
  leather: MeshStandardMaterial;
  ceramic: MeshStandardMaterial;
  terracotta: MeshStandardMaterial;
  leaf: MeshStandardMaterial;
  leafDark: MeshStandardMaterial;
  soil: MeshStandardMaterial;
  paper: MeshStandardMaterial;
  cardboard: MeshStandardMaterial;
  binderA: MeshStandardMaterial;
  binderB: MeshStandardMaterial;
  binderC: MeshStandardMaterial;
  epoxy: MeshStandardMaterial;
  cabinet: MeshStandardMaterial;
  glassware: MeshStandardMaterial;
  liquid: MeshStandardMaterial;
  toolRed: MeshStandardMaterial;
  rubber: MeshStandardMaterial;
  lampShade: MeshStandardMaterial;
  ledRed: MeshStandardMaterial;
  ledGreen: MeshStandardMaterial;
  brass: MeshStandardMaterial;
  pegboard: MeshStandardMaterial;
  sofa: MeshStandardMaterial;
  whiteboard: MeshStandardMaterial;
};

const furnitureKits = new Map<boolean, FurnitureKit>();

export function furnitureKit(muted: boolean): FurnitureKit {
  const cached = furnitureKits.get(muted);
  if (cached) return cached;
  const m = (color: ColorRepresentation, roughness: number, metalness = 0, extra: MeshStandardMaterialParameters = {}): MeshStandardMaterial => {
    const material = std(color, roughness, metalness, extra);
    if (muted) material.color.copy(mute(material.color, 0.75));
    if (muted && material.emissive.getHex() !== 0) material.emissive.copy(mute(material.emissive, 0.75));
    return material;
  };
  const kit: FurnitureKit = {
    laminate: m(0xe9e5dc, 0.5),
    birch: m(0xd8c29c, 0.55),
    walnut: m(0x5e3f2a, 0.5),
    oak: m(0xb08457, 0.55),
    butcher: m(0xc49a6c, 0.6),
    metal: m(0x2b2f36, 0.42, 0.65),
    chrome: m(0xd7dbe0, 0.22, 0.95),
    steel: m(0xa9b0b8, 0.35, 0.85),
    plastic: m(0x17191e, 0.4),
    keyboard: m(0x2a2d33, 0.55),
    fabric: m(0x3c4556, 0.9),
    leather: m(0x2b211c, 0.55),
    ceramic: m(0xf1efe9, 0.35),
    terracotta: m(0xb5653a, 0.8),
    leaf: m(0x3f7d3a, 0.65),
    leafDark: m(0x2d5e2b, 0.7),
    soil: m(0x3b2a1f, 1),
    paper: m(0xf7f5ef, 0.85),
    cardboard: m(0xb48a5a, 0.9),
    binderA: m(0x2f5fe0, 0.6),
    binderB: m(0xd94b3d, 0.6),
    binderC: m(0x2f9e6a, 0.6),
    epoxy: m(0xe8edf1, 0.3),
    cabinet: m(0x9aa3ad, 0.5, 0.3),
    glassware: m(0xe6f4ff, 0.05, 0, { transparent: true, opacity: 0.35, depthWrite: false }),
    liquid: m(0x5fd68a, 0.2, 0, { emissive: 0x2f8f55, emissiveIntensity: 0.6 }),
    toolRed: m(0xb23a32, 0.45, 0.2),
    rubber: m(0x1f2226, 0.85),
    lampShade: m(0xf4ecd8, 0.6, 0, { emissive: 0xffe9c2, emissiveIntensity: 0.9 }),
    ledRed: m(0xff4040, 0.4, 0, { emissive: 0xff2020, emissiveIntensity: 2.2 }),
    ledGreen: m(0x40ff80, 0.4, 0, { emissive: 0x20ff60, emissiveIntensity: 1.8 }),
    brass: m(0xb08d57, 0.35, 0.9),
    pegboard: m(0xc8b08a, 0.85),
    sofa: m(0x6b7a8f, 0.9),
    whiteboard: m(0xf7f9fb, 0.25),
  };
  furnitureKits.set(muted, kit);
  return kit;
}

export type FloorStyle = {
  kind: FloorKind;
  muted: boolean;
  glass: boolean;
  paint: MeshStandardMaterial;
  floor: MeshStandardMaterial;
  accent: MeshStandardMaterial;
  accentCss: string;
  floorTile: number;
};

const STACK_HUE: Record<Stack, number> = { flutter: 205, laravel: 8, node: 128, generic: 268 };

const floorStyles = new Map<string, FloorStyle>();
const textures = new Map<string, CanvasTexture>();

function texture(key: string, build: () => CanvasTexture): CanvasTexture {
  const cached = textures.get(key);
  if (cached) return cached;
  const created = build();
  textures.set(key, created);
  return created;
}

function hsl(h: number, s: number, l: number): Color {
  return new Color().setHSL((((h % 360) + 360) % 360) / 360, s, l, SRGBColorSpace);
}

export function floorStyle(floor: FloorView): FloorStyle {
  const stack: Stack = floor.stack in STACK_HUE ? floor.stack : 'generic';
  const key = floor.kind === 'managed' ? `managed|${stack}` : floor.kind;
  const cached = floorStyles.get(key);
  if (cached) return cached;
  let style: FloorStyle;
  switch (floor.kind) {
    case 'direccion': {
      const carpet = texture('carpet', () => speckleTexture([58, 68, 84], 26, 11, 12));
      const accent = new Color(0x7dd3fc);
      style = {
        kind: floor.kind,
        muted: false,
        glass: true,
        paint: std(0xe7edf2, 0.8),
        floor: std(0xffffff, 0.95, 0, { map: carpet }),
        accent: std(accent, 0.4, 0.1),
        accentCss: cssColor(accent),
        floorTile: 1.6,
      };
      break;
    }
    case 'redaccion': {
      const wood = texture('walnut', () => woodTexture([128, 86, 54], 21));
      const accent = new Color(0xd4a35a);
      style = {
        kind: floor.kind,
        muted: false,
        glass: false,
        paint: std(0xefe2cc, 0.85),
        floor: std(0xffffff, 0.6, 0, { map: wood }),
        accent: std(accent, 0.45, 0.2),
        accentCss: cssColor(accent),
        floorTile: 2.2,
      };
      break;
    }
    case 'mantenimiento': {
      const concrete = texture('epoxy', () => speckleTexture([118, 128, 122], 30, 31, 22));
      const accent = new Color(0xf59e0b);
      style = {
        kind: floor.kind,
        muted: false,
        glass: false,
        paint: std(0xbdb6aa, 0.9),
        floor: std(0xffffff, 0.55, 0, { map: concrete }),
        accent: std(accent, 0.5, 0.1),
        accentCss: cssColor(accent),
        floorTile: 3,
      };
      break;
    }
    case 'observed': {
      const concrete = texture('concrete', () => speckleTexture([132, 135, 139], 28, 41, 26));
      const accent = new Color(0x8a9099);
      style = {
        kind: floor.kind,
        muted: true,
        glass: false,
        paint: std(0x9b9fa5, 0.9),
        floor: std(0xffffff, 0.85, 0, { map: concrete }),
        accent: std(accent, 0.6),
        accentCss: cssColor(accent),
        floorTile: 3,
      };
      break;
    }
    default: {
      const hue = STACK_HUE[stack];
      const wood = texture('oak', () => woodTexture([196, 160, 116], 51));
      const accent = hsl(hue, 0.6, 0.55);
      style = {
        kind: floor.kind,
        muted: false,
        glass: false,
        paint: std(hsl(hue, 0.3, 0.82), 0.85),
        floor: std(0xffffff, 0.6, 0, { map: wood }),
        accent: std(accent, 0.45, 0.1),
        accentCss: cssColor(accent),
        floorTile: 2.2,
      };
    }
  }
  floorStyles.set(key, style);
  return style;
}

export function basic(color: ColorRepresentation, opacity = 1): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
}

export function disposeSharedMaterials(): void {
  const all: MeshStandardMaterial[] = [];
  if (buildingKitCache) all.push(...Object.values(buildingKitCache));
  if (gardenKitCache) {
    const { flowers, paints, blocks, ...single } = gardenKitCache;
    all.push(...Object.values(single), ...flowers, ...paints, ...blocks);
  }
  for (const kit of furnitureKits.values()) all.push(...Object.values(kit));
  for (const style of floorStyles.values()) all.push(style.paint, style.floor, style.accent);
  for (const material of all) material.dispose();
  for (const item of textures.values()) item.dispose();
  codeTextureCache?.dispose();
  codeTextureCache = null;
  textures.clear();
  floorStyles.clear();
  furnitureKits.clear();
  buildingKitCache = null;
  gardenKitCache = null;
}
