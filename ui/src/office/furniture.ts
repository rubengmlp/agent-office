import { Container, Graphics } from 'pixi.js';
import { DESK_SEAT_X, LEAD_SEAT_X } from './constants';
import { shade, type FloorPalette } from './palette';
import { bitmap, px } from './pixel';

export type DeskParts = {
  back: Graphics;
  front: Container;
  glow: Graphics;
  width: number;
};

export type MeetingParts = {
  back: Graphics;
  front: Graphics;
};

const CHAIR = 0x3b3f4a;
const CHAIR_HIGHLIGHT = 0x4a4f5c;
const WOOD_TOP = 0xc9a06b;
const WOOD_EDGE = 0xdcb883;
const WOOD_FRONT = 0x8a6239;
const WOOD_BASE = 0x5b3f23;
const WOOD_DRAWER = 0x7a5530;

export function buildDesk(width: number, lead: boolean): DeskParts {
  const seatX = lead ? LEAD_SEAT_X : DESK_SEAT_X;

  const back = new Graphics();
  px(back, seatX - 7, 12, 14, 14, CHAIR);
  px(back, seatX - 6, 13, 12, 2, CHAIR_HIGHLIGHT);

  const body = new Graphics();
  px(body, 2, 24, width - 4, 6, WOOD_TOP);
  px(body, 2, 24, width - 4, 1, WOOD_EDGE);
  px(body, 2, 30, width - 4, 9, WOOD_FRONT);
  px(body, 2, 38, width - 4, 1, WOOD_BASE);
  px(body, 4, 32, 10, 5, WOOD_DRAWER);
  px(body, 8, 34, 2, 1, 0xd9c28f);
  px(body, seatX - 6, 24, 12, 2, 0x2f343c);
  px(body, seatX - 5, 25, 10, 1, 0x4b525e);

  const monitorX = width - 15;
  if (lead) {
    px(body, 28, 22, 4, 3, 0x3a3f48);
    px(body, 25, 13, 11, 9, 0x2b2f36);
    px(body, 25, 13, 11, 1, 0x4a505c);
    px(body, 36, 32, 10, 5, WOOD_DRAWER);
    px(body, 40, 34, 2, 1, 0xd9c28f);
    px(body, 3, 17, 1, 7, 0x6b7380);
    px(body, 2, 15, 5, 2, 0xf2c14e);
    px(body, 19, 32, 14, 4, 0xd9b45a);
    px(body, 21, 34, 10, 1, 0x7a5a1a);
  }
  px(body, monitorX + 4, 22, 4, 3, 0x3a3f48);
  px(body, monitorX, 12, 13, 10, 0x2b2f36);
  px(body, monitorX, 12, 13, 1, 0x4a505c);
  px(body, monitorX + 6, 20, 1, 1, 0x5fd68a);

  const glow = new Graphics();
  px(glow, monitorX - 2, 10, 17, 14, 0x6fd6ff, 0.25);
  px(glow, monitorX, 24, 13, 2, 0x6fd6ff, 0.35);
  glow.visible = false;

  const front = new Container();
  front.addChild(glow, body);
  return { back, front, glow, width };
}

export function buildMeetingFurniture(): MeetingParts {
  const back = new Graphics();
  for (const centre of [11, 33]) {
    px(back, centre - 7, -12, 14, 14, CHAIR);
    px(back, centre - 6, -11, 12, 2, CHAIR_HIGHLIGHT);
  }
  px(back, -12, 14, 8, 4, CHAIR);
  px(back, 48, 14, 8, 4, CHAIR);

  const front = new Graphics();
  px(front, 0, 0, 44, 6, WOOD_TOP);
  px(front, 0, 0, 44, 1, WOOD_EDGE);
  px(front, 1, 6, 42, 9, WOOD_FRONT);
  px(front, 1, 14, 42, 1, WOOD_BASE);
  px(front, 8, 2, 5, 3, 0xffffff);
  px(front, 15, 2, 3, 3, 0xe8edf3);
  px(front, 28, 2, 3, 3, 0xf4f1ea);
  px(front, 34, 3, 4, 2, 0x5fd68a, 0.8);
  return { back, front };
}

