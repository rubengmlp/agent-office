import { Mesh, MeshStandardMaterial } from 'three';
import { UNIT_BOX } from './batch';
import { PRINT_S } from './constants';
import { PRINTER_SLOT_DX, PRINTER_SLOT_Y } from './furniture';
import { std } from './materials';

const SHEET_LENGTH = 0.3;
const SHEET_WIDTH = 0.21;
const SHEET_THICK = 0.004;
// How much of the sheet comes out of the slot, and how long it stays out once it has.
const REACH = SHEET_LENGTH - 0.06;
const SLIDE_S = 1.4;

// Where the sheet is while it prints: how far out of the slot, from 0 to 1, or null when it is not there.
export function sheetProgress(elapsed: number): number | null {
  if (elapsed < 0 || elapsed >= PRINT_S) return null;
  return Math.min(1, elapsed / SLIDE_S);
}

// The sheet a printer pushes out with each accepted delivery: it slides out for 1.4 s, stays until 2 s and goes.
export class PrintSheet {
  readonly mesh: Mesh;
  readonly material: MeshStandardMaterial;
  private startedAt: number | null = null;

  constructor(private readonly x: number, private readonly z: number) {
    this.material = std(0xfbfaf6, 0.85);
    this.mesh = new Mesh(UNIT_BOX, this.material);
    this.mesh.scale.set(SHEET_LENGTH, SHEET_THICK, SHEET_WIDTH);
    this.mesh.castShadow = true;
    this.mesh.visible = false;
  }

  get printing(): boolean {
    return this.mesh.visible;
  }

  start(seconds: number): void {
    if (this.startedAt !== null && seconds - this.startedAt < PRINT_S) return;
    this.startedAt = seconds;
  }

  tick(seconds: number): void {
    const progress = this.startedAt === null ? null : sheetProgress(seconds - this.startedAt);
    if (progress === null) {
      this.mesh.visible = false;
      this.startedAt = null;
      return;
    }
    const slot = this.x + PRINTER_SLOT_DX;
    this.mesh.position.set(slot + SHEET_LENGTH / 2 - progress * REACH, PRINTER_SLOT_Y, this.z);
    this.mesh.visible = true;
  }
}
