import { Container, Graphics } from 'pixi.js';
import { SIDE_MARGIN, SKY_H } from './constants';
import { px } from './pixel';

type SkyPalette = {
  bands: readonly number[];
  skyline: number;
  skylineLit: number;
  orb: number;
  cloud: number;
  cloudAlpha: number;
  slab: number;
  roof: number;
  roofDark: number;
};

const DAY: SkyPalette = {
  bands: [0x6fbbe8, 0x86c7ee, 0x9fd3f2, 0xb9def5],
  skyline: 0x9cb3c7,
  skylineLit: 0xc6d6e3,
  orb: 0xffe08a,
  cloud: 0xffffff,
  cloudAlpha: 0.85,
  slab: 0x6b7078,
  roof: 0x8b9098,
  roofDark: 0x5d636b,
};

const NIGHT: SkyPalette = {
  bands: [0x0c1628, 0x122039, 0x182a47, 0x203455],
  skyline: 0x1a2537,
  skylineLit: 0xf2c14e,
  orb: 0xe8ecf4,
  cloud: 0x8a97ad,
  cloudAlpha: 0.22,
  slab: 0x2a2f36,
  roof: 0x4b5159,
  roofDark: 0x33383f,
};

const CLOUDS = [
  { x: 20, y: 6, speed: 2.2 },
  { x: 140, y: 12, speed: 1.4 },
  { x: 260, y: 4, speed: 1.8 },
];

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export class Backdrop {
  readonly root = new Container();

  private readonly sky = new Graphics();
  private readonly clouds: Graphics[] = [];
  private readonly beacon = new Graphics();
  private width = 0;

  constructor() {
    this.root.eventMode = 'none';
    this.root.addChild(this.sky);
    for (let index = 0; index < CLOUDS.length; index += 1) {
      const cloud = new Graphics();
      this.clouds.push(cloud);
      this.root.addChild(cloud);
    }
    this.root.addChild(this.beacon);
  }

  draw(width: number, gardenTop: number, dark: boolean): void {
    this.width = width;
    const palette = dark ? NIGHT : DAY;
    const left = -SIDE_MARGIN;
    const full = width + SIDE_MARGIN * 2;
    const g = this.sky;
    g.clear();

    const band = Math.ceil(SKY_H / palette.bands.length);
    palette.bands.forEach((color, index) => px(g, left, index * band, full, band, color));
    if (SIDE_MARGIN > 0) {
      const last = palette.bands[palette.bands.length - 1];
      px(g, left, SKY_H, SIDE_MARGIN, gardenTop - SKY_H, last);
      px(g, width, SKY_H, SIDE_MARGIN, gardenTop - SKY_H, last);
    }

    const orbX = Math.round(width * 0.12);
    g.circle(orbX, 9, 5).fill(palette.orb);
    if (dark) g.circle(orbX + 3, 7, 4).fill(palette.bands[1]);
    else g.circle(orbX, 9, 8).fill({ color: palette.orb, alpha: 0.25 });

    const random = seeded(7);
    for (let x = left; x < width + SIDE_MARGIN; ) {
      const w = 10 + Math.floor(random() * 18);
      const h = 6 + Math.floor(random() * 16);
      px(g, x, SKY_H - h, w, h, palette.skyline);
      for (let wy = SKY_H - h + 2; wy < SKY_H - 2; wy += 4) {
        for (let wx = x + 2; wx < x + w - 2; wx += 4) {
          if (random() < 0.3) px(g, wx, wy, 1, 1, palette.skylineLit, dark ? 0.8 : 0.6);
        }
      }
      if (SIDE_MARGIN > 0 && (x < 0 || x > width)) px(g, x, SKY_H, w, gardenTop - SKY_H, palette.skyline);
      x += w + Math.floor(random() * 6);
    }

    px(g, 0, SKY_H, width, gardenTop - SKY_H, palette.slab);
    px(g, 0, SKY_H - 3, width, 3, palette.roof);
    px(g, 0, SKY_H - 3, width, 1, palette.roofDark);
    const tankX = Math.round(width * 0.32);
    px(g, tankX + 2, SKY_H - 7, 1, 4, palette.roofDark);
    px(g, tankX + 11, SKY_H - 7, 1, 4, palette.roofDark);
    px(g, tankX, SKY_H - 16, 14, 9, palette.roof);
    px(g, tankX, SKY_H - 16, 14, 1, palette.roofDark);
    px(g, tankX + 1, SKY_H - 12, 12, 1, palette.roofDark);
    const antennaX = Math.round(width * 0.62);
    px(g, antennaX, SKY_H - 24, 1, 21, palette.roofDark);
    px(g, antennaX - 3, SKY_H - 18, 7, 1, palette.roofDark);
    px(g, antennaX - 2, SKY_H - 13, 5, 1, palette.roofDark);
    this.beacon.clear();
    px(this.beacon, antennaX - 1, SKY_H - 26, 3, 2, 0xff4d4d);

    this.clouds.forEach((cloud) => {
      cloud.clear();
      px(cloud, 4, 0, 10, 3, palette.cloud, palette.cloudAlpha);
      px(cloud, 0, 2, 22, 3, palette.cloud, palette.cloudAlpha);
      px(cloud, 8, -2, 6, 2, palette.cloud, palette.cloudAlpha);
    });
  }

  tick(seconds: number): void {
    const span = this.width + SIDE_MARGIN * 2 + 40;
    this.clouds.forEach((cloud, index) => {
      const { x, y, speed } = CLOUDS[index];
      cloud.position.set(Math.round(((x + seconds * speed) % span) - SIDE_MARGIN - 30), y);
    });
    this.beacon.visible = Math.floor(seconds / 0.9) % 2 === 0;
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
