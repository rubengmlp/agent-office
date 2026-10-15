import { Container, Graphics } from 'pixi.js';
import { STACK_LABELS } from '../labels';
import type { FloorView } from '../types';
import { DESK_BASE_Y, LEAD_SLOT_W, MARGIN, WALL_H } from './constants';
import {
  buildDesk,
  buildMeetingFurniture,
  drawCoffee,
  drawCoffeeLed,
  drawLabBench,
  drawLabLamp,
  drawLift,
  drawRug,
  drawWindow,
  type DeskParts,
} from './furniture';
import type { DeskSlot, FloorLayout, Point } from './layout';
import { floorPalette, mix, type FloorPalette } from './palette';
import { makeText, px } from './pixel';

const TABLE_BASE = 15;

function plateSubtitle(view: FloorView): string {
  if (view.kind === 'direccion') return 'Despacho del director';
  const stack = STACK_LABELS[view.stack];
  return view.kind === 'observed' ? `${stack} · observada` : stack;
}

export class FloorScene {
  readonly background = new Container();
  readonly foreground = new Container();
  top: number;

  private readonly bg = new Graphics();
  private readonly plate = new Container();
  private readonly labLamp = new Graphics();
  private readonly coffeeLed = new Graphics();
  private readonly glass = new Graphics();
  private readonly meeting = buildMeetingFurniture();
  private leadParts: DeskParts | null = null;
  private signature = '';

  constructor(
    private readonly actors: Container,
    public view: FloorView,
    public layout: FloorLayout,
    top: number,
  ) {
    this.top = top;
    this.background.addChild(this.bg, this.plate, this.labLamp, this.coffeeLed);
    this.foreground.addChild(this.glass);
    this.foreground.eventMode = 'none';
    this.actors.addChild(this.meeting.back, this.meeting.front);
    this.update(view, layout, top);
  }

  get slug(): string {
    return this.view.slug;
  }

  get leadDeskParts(): DeskParts | null {
    return this.leadParts;
  }

  get tableBaseZ(): number {
    return this.top + this.layout.table.y + TABLE_BASE;
  }

  update(view: FloorView, layout: FloorLayout, top: number): void {
    this.view = view;
    this.layout = layout;
    this.top = top;
    this.background.position.set(0, top);
    this.foreground.position.set(0, top);

    const signature = [view.kind, view.stack, view.label, layout.width, layout.height].join('|');
    if (signature !== this.signature) {
      this.signature = signature;
      this.draw();
    }

    this.syncLeadDesk();
    const { table } = layout;
    this.meeting.back.position.set(table.x, top + table.y);
    this.meeting.front.position.set(table.x, top + table.y);
    this.meeting.front.zIndex = this.tableBaseZ;
    this.meeting.back.zIndex = this.tableBaseZ - 2;
  }

  placeDesk(parts: DeskParts, slot: DeskSlot): number {
    const base = this.deskBaseZ(slot);
    for (const part of [parts.back, parts.front]) {
      part.position.set(slot.x, this.top + slot.y);
      part.scale.set(slot.scale);
    }
    parts.front.zIndex = base;
    parts.back.zIndex = base - 2;
    return base;
  }

  deskBaseZ(slot: DeskSlot): number {
    return this.top + slot.y + DESK_BASE_Y * slot.scale;
  }

  toWorld(point: Point): Point {
    return { x: point.x, y: point.y + this.top };
  }

  tick(seconds: number, labActive: boolean): void {
    this.labLamp.visible = labActive;
    this.labLamp.alpha = 0.65 + 0.35 * Math.sin(seconds * 6);
    this.coffeeLed.visible = Math.floor(seconds / 0.6) % 2 === 0;
  }

  destroy(): void {
    this.actors.removeChild(this.meeting.back, this.meeting.front);
    if (this.leadParts) this.actors.removeChild(this.leadParts.back, this.leadParts.front);
    this.background.destroy({ children: true });
    this.foreground.destroy({ children: true });
    this.meeting.back.destroy();
    this.meeting.front.destroy();
    this.leadParts?.back.destroy();
    this.leadParts?.front.destroy({ children: true });
  }

