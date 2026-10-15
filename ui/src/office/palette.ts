import type { FloorView, Stack } from '../types';

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hsl(h: number, s: number, l: number): number {
  const hue = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (offset: number): number => {
    let t = hue + offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const r = Math.round(channel(1 / 3) * 255);
  const g = Math.round(channel(0) * 255);
  const b = Math.round(channel(-1 / 3) * 255);
  return (r << 16) | (g << 8) | b;
}

function channels(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

function pack(r: number, g: number, b: number): number {
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export function mix(a: number, b: number, t: number): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return pack(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

export function shade(color: number, amount: number): number {
  return amount >= 0 ? mix(color, 0xffffff, amount) : mix(color, 0x000000, -amount);
}

export function grey(color: number, amount: number): number {
  const [r, g, b] = channels(color);
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return mix(color, pack(luma, luma, luma), amount);
}

export type FloorPalette = {
  wall: number;
  wallDark: number;
  trim: number;
  floorA: number;
  floorB: number;
  rug: number;
  rugEdge: number;
  plate: number;
  plateText: number;
  window: number;
  accent: number;
  glass: boolean;
  observed: boolean;
};

const STACK_HUE: Record<Stack, number> = {
  flutter: 205,
  laravel: 8,
  node: 128,
  generic: 268,
};

const DIRECCION: FloorPalette = {
  wall: 0xcfe6f3,
  wallDark: 0xaed0e3,
  trim: 0x7aa7c2,
  floorA: 0x9a7b5d,
  floorB: 0x8f7154,
  rug: 0x35506b,
  rugEdge: 0x28405a,
  plate: 0x1d2a38,
  plateText: 0xe8f1f8,
  window: 0xbfe3f7,
  accent: 0x7dd3fc,
  glass: true,
  observed: false,
};

const OBSERVED: FloorPalette = {
  wall: 0x5d6168,
  wallDark: 0x4b4f55,
  trim: 0x35383d,
  floorA: 0x6c7075,
  floorB: 0x65696e,
  rug: 0x50545a,
  rugEdge: 0x45484d,
  plate: 0x2a2d31,
  plateText: 0xb9bec5,
  window: 0x7d8791,
  accent: 0x8a9099,
  glass: false,
  observed: true,
};

export function floorPalette(floor: FloorView): FloorPalette {
  if (floor.kind === 'direccion') return DIRECCION;
  if (floor.kind === 'observed') return OBSERVED;
  const hue = STACK_HUE[floor.stack];
  return {
    wall: hsl(hue, 0.38, 0.46),
    wallDark: hsl(hue, 0.38, 0.36),
    trim: hsl(hue, 0.3, 0.26),
    floorA: 0xcbb99c,
    floorB: 0xc2b093,
    rug: hsl(hue, 0.42, 0.38),
    rugEdge: hsl(hue, 0.42, 0.3),
    plate: hsl(hue, 0.4, 0.2),
    plateText: 0xffffff,
    window: 0xa9d6f0,
    accent: hsl(hue, 0.6, 0.58),
    glass: false,
    observed: false,
  };
}
