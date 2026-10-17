import { Sprite, Texture } from 'pixi.js';
import { t } from '../i18n';
import { BOARD_H, BOARD_W, paintBoard } from '../boards-paint';
import { boardSignature, BOARD_REPAINT_MS, type BoardData } from '../boards';
import type { Tab } from '../topbar';

export const BOARD_SPRITE_W = 61;
export const BOARD_SPRITE_H = (BOARD_SPRITE_W * BOARD_H) / BOARD_W;
export const BOARD_SPRITE_Y = 1.5;

// The whiteboard of a floor in 2D: a sprite over a canvas, repainted and re-uploaded only when due and changed.
export class BoardSprite {
  readonly sprite: Sprite;
  tab: Tab = 'table';
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: Texture;
  private signature = '';
  private checkedAt = Number.NEGATIVE_INFINITY;

  constructor(onOpen: (tab: Tab) => void) {
    const canvas = document.createElement('canvas');
    canvas.width = BOARD_W;
    canvas.height = BOARD_H;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(t('scene.noCanvas'));
    this.context = context;
    context.fillStyle = '#f7f9fb';
    context.fillRect(0, 0, BOARD_W, BOARD_H);
    this.texture = Texture.from(canvas);
    this.sprite = new Sprite(this.texture);
    this.sprite.width = BOARD_SPRITE_W;
    this.sprite.height = BOARD_SPRITE_H;
    this.sprite.eventMode = 'static';
    this.sprite.cursor = 'pointer';
    this.sprite.on('pointertap', () => onOpen(this.tab));
  }

  due(elapsed: number): boolean {
    return elapsed - this.checkedAt >= BOARD_REPAINT_MS / 1000;
  }

  touch(): void {
    this.checkedAt = Number.NEGATIVE_INFINITY;
  }

  refresh(elapsed: number, data: BoardData, accent: string): boolean {
    this.checkedAt = elapsed;
    this.tab = data.tab;
    const signature = boardSignature(data);
    if (signature === this.signature) return false;
    this.signature = signature;
    paintBoard(this.context, data, accent, true);
    this.texture.source.update();
    return true;
  }

  destroy(): void {
    this.sprite.destroy({ texture: true, textureSource: true });
  }
}