  private syncLeadDesk(): void {
    const slot = this.layout.leadDesk;
    if (!slot) {
      if (this.leadParts) {
        this.actors.removeChild(this.leadParts.back, this.leadParts.front);
        this.leadParts.back.destroy();
        this.leadParts.front.destroy({ children: true });
        this.leadParts = null;
      }
      return;
    }
    if (!this.leadParts) {
      this.leadParts = buildDesk(LEAD_SLOT_W, true);
      this.actors.addChild(this.leadParts.back, this.leadParts.front);
    }
    this.placeDesk(this.leadParts, slot);
  }

  private draw(): void {
    const { width, height, labBench, coffee, rug, lift, walkY, windows } = this.layout;
    const palette = floorPalette(this.view);
    const g = this.bg;
    g.clear();

    px(g, 0, 0, width, WALL_H, palette.wall);
    px(g, 0, WALL_H - 9, width, 8, palette.wallDark);
    px(g, 0, WALL_H - 1, width, 1, palette.trim);
    for (const frame of windows) drawWindow(g, frame.x, frame.y, palette);

    px(g, 0, WALL_H, width, height - WALL_H, palette.floorA);
    for (let y = WALL_H; y < height; y += 8) {
      for (let x = 0; x < width; x += 8) {
        if ((x + y - WALL_H) % 16 === 0) px(g, x, y, Math.min(8, width - x), Math.min(8, height - y), palette.floorB);
      }
    }

    drawRug(g, rug.x, rug.y, rug.w, rug.h, palette);
    drawLabBench(g, labBench.x, labBench.y);
    drawCoffee(g, coffee.x, coffee.y);
    drawLift(g, lift.x, lift.y, lift.w, lift.h, walkY);
    px(g, 0, height - 1, width, 1, palette.trim);
    px(g, 0, 0, 2, height, palette.wallDark);
    px(g, width - 2, 0, 2, height, palette.wallDark);

    this.labLamp.clear();
    drawLabLamp(this.labLamp, labBench.x, labBench.y);
    this.coffeeLed.clear();
    drawCoffeeLed(this.coffeeLed, coffee.x, coffee.y);

    this.drawPlate(palette);
    this.drawGlass(palette);
  }

  private drawPlate(palette: FloorPalette): void {
    for (const child of this.plate.removeChildren()) child.destroy();
    const label = makeText(this.view.label, 9, palette.plateText);
    const subtitle = makeText(plateSubtitle(this.view), 6, mix(palette.plateText, palette.plate, 0.35));
    label.position.set(8, 4);
    subtitle.position.set(8, 16);
    const backing = new Graphics();
    const width = Math.max(label.width, subtitle.width) + 12;
    px(backing, 4, 3, width, 23, palette.plate);
    px(backing, 4, 3, width, 1, palette.accent);
    this.plate.addChild(backing, label, subtitle);
  }

  private drawGlass(palette: FloorPalette): void {
    const g = this.glass;
    g.clear();
    if (!palette.glass) return;
    const { width, height } = this.layout;
    const partition = MARGIN + LEAD_SLOT_W + 4;
    px(g, 0, 0, width, height, 0xbfe3f7, 0.1);
    px(g, 0, 0, width, 2, 0xdff3ff, 0.6);
    px(g, 0, height - 2, width, 2, 0xdff3ff, 0.6);
    px(g, 0, 0, 3, height, 0xdff3ff, 0.55);
    px(g, width - 3, 0, 3, height, 0xdff3ff, 0.55);
    px(g, 0, WALL_H, partition, height - WALL_H, 0xbfe3f7, 0.12);
    px(g, partition, WALL_H, 2, height - WALL_H, 0xdff3ff, 0.55);
    g.poly([20, 0, 34, 0, 14, height, 0, height]).fill({ color: 0xffffff, alpha: 0.08 });
    g.poly([70, 0, 76, 0, 56, height, 50, height]).fill({ color: 0xffffff, alpha: 0.06 });
  }
}
