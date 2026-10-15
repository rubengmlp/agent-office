import { Container, Graphics } from 'pixi.js';
import { CHAR_H, CHAR_W } from './constants';
import { bitmap, px } from './pixel';

export type IconKind = 'ask' | 'talk' | 'lock' | 'check' | 'cross' | 'stamp';
export type BadgeKind = 'ok' | 'fail';

const GLYPH_QUESTION = ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'] as const;
const GLYPH_CHECK = ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'] as const;
const GLYPH_CROSS = ['#.....#', '##...##', '.##.##.', '..###..', '.##.##.', '##...##', '#.....#'] as const;
const GLYPH_LOCK = ['..###..', '.#...#.', '.#...#.', '#######', '###.###', '###.###', '#######'] as const;
const GLYPH_STAMP = ['..hh..', '..hh..', '.hhhh.', 'rrrrrr', 'rrrrrr', '.pppp.'] as const;
const MINI_CHECK = ['....#', '#..##', '.###.', '..#..'] as const;
const MINI_CROSS = ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'] as const;

const INK = 0x1b1e24;
const DOT_COUNT = 3;

function bubble(): Graphics {
  const g = new Graphics();
  px(g, -7, -13, 15, 12, INK);
  px(g, -6, -12, 13, 10, 0xffffff);
  px(g, -1, -2, 4, 3, INK);
  px(g, 0, -2, 2, 2, 0xffffff);
  return g;
}

function disc(fill: number): Graphics {
  const g = new Graphics();
  g.circle(0, -7, 6.5).fill(INK);
  g.circle(0, -7, 5.5).fill(fill);
  return g;
}

function glyphIcon(fill: number, glyph: readonly string[], color: number): Container {
  const holder = new Container();
  const g = disc(fill);
  bitmap(g, glyph, -Math.floor(glyph[0].length / 2), -7 - Math.floor(glyph.length / 2), { '#': color });
  holder.addChild(g);
  return holder;
}

function buildIcons(dots: Graphics[]): Record<IconKind, Container> {
  const ask = new Container();
  const askBubble = bubble();
  bitmap(askBubble, GLYPH_QUESTION, -2, -11, { '#': 0xea580c });
  ask.addChild(askBubble);

  const talk = new Container();
  talk.addChild(bubble());
  for (let index = 0; index < DOT_COUNT; index += 1) {
    const dot = new Graphics();
    px(dot, -4 + index * 4, -8, 2, 2, INK);
    dots.push(dot);
    talk.addChild(dot);
  }

  const stamp = new Container();
  const stampDisc = disc(0xeab308);
  bitmap(stampDisc, GLYPH_STAMP, -3, -10, { h: 0x8b5a2b, r: 0xb91c1c, p: 0xf2e6c9 });
  stamp.addChild(stampDisc);

  return {
    ask,
    talk,
    stamp,
    lock: glyphIcon(0xef4444, GLYPH_LOCK, 0xffffff),
    check: glyphIcon(0x22c55e, GLYPH_CHECK, 0xffffff),
    cross: glyphIcon(0xdc2626, GLYPH_CROSS, 0xffffff),
  };
}

function buildBadge(fill: number, glyph: readonly string[]): Container {
  const holder = new Container();
  const g = new Graphics();
  g.circle(0, 0, 5.5).fill(INK);
  g.circle(0, 0, 4.5).fill(fill);
  bitmap(g, glyph, -2, -Math.floor(glyph.length / 2), { '#': 0xffffff });
  holder.addChild(g);
  holder.position.set(CHAR_W, 1);
  holder.visible = false;
  return holder;
}

function outline(inset: number, color: number): Graphics {
  const g = new Graphics();
  const w = CHAR_W + inset * 2;
  const h = CHAR_H + inset * 2;
  px(g, -inset, -inset, w, 1, color);
  px(g, -inset, CHAR_H + inset - 1, w, 1, color);
  px(g, -inset, -inset, 1, h, color);
  px(g, CHAR_W + inset - 1, -inset, 1, h, color);
  g.visible = false;
  return g;
}

export class Overlay {
  readonly root = new Container();

  private readonly iconLayer = new Container();
  private readonly icons: Record<IconKind, Container>;
  private readonly dots: Graphics[] = [];
  private readonly bar = new Container();
  private readonly barFill = new Graphics();
  private readonly badges: Record<BadgeKind, Container>;
  private readonly selectOutline = outline(1, 0xffffff);
  private readonly askOutline = outline(2, 0xfb923c);

  constructor() {
    this.icons = buildIcons(this.dots);
    this.iconLayer.position.set(CHAR_W / 2, -1);
    for (const icon of Object.values(this.icons)) {
      icon.visible = false;
      this.iconLayer.addChild(icon);
    }

    const barBack = new Graphics();
    px(barBack, 2, -7, 12, 4, INK);
    px(barBack, 3, -6, 10, 2, 0x39414c);
    this.barFill.position.set(3, -6);
    px(this.barFill, 0, 0, 10, 2, 0xa78bfa);
    this.bar.addChild(barBack, this.barFill);
    this.bar.visible = false;

    this.badges = { ok: buildBadge(0x22c55e, MINI_CHECK), fail: buildBadge(0xdc2626, MINI_CROSS) };

    this.root.addChild(
      this.askOutline,
      this.selectOutline,
      this.iconLayer,
      this.bar,
      this.badges.ok,
      this.badges.fail,
    );
  }

  setIcon(kind: IconKind | null, seconds: number): void {
    for (const [name, icon] of Object.entries(this.icons)) icon.visible = name === kind;
    this.iconLayer.y = -1 + Math.round(Math.sin(seconds * 4));
    if (kind === 'ask') this.icons.ask.visible = Math.floor(seconds * 2.5) % 2 === 0;
    if (kind === 'talk') {
      const shown = 1 + (Math.floor(seconds * 3) % DOT_COUNT);
      this.dots.forEach((dot, index) => {
        dot.visible = index < shown;
      });
    }
  }

  setProgress(visible: boolean, seconds: number): void {
    this.bar.visible = visible;
    if (!visible) return;
    const filled = Math.max(1, Math.round(((seconds * 0.5) % 1) * 10));
    this.barFill.scale.x = filled / 10;
  }

  setBadge(kind: BadgeKind | null): void {
    this.badges.ok.visible = kind === 'ok';
    this.badges.fail.visible = kind === 'fail';
  }

  setSelected(on: boolean): void {
    this.selectOutline.visible = on;
  }

  setAsking(on: boolean, seconds: number): void {
    this.askOutline.visible = on;
    if (on) this.askOutline.alpha = 0.55 + 0.45 * Math.sin(seconds * 5);
  }
}
