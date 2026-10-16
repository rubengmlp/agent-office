import { Container, Graphics } from 'pixi.js';
import { ParkingLot, type Car } from '../parking';
import { buildCharacter, type CharacterParts } from '../sprites/sprites';
import {
  BAY_W,
  CAR_HOLD_S,
  CAR_LEAVE_S,
  CAR_QUICK_RETURN_S,
  CAR_RETURN_S,
  CHAR_W,
  FLOOR_GAP,
  GARDEN_BAY_Y,
  GARDEN_H,
  GARDEN_PATH_Y,
  GARDEN_ROAD_Y,
  SIDE_MARGIN,
} from './constants';
import type { Point } from './layout';
import { hashString, hsl, shade } from './palette';
import { px } from './pixel';

type GardenPalette = {
  grassA: number;
  grassB: number;
  path: number;
  pathEdge: number;
  hedge: number;
  hedgeDark: number;
  asphalt: number;
  marking: number;
  curb: number;
};

const DAY: GardenPalette = {
  grassA: 0x6fae4f,
  grassB: 0x66a348,
  path: 0xd8cbb0,
  pathEdge: 0xb9aa8c,
  hedge: 0x3f7d3a,
  hedgeDark: 0x2d5e2b,
  asphalt: 0x4a4f57,
  marking: 0xe8e4d8,
  curb: 0xa9adb3,
};

const NIGHT: GardenPalette = {
  grassA: 0x2f5a2c,
  grassB: 0x2b5428,
  path: 0x8c846f,
  pathEdge: 0x6f6856,
  hedge: 0x24482a,
  hedgeDark: 0x1a3720,
  asphalt: 0x2a2e34,
  marking: 0x9b988f,
  curb: 0x5d6168,
};

const FLOWERS = [0xf472b6, 0xfbbf24, 0xf87171, 0xa78bfa, 0xffffff];
const CAR_W = 28;
const LEAVE_OFF = 40;