export function drawWindow(g: Graphics, x: number, y: number, palette: FloorPalette): void {
  px(g, x - 1, y + 14, 28, 2, shade(palette.wall, 0.3));
  px(g, x, y, 26, 14, palette.trim);
  px(g, x + 1, y + 1, 24, 12, palette.window);
  px(g, x + 12, y + 1, 2, 12, palette.trim);
  px(g, x + 2, y + 2, 4, 1, 0xffffff, 0.45);
}

const FLASK_BIG = [
  '...##...',
  '...##...',
  '...##...',
  '..#ll#..',
  '.#llll#.',
  '#llllll#',
  '########',
] as const;

export function drawLabBench(g: Graphics, x: number, y: number): void {
  px(g, x, y + 8, 58, 5, 0xd9dde3);
  px(g, x, y + 8, 58, 1, 0xf0f2f5);
  px(g, x, y + 13, 58, 9, 0x8f98a3);
  px(g, x, y + 21, 58, 1, 0x646c77);
  for (const offset of [2, 21, 40]) {
    px(g, x + offset, y + 15, 16, 5, 0x7b848f);
    px(g, x + offset + 7, y + 17, 2, 1, 0xd9dde3);
  }
  bitmap(g, FLASK_BIG, x + 4, y + 1, { '#': 0xdff1ff, l: 0x5fd68a });
  px(g, x + 24, y + 4, 12, 4, 0x5a636e);
  [0x5fd68a, 0xff8a65, 0x64b5f6, 0xfff176].forEach((color, index) => px(g, x + 25 + index * 3, y + 1, 2, 5, color));
  px(g, x + 42, y, 14, 9, 0x39414c);
  px(g, x + 44, y + 2, 10, 5, 0x1b2a22);
  px(g, x + 45, y + 3, 5, 1, 0x5fd68a);
  px(g, x + 45, y + 5, 3, 1, 0x5fd68a);
}

export function drawLabLamp(g: Graphics, x: number, y: number): void {
  px(g, x + 52, y + 10, 3, 2, 0x5fd68a);
  px(g, x + 51, y + 9, 5, 4, 0x5fd68a, 0.35);
}

export function drawCoffee(g: Graphics, x: number, y: number): void {
  px(g, x, y, 16, 24, 0x444b57);
  px(g, x + 1, y + 1, 14, 6, 0x2b3038);
  px(g, x + 3, y + 9, 10, 8, 0x1d2127);
  px(g, x + 5, y + 17, 6, 5, 0xf4f1ea);
  px(g, x + 6, y + 18, 4, 1, 0x6b3e26);
  px(g, x + 1, y + 22, 14, 2, 0x2b3038);
}

export function drawCoffeeLed(g: Graphics, x: number, y: number): void {
  px(g, x + 11, y + 3, 2, 2, 0xff5252);
}

export function drawLift(g: Graphics, x: number, y: number, w: number, h: number, walkY: number): void {
  px(g, x, y, w, h, 0x1d2127, 0.5);
  px(g, x + 1, y + 1, w - 2, h - 2, 0x2b3038, 0.5);
  px(g, x + 1, walkY - 14, w - 2, 18, 0x9aa3ae);
  px(g, x + w / 2, walkY - 14, 1, 18, 0x6b7380);
  px(g, x + 3, walkY - 19, w - 6, 3, 0x1b1e24);
  px(g, x + w / 2 - 1, walkY - 18, 2, 1, 0x5fd68a);
}

export function drawRug(g: Graphics, x: number, y: number, w: number, h: number, palette: FloorPalette): void {
  px(g, x, y, w, h, palette.rug);
  px(g, x, y, w, 1, palette.rugEdge);
  px(g, x, y + h - 1, w, 1, palette.rugEdge);
  px(g, x, y, 1, h, palette.rugEdge);
  px(g, x + w - 1, y, 1, h, palette.rugEdge);
  px(g, x + 3, y + 3, w - 6, 1, shade(palette.rug, 0.15));
  px(g, x + 3, y + h - 4, w - 6, 1, shade(palette.rug, 0.15));
}
