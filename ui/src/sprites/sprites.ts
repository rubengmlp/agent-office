import { Container, Graphics } from 'pixi.js';
import { CHAR_H, CHAR_W } from '../office/constants';
import { grey, hsl, shade } from '../office/palette';
import { bitmap, px } from '../office/pixel';
import type { RoleKind } from '../types';

export type Look = {
  roleKind: RoleKind;
  seed: number;
  saturation: number;
};

export type CharacterParts = {
  root: Container;
  rig: Container;
  head: Container;
  legL: Container;
  legR: Container;
  armL: Container;
  armR: Container;
  mouth: Graphics;
  cup: Container;
  steam: Graphics;
  folder: Container;
  page: Graphics;
  flask: Container;
  stamp: Container;
  glow: Graphics;
  tint: Graphics;
};

type Outfit = {
  body: number;
  sleeve: number;
  pants: number;
  shortSleeves: boolean;
  paint(g: Graphics): void;
};

type Tone = (color: number) => number;

const SKIN = [0xf1c9a5, 0xe0ac86, 0xc68642, 0x8d5524, 0xffdbb4] as const;
const HAIR = [0x2b2118, 0x5a3825, 0xa0522d, 0xd9b45a, 0x1c1c24, 0x7a7a82] as const;
const SHOES = 0x15161b;
const GLASSES: ReadonlySet<RoleKind> = new Set<RoleKind>(['reviewer', 'planReviewer', 'skillReviewer']);

type CoatColors = {
  coat: number;
  placket: number;
  lapel: number;
  pocket: number;
  accent: number;
  pen: number;
  pants: number;
};

function vestOutfit(tone: Tone, shirt: number, vestColor: number): Outfit {
  const vest = tone(vestColor);
  return {
    body: tone(shirt),
    sleeve: tone(shirt),
    pants: tone(0x2f3b4c),
    shortSleeves: false,
    paint: (g) => {
      px(g, 3, 9, 3, 9, vest);
      px(g, 10, 9, 3, 9, vest);
      px(g, 6, 9, 4, 1, 0xffffff);
      px(g, 8, 12, 1, 1, 0x1b1e24);
      px(g, 8, 15, 1, 1, 0x1b1e24);
      px(g, 3, 16, 10, 1, shade(vest, -0.25));
    },
  };
}

function coatOutfit(tone: Tone, colors: CoatColors): Outfit {
  const coat = tone(colors.coat);
  return {
    body: coat,
    sleeve: coat,
    pants: tone(colors.pants),
    shortSleeves: false,
    paint: (g) => {
      px(g, 7, 10, 2, 8, colors.placket);
      px(g, 4, 9, 3, 2, colors.lapel);
      px(g, 9, 9, 3, 2, colors.lapel);
      px(g, 7, 9, 2, 1, tone(colors.accent));
      px(g, 4, 14, 3, 3, colors.pocket);
      px(g, 5, 13, 1, 2, tone(colors.pen));
    },
  };
}

function sweaterOutfit(tone: Tone, color: number): Outfit {
  const sweater = tone(color);
  return {
    body: sweater,
    sleeve: sweater,
    pants: tone(0x2e3340),
    shortSleeves: false,
    paint: (g) => {
      for (const row of [10, 12, 14, 16]) px(g, 3, row, 10, 1, shade(sweater, 0.14));
      px(g, 6, 9, 4, 1, shade(sweater, -0.22));
    },
  };
}