function minmax(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

class CarSprite {
  readonly body = new Graphics();
  private readonly beam = new Graphics();
  private seed = -1;

  constructor(actors: Container) {
    this.body.eventMode = 'none';
    px(this.beam, CAR_W / 2, -7, 8, 2, 0xfff1a8, 0.45);
    px(this.beam, CAR_W / 2 - 2, -7, 2, 2, 0xfff1a8);
    this.body.addChild(this.beam);
    actors.addChild(this.body);
  }

  update(car: Car, home: number, bayY: number, roadY: number, exitX: number): void {
    if (car.seed !== this.seed) {
      this.seed = car.seed;
      this.draw(hsl((car.seed >>> 11) % 360, 0.55, 0.45));
    }
    this.body.visible = car.state !== 'away';
    let x = home;
    let y = bayY;
    let lit = false;
    const hold = CAR_HOLD_S / CAR_LEAVE_S;
    if (car.state === 'leaving') {
      lit = true;
      const q = car.progress <= hold ? 0 : (car.progress - hold) / (1 - hold);
      if (q < 1 / 3) {
        y = bayY + (roadY - bayY) * (q * 3);
      } else {
        const t = (q - 1 / 3) * 1.5;
        y = roadY;
        x = home + (exitX - home) * t * t;
      }
    } else if (car.state === 'arriving') {
      lit = true;
      const q = car.progress;
      if (q < 2 / 3) {
        const t = 1 - q * 1.5;
        y = roadY;
        x = home + (exitX - home) * t * t;
      } else {
        y = roadY + (bayY - roadY) * ((q - 2 / 3) * 3);
      }
    }
    this.beam.visible = lit;
    this.body.position.set(Math.round(x), Math.round(y));
    this.body.zIndex = y - 1;
  }

  destroy(): void {
    this.body.destroy({ children: true });
  }

  private draw(paint: number): void {
    const g = this.body;
    g.clear();
    const half = CAR_W / 2;
    px(g, -half + 1, 0, CAR_W - 2, 1, 0x000000, 0.25);
    px(g, -half, -8, CAR_W, 6, paint);
    px(g, -half, -8, CAR_W, 1, shade(paint, 0.25));
    px(g, -8, -12, 15, 4, shade(paint, -0.1));
    px(g, -7, -11, 6, 3, 0xbfe3f7);
    px(g, 0, -11, 6, 3, 0xbfe3f7);
    px(g, -1, -8, 1, 6, shade(paint, -0.3));
    px(g, half - 2, -7, 2, 2, 0xfff1a8);
    px(g, -half, -7, 1, 2, 0xff4d4d);
    px(g, -10, -3, 5, 3, 0x15161b);
    px(g, 5, -3, 5, 3, 0x15161b);
    px(g, -9, -2, 3, 1, 0x8a8f96);
    px(g, 6, -2, 3, 1, 0x8a8f96);
  }
}

type GardenerJob = 'mow' | 'prune';

class Gardener {
  readonly parts: CharacterParts;
  private readonly tool = new Graphics();
  private readonly sparks = new Graphics();
  private x: number;
  private dir = 1;
  private clock = 0;

  constructor(
    actors: Container,
    private readonly job: GardenerJob,
    seed: number,
  ) {
    this.parts = buildCharacter({ roleKind: 'skillwright', seed, saturation: 1 });
    this.parts.root.eventMode = 'none';
    this.x = 0;
    if (job === 'prune') this.dir = -1;
    if (job === 'mow') {
      px(this.tool, 0, 2, 8, 4, 0xc2410c);
      px(this.tool, 1, 1, 6, 1, 0x7c2d12);
      px(this.tool, 0, 6, 2, 1, 0x15161b);
      px(this.tool, 6, 6, 2, 1, 0x15161b);
      px(this.tool, -3, -4, 1, 6, 0x3a3f48);
      px(this.tool, -3, -4, 3, 1, 0x3a3f48);
    } else {
      px(this.sparks, 0, 0, 1, 1, 0xffffff);
      px(this.sparks, 3, -2, 1, 1, 0xffffff);
      px(this.sparks, 2, 2, 1, 1, 0xd9f99d);
      px(this.sparks, -2, 1, 1, 1, 0xd9f99d);
    }
    this.tool.eventMode = 'none';
    this.sparks.eventMode = 'none';
    actors.addChild(this.parts.root, this.tool, this.sparks);
  }

  update(dt: number, seconds: number, from: number, to: number, y: number): void {
    const p = this.parts;
    p.rig.position.set(0, 0);
    p.head.position.set(0, 0);
    p.legL.position.set(5, 18);
    p.legR.position.set(8, 18);
    p.armL.rotation = 0;
    p.armR.rotation = 0;
    if (this.job === 'mow') {
      this.clock += dt;
      this.x = minmax(this.x, from, to) + this.dir * 12 * dt;
      if (this.x >= to) this.dir = -1;
      if (this.x <= from) this.dir = 1;
      const swing = Math.sin(this.clock * 12);
      const stepLeft = Math.floor(this.clock * 6) % 2 === 0;
      p.legL.y = stepLeft ? 17 : 18;
      p.legR.y = stepLeft ? 18 : 17;
      p.rig.y = stepLeft ? -1 : 0;
      p.armL.rotation = -0.9 + swing * 0.1;
      p.armR.rotation = -0.9 - swing * 0.1;
      this.tool.position.set(Math.round(this.x + this.dir * 5), Math.round(y - 7));
      this.tool.scale.x = this.dir;
      this.tool.zIndex = y + 1;
    } else {
      this.x = from;
      p.armL.rotation = -1.6 + Math.sin(seconds * 9) * 0.35;
      p.armR.rotation = 1.3 - Math.sin(seconds * 9) * 0.35;
      this.sparks.visible = seconds % 0.8 < 0.18;
      this.sparks.position.set(Math.round(this.x - 10), Math.round(y - 14));
      this.sparks.zIndex = y + 1;
    }
    p.root.scale.x = this.dir;
    p.root.position.set(Math.round(this.x), Math.round(y));
    p.root.zIndex = y;
  }

  destroy(): void {
    this.parts.root.destroy({ children: true });
    this.tool.destroy();
    this.sparks.destroy();
  }
}

export class GardenScene {
  readonly ground = new Graphics();
  readonly lot = new ParkingLot(3, {
    leaveTime: CAR_LEAVE_S,
    returnAfter: CAR_RETURN_S,
    quickReturn: CAR_QUICK_RETURN_S,
    arriveTime: CAR_LEAVE_S,
  });

  private readonly cars: CarSprite[] = [];
  private readonly mower: Gardener;
  private readonly pruner: Gardener;
  private width = 0;
  private top = 0;
  private liftX = 0;
  private signature = '';

  constructor(
    backgrounds: Container,
    private readonly actors: Container,
  ) {
    this.ground.eventMode = 'none';
    backgrounds.addChild(this.ground);
    this.mower = new Gardener(actors, 'mow', hashString('gardener-mow'));
    this.pruner = new Gardener(actors, 'prune', hashString('gardener-prune'));
  }

  get gardenTop(): number {
    return this.top;
  }

  get pathY(): number {
    return this.top + GARDEN_PATH_Y;
  }

  private get bayY(): number {
    return this.top + GARDEN_BAY_Y;
  }

  private get roadY(): number {
    return this.top + GARDEN_ROAD_Y;
  }

  get bays(): number {
    return minmax(Math.floor(this.width / 2 / BAY_W), 3, 6);
  }

  bayX(bay: number): number {
    return this.width - 6 - BAY_W * (bay + 0.5);
  }

  spot(bay: number): Point {
    return { x: this.bayX(bay) - 7, y: this.bayY };
  }

  gate(): Point {
    return { x: this.width + SIDE_MARGIN + CHAR_W, y: this.pathY };
  }

  contains(point: Point): boolean {
    return point.y >= this.top;
  }

  update(width: number, gardenTop: number, liftX: number, dark: boolean): void {
    this.width = width;
    this.top = gardenTop;
    this.liftX = liftX;
    this.lot.resize(this.bays);
    while (this.cars.length < this.lot.size) this.cars.push(new CarSprite(this.actors));
    while (this.cars.length > this.lot.size) this.cars.pop()?.destroy();
    const signature = [width, gardenTop, liftX, dark].join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.draw(dark ? NIGHT : DAY);
  }

  tick(dt: number, seconds: number): void {
    this.lot.tick(dt);
    const exitX = this.width + SIDE_MARGIN + LEAVE_OFF;
    this.lot.cars.forEach((car, index) => this.cars[index]?.update(car, this.bayX(car.bay), this.bayY, this.roadY, exitX));
    const lawnEnd = this.bayX(this.bays - 1) - BAY_W / 2 - 20;
    this.mower.update(dt, seconds, 12, Math.max(24, lawnEnd), this.top + 56);
    this.pruner.update(dt, seconds, Math.max(20, Math.round(lawnEnd * 0.55)) + 10, 0, this.top + 44);
  }

  destroy(): void {
    for (const car of this.cars) car.destroy();
    this.cars.length = 0;
    this.mower.destroy();
    this.pruner.destroy();
    this.ground.destroy();
  }

  private draw(palette: GardenPalette): void {
    const g = this.ground;
    g.clear();
    const top = this.top;
    const left = -SIDE_MARGIN;
    const full = this.width + SIDE_MARGIN * 2;
    const right = this.width + SIDE_MARGIN;

    px(g, left, top - FLOOR_GAP, full, GARDEN_H + FLOOR_GAP, palette.grassA);
    for (let x = left; x < right; x += 16) px(g, x, top, Math.min(8, right - x), GARDEN_H, palette.grassB);

    const roadTop = top + GARDEN_ROAD_Y - 8;
    px(g, left, roadTop - 2, full, 2, palette.curb);
    px(g, left, roadTop, full, 16, palette.asphalt);
    for (let x = left + 4; x < right; x += 16) px(g, x, roadTop + 7, 8, 1, palette.marking);
    px(g, left, roadTop + 16, full, 1, palette.curb);

    const bays = this.bays;
    const lotLeft = this.bayX(bays - 1) - BAY_W / 2;
    const lotRight = this.bayX(0) + BAY_W / 2;
    px(g, lotLeft, top + 34, lotRight - lotLeft, roadTop - top - 34, palette.asphalt);
    px(g, lotLeft, top + 33, lotRight - lotLeft, 1, palette.curb);
    for (let bay = 0; bay <= bays; bay += 1) {
      const x = Math.round(this.bayX(bay) + BAY_W / 2);
      px(g, x, top + 36, 1, GARDEN_BAY_Y - 34, palette.marking);
    }

    const pathTop = this.pathY - 3;
    const pathLeft = lotLeft - 10;
    px(g, pathLeft, pathTop, right - pathLeft, 6, palette.path);
    px(g, pathLeft, pathTop, right - pathLeft, 1, palette.pathEdge);
    px(g, pathLeft, pathTop + 5, right - pathLeft, 1, palette.pathEdge);
    for (let x = pathLeft + 6; x < right; x += 9) px(g, x, pathTop + 1, 1, 4, palette.pathEdge);
    const door = Math.round(this.liftX);
    px(g, door - 4, top, 8, pathTop - top, palette.path);
    px(g, door - 4, top, 1, pathTop - top, palette.pathEdge);
    px(g, door + 3, top, 1, pathTop - top, palette.pathEdge);

    px(g, door - 8, top - FLOOR_GAP, 16, 14, 0x2e333b);
    px(g, door - 6, top - FLOOR_GAP + 2, 12, 12, 0x1b1e24);
    px(g, door - 6, top - FLOOR_GAP + 2, 12, 1, 0xfff6e6, 0.6);
    px(g, door - 1, top - FLOOR_GAP - 1, 2, 1, 0x5fd68a);

    const hedgeEnd = Math.max(40, pathLeft - 16);
    for (let x = 6; x + 18 <= hedgeEnd; x += 22) {
      px(g, x, top + 4, 18, 8, palette.hedge);
      px(g, x, top + 10, 18, 2, palette.hedgeDark);
      px(g, x + 2, top + 3, 14, 1, palette.hedge);
    }
    const pruneHedge = Math.max(20, Math.round((this.bayX(bays - 1) - BAY_W / 2 - 20) * 0.55));
    px(g, 6, top + 36, pruneHedge - 6, 7, palette.hedge);
    px(g, 6, top + 41, pruneHedge - 6, 2, palette.hedgeDark);
    for (let x = 8, index = 0; x + 4 < hedgeEnd; x += 7, index += 1) {
      const color = FLOWERS[index % FLOWERS.length];
      px(g, x, top + 17 + (index % 2) * 2, 2, 2, color);
      px(g, x + 1, top + 20 + (index % 2) * 2, 1, 2, palette.hedgeDark);
    }
    for (const x of [hedgeEnd + 4]) {
      if (x + 10 > pathLeft) continue;
      px(g, x + 3, top + 6, 2, 10, 0x6b4a2b);
      g.circle(x + 4, top + 4, 6).fill(palette.hedge);
      g.circle(x + 2, top + 2, 3).fill(shade(palette.hedge, 0.12));
    }
  }
}
