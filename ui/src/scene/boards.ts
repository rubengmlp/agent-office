import { CanvasTexture, Mesh, SRGBColorSpace, type MeshStandardMaterial } from 'three';
import { t } from '../i18n';
import { BOARD_H, BOARD_W, paintBoard } from '../boards-paint';
import { boardSignature, BOARD_REPAINT_MS, type BoardData } from '../boards';
import type { Tab } from '../topbar';
import { UNIT_PLANE } from './furniture';
import { std } from './materials';

export const BOARD_WIDTH = 1.34;
export const BOARD_HEIGHT = (BOARD_WIDTH * BOARD_H) / BOARD_W;
// Centre of the whiteboard frame the screen sits in front of.
export const BOARD_Y = 1.55;
export const BOARD_LIFT = 0.032;

// The writing of a whiteboard: a canvas texture on a plane in front of the frame, repainted only when due
// and when what it says changed.
export class BoardScreen {
  readonly mesh: Mesh;
  readonly material: MeshStandardMaterial;
  readonly texture: CanvasTexture;
  tab: Tab = 'table';
  private readonly context: CanvasRenderingContext2D;
  private signature = '';
  private checkedAt = Number.NEGATIVE_INFINITY;

  constructor(readonly slug: string, x: number, z: number) {
    const canvas = document.createElement('canvas');
    canvas.width = BOARD_W;
    canvas.height = BOARD_H;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(t('scene.noCanvas'));
    this.context = context;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.material = std(0xffffff, 0.35, 0, { map: this.texture, emissive: 0xffffff, emissiveMap: this.texture, emissiveIntensity: 0.22 });
    this.mesh = new Mesh(UNIT_PLANE, this.material);
    this.mesh.scale.set(BOARD_WIDTH, BOARD_HEIGHT, 1);
    this.mesh.position.set(x, BOARD_Y, z + BOARD_LIFT);
    this.mesh.userData.boardSlug = slug;
    context.fillStyle = '#f7f9fb';
    context.fillRect(0, 0, BOARD_W, BOARD_H);
  }

  due(elapsed: number): boolean {
    return elapsed - this.checkedAt >= BOARD_REPAINT_MS / 1000;
  }

  // Forces the next check, for a change of language.
  touch(): void {
    this.checkedAt = Number.NEGATIVE_INFINITY;
  }

  refresh(elapsed: number, data: BoardData, accent: string): boolean {
    this.checkedAt = elapsed;
    this.tab = data.tab;
    const signature = boardSignature(data);
    if (signature === this.signature) return false;
    this.signature = signature;
    paintBoard(this.context, data, accent);
    this.texture.needsUpdate = true;
    return true;
  }
}