function outfitFor(look: Look, tone: Tone): Outfit {
  const hue = look.seed % 360;
  switch (look.roleKind) {
    case 'director': {
      const jacket = tone(0x2f3340);
      const tie = tone(0xc0392b);
      return {
        body: jacket,
        sleeve: jacket,
        pants: tone(0x23252e),
        shortSleeves: false,
        paint: (g) => {
          px(g, 6, 9, 4, 1, 0xf4f4f4);
          px(g, 6, 10, 1, 4, shade(jacket, 0.12));
          px(g, 9, 10, 1, 4, shade(jacket, 0.12));
          px(g, 7, 10, 2, 7, tie);
          px(g, 10, 12, 2, 1, 0xf4f4f4);
        },
      };
    }
    case 'lead':
      return vestOutfit(tone, 0xe8edf3, 0x3b5b7a);
    case 'writer':
      return vestOutfit(tone, 0xf3ead6, 0xc2410c);
    case 'dev': {
      const hoodie = tone(hsl(hue, 0.5, 0.42));
      return {
        body: hoodie,
        sleeve: hoodie,
        pants: tone(0x394150),
        shortSleeves: false,
        paint: (g) => {
          px(g, 4, 9, 8, 2, shade(hoodie, 0.25));
          px(g, 5, 14, 6, 3, shade(hoodie, -0.18));
          px(g, 6, 11, 1, 3, 0xe9e9e9);
          px(g, 9, 11, 1, 3, 0xe9e9e9);
        },
      };
    }
    case 'tester':
      return coatOutfit(tone, {
        coat: 0xf5f7fa,
        placket: 0xd5dbe3,
        lapel: 0xe1e6ec,
        pocket: 0xe3e8ee,
        accent: 0x2a9d8f,
        pen: 0x1d4ed8,
        pants: 0x4a5568,
      });
    case 'skillwright':
      return coatOutfit(tone, {
        coat: 0xe6d3b0,
        placket: 0xc9b48a,
        lapel: 0xd8c59f,
        pocket: 0xd0bb92,
        accent: 0xc2410c,
        pen: 0x7c2d12,
        pants: 0x4b4034,
      });
    case 'reviewer':
      return sweaterOutfit(tone, 0x6a4c93);
    case 'planReviewer':
      return sweaterOutfit(tone, 0x2a9d8f);
    case 'skillReviewer':
      return sweaterOutfit(tone, 0x3f7d4e);
    case 'intern': {
      const tee = tone(hsl(hue, 0.55, 0.55));
      return {
        body: tee,
        sleeve: tee,
        pants: tone(0x3d5a80),
        shortSleeves: true,
        paint: (g) => {
          px(g, 6, 9, 4, 1, shade(tee, -0.15));
          px(g, 5, 12, 2, 2, shade(tee, 0.25));
        },
      };
    }
  }
}

function buildLeg(x: number, pants: number): Container {
  const holder = new Container();
  holder.position.set(x, 18);
  const g = new Graphics();
  px(g, 0, 0, 3, 4, pants);
  px(g, 0, 4, 3, 2, SHOES);
  holder.addChild(g);
  return holder;
}

function buildArm(x: number, outfit: Outfit, skin: number): Container {
  const holder = new Container();
  holder.position.set(x, 10);
  const g = new Graphics();
  if (outfit.shortSleeves) {
    px(g, -1, -1, 2, 3, outfit.sleeve);
    px(g, -1, 2, 2, 5, skin);
  } else {
    px(g, -1, -1, 2, 6, outfit.sleeve);
    px(g, -1, 5, 2, 2, skin);
  }
  holder.addChild(g);
  return holder;
}

function paintHair(g: Graphics, style: number, color: number): void {
  if (style === 0) {
    px(g, 4, 0, 8, 3, color);
    px(g, 3, 1, 1, 4, color);
    px(g, 12, 1, 1, 4, color);
  } else if (style === 1) {
    px(g, 3, 0, 10, 3, color);
    px(g, 3, 3, 1, 3, color);
    px(g, 12, 3, 1, 2, color);
    px(g, 4, 3, 3, 1, color);
  } else {
    px(g, 3, 0, 10, 3, color);
    px(g, 3, 3, 2, 7, color);
    px(g, 11, 3, 2, 7, color);
  }
}

function buildHead(look: Look, skin: number, hair: number, hairStyle: number): { head: Container; mouth: Graphics } {
  const head = new Container();
  const g = new Graphics();
  px(g, 4, 2, 8, 7, skin);
  px(g, 3, 5, 1, 2, shade(skin, -0.1));
  px(g, 12, 5, 1, 2, shade(skin, -0.1));
  paintHair(g, hairStyle, hair);
  if (GLASSES.has(look.roleKind)) {
    px(g, 5, 4, 3, 3, 0x20242c);
    px(g, 8, 4, 3, 3, 0x20242c);
    px(g, 6, 5, 1, 1, 0xdbeaff);
    px(g, 9, 5, 1, 1, 0xdbeaff);
  } else {
    px(g, 6, 5, 1, 1, 0x1b1b1f);
    px(g, 9, 5, 1, 1, 0x1b1b1f);
  }
  const mouth = new Graphics();
  mouth.position.set(7, 7);
  px(mouth, 0, 0, 2, 1, 0x9b4a40);
  head.addChild(g, mouth);
  return { head, mouth };
}

