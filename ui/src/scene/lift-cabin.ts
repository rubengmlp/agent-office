import { Group, Mesh, type MeshStandardMaterial } from 'three';
import type { LiftController, LiftFace } from '../lift';
import { UNIT_BOX } from './batch';
import { DOOR_H, LIFT_W } from './constants';
import { buildingKit, gardenKit } from './materials';

const INNER = LIFT_W - 0.2;
const HALF = INNER / 2;
const LEAF = 0.45;
const ROOF_H = 2.45;

type Leaves = { face: LiftFace; a: Mesh; b: Mesh };

const ROOM_ONLY: readonly LiftFace[] = ['room'];

export class LiftCabin {
  readonly group = new Group();
  private readonly leaves: Leaves[] = [];

  constructor() {
    const kit = buildingKit();
    const box = (material: MeshStandardMaterial, w: number, h: number, d: number, x: number, y: number, z: number): Mesh => {
      const mesh = new Mesh(UNIT_BOX, material);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    box(kit.liftPad, INNER, 0.08, INNER, 0, -0.04, 0);
    box(kit.claddingDark, INNER, 0.08, INNER, 0, ROOF_H, 0);
    box(gardenKit().lamp, INNER * 0.5, 0.03, INNER * 0.5, 0, ROOF_H - 0.055, 0).castShadow = false;
    box(kit.claddingDark, INNER, ROOF_H, 0.05, 0, ROOF_H / 2, -HALF);
    box(kit.chrome, INNER - 0.2, 0.04, 0.04, 0, 0.95, -HALF + 0.08);
    for (const [x, z] of [[-HALF, -HALF], [-HALF, HALF], [HALF, -HALF], [HALF, HALF]] as const) box(kit.frame, 0.06, ROOF_H, 0.06, x, ROOF_H / 2, z);
    const pair = (face: LiftFace): void => {
      const along = face === 'street';
      const at = face === 'bridge' ? HALF : face === 'room' ? -HALF : HALF;
      const leaf = (): Mesh => (along ? box(kit.liftPad, LEAF, DOOR_H, 0.04, 0, DOOR_H / 2, at) : box(kit.liftPad, 0.04, DOOR_H, LEAF, at, DOOR_H / 2, 0));
      this.leaves.push({ face, a: leaf(), b: leaf() });
    };
    pair('room');
    pair('street');
    pair('bridge');
    this.update(null, 0, 0);
  }

  update(controller: LiftController | null, x: number, z: number): void {
    this.group.visible = controller !== null;
    if (!controller) return;
    this.group.position.set(x, controller.position, z);
    const served = controller.servedFaces();
    const open = served.length > 0 ? served : ROOM_ONLY;
    for (const { face, a, b } of this.leaves) {
      const amount = open.includes(face) ? controller.doors : 0;
      const offset = LEAF / 2 + LEAF * amount;
      if (face === 'street') {
        a.position.x = -offset;
        b.position.x = offset;
      } else {
        a.position.z = -offset;
        b.position.z = offset;
      }
    }
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
