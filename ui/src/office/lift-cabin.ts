import { Graphics, type Container } from 'pixi.js';
import type { LiftController } from '../lift';
import { CABIN_H } from './constants';
import type { Rect } from './layout';
import { px } from './pixel';

const FRAME = 0x2e333b;
const GLASS = 0xbfe3f7;

export class LiftCabin {
  private readonly back = new Graphics();
  private readonly doors = new Graphics();
  private width = 0;
  private opened = -1;

  constructor(actors: Container) {
    this.back.eventMode = 'none';
    this.doors.eventMode = 'none';
    actors.addChild(this.back, this.doors);
  }

  update(controller: LiftController, lift: Rect | null): void {
    const visible = lift !== null;
    this.back.visible = visible;
    this.doors.visible = visible;
    if (!lift) return;
    const width = lift.w - 2;
    if (width !== this.width) {
      this.width = width;
      this.opened = -1;
      this.drawBack(width);
    }
    const position = Math.round(controller.position);
    for (const part of [this.back, this.doors]) part.position.set(lift.x + 1, position - CABIN_H);
    this.back.zIndex = position - 1;
    this.doors.zIndex = position + 1;
    const opened = Math.round(controller.doors * (width / 2 - 1));
    if (opened !== this.opened) {
      this.opened = opened;
      this.drawDoors(width, opened);
    }
  }

  destroy(): void {
    this.back.destroy();
    this.doors.destroy();
  }

  private drawBack(width: number): void {
    const g = this.back;
    g.clear();
    px(g, 0, 0, width, CABIN_H, 0x3a4250);
    px(g, 1, 3, width - 2, CABIN_H - 5, 0x4a5466);
    px(g, 2, 1, width - 4, 1, 0xfff6e6);
    px(g, 1, CABIN_H - 12, width - 2, 1, 0xd7dbe0);
    px(g, 0, CABIN_H - 2, width, 2, 0x9aa3ae);
  }

  private drawDoors(width: number, opened: number): void {
    const g = this.doors;
    g.clear();
    px(g, 0, 0, width, 2, FRAME);
    px(g, 0, 0, 1, CABIN_H, FRAME);
    px(g, width - 1, 0, 1, CABIN_H, FRAME);
    const half = width / 2;
    const leaf = (x: number, w: number): void => {
      if (w < 1) return;
      px(g, x, 2, w, CABIN_H - 2, GLASS, 0.45);
      px(g, x, 2, w, 1, FRAME);
      px(g, x, CABIN_H - 1, w, 1, FRAME);
      px(g, x, 2, 1, CABIN_H - 2, FRAME);
      px(g, x + w - 1, 2, 1, CABIN_H - 2, FRAME);
    };
    leaf(1, half - 1 - opened);
    leaf(half + opened, half - 1 - opened);
  }
}