function buildCup(): { cup: Container; steam: Graphics } {
  const cup = new Container();
  cup.pivot.set(2, 2);
  cup.position.set(0, 6);
  const body = new Graphics();
  px(body, 0, 0, 4, 4, 0xf4f1ea);
  px(body, 0, 0, 4, 1, 0xcfc8b8);
  px(body, 1, 1, 2, 1, 0x6b3e26);
  px(body, 4, 1, 1, 2, 0xf4f1ea);
  const steam = new Graphics();
  px(steam, 1, -3, 1, 1, 0xffffff, 0.7);
  px(steam, 2, -5, 1, 1, 0xffffff, 0.5);
  cup.addChild(steam, body);
  cup.visible = false;
  return { cup, steam };
}

function buildFolder(): { folder: Container; page: Graphics } {
  const folder = new Container();
  folder.position.set(2, 10);
  const body = new Graphics();
  px(body, 0, 0, 12, 8, 0xe0b84c);
  px(body, 5, 0, 2, 8, 0xb98a22);
  px(body, 1, 1, 4, 6, 0xfbf8ee);
  px(body, 7, 1, 4, 6, 0xfbf8ee);
  for (const [x, y] of [[2, 2], [2, 4], [8, 2], [8, 4]]) px(body, x, y, 2, 1, 0xbdb7a5);
  const page = new Graphics();
  page.position.set(6, 0);
  px(page, 0, 1, 4, 6, 0xffffff);
  px(page, 1, 2, 2, 1, 0xcfcabb);
  px(page, 1, 4, 2, 1, 0xcfcabb);
  folder.addChild(body, page);
  folder.visible = false;
  return { folder, page };
}

function buildFlask(tone: Tone): Container {
  const flask = new Container();
  flask.pivot.set(2.5, 5);
  flask.position.set(0, 6);
  const g = new Graphics();
  bitmap(g, ['..#..', '..#..', '.#l#.', '#lll#', '#lll#', '#####'], 0, 0, { '#': 0xdff1ff, l: tone(0x5fd68a) });
  flask.addChild(g);
  flask.visible = false;
  return flask;
}

function buildStamp(tone: Tone): Container {
  const stamp = new Container();
  stamp.pivot.set(3, 5);
  stamp.position.set(0, 7);
  const g = new Graphics();
  bitmap(g, ['..hh..', '..hh..', '.hhhh.', 'rrrrrr', 'rrrrrr'], 0, 0, { h: 0x8b5a2b, r: tone(0xb91c1c) });
  stamp.addChild(g);
  stamp.visible = false;
  return stamp;
}

export function buildCharacter(look: Look): CharacterParts {
  const tone: Tone = (color) => (look.saturation >= 1 ? color : grey(color, 1 - look.saturation));
  const outfit = outfitFor(look, tone);
  const skin = SKIN[look.seed % SKIN.length];
  const hairColor = tone(look.roleKind === 'director' ? 0x7a7a82 : HAIR[(look.seed >>> 3) % HAIR.length]);
  const hairStyle = (look.seed >>> 7) % 3;

  const root = new Container();
  root.pivot.set(CHAR_W / 2, CHAR_H);

  const shadow = new Graphics();
  px(shadow, 2, 22, 12, 2, 0x000000, 0.22);

  const legL = buildLeg(5, outfit.pants);
  const legR = buildLeg(8, outfit.pants);

  const torso = new Graphics();
  px(torso, 3, 9, 10, 9, outfit.body);
  outfit.paint(torso);

  const armL = buildArm(2, outfit, skin);
  const armR = buildArm(14, outfit, skin);
  const { head, mouth } = buildHead(look, skin, hairColor, hairStyle);
  const { cup, steam } = buildCup();
  const { folder, page } = buildFolder();
  const flask = buildFlask(tone);
  const stamp = buildStamp(tone);
  armR.addChild(cup, stamp);
  armL.addChild(flask);

  const glow = new Graphics();
  px(glow, 4, 2, 8, 7, 0x7fe3ff, 0.2);
  glow.visible = false;

  const tint = new Graphics();
  for (const [x, y, w, h] of [[4, 2, 8, 7], [3, 9, 10, 9], [1, 9, 2, 8], [13, 9, 2, 8]]) px(tint, x, y, w, h, 0xff2d2d, 0.4);
  tint.visible = false;

  const rig = new Container();
  rig.addChild(torso, armL, armR, head, folder, glow, tint);
  root.addChild(shadow, legL, legR, rig);

  return { root, rig, head, legL, legR, armL, armR, mouth, cup, steam, folder, page, flask, stamp, glow, tint };
}
