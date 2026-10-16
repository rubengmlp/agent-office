import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three';
import { TALK_LINE } from './constants';

const SAMPLES = 28;
const DASH = 0.22;
const PERIOD = 0.4;
const UP = new Vector3(0, 1, 0);

export class TalkLines {
  readonly mesh: InstancedMesh;
  private readonly capacity = 240;
  private count = 0;
  private readonly points: Vector3[] = Array.from({ length: SAMPLES + 1 }, () => new Vector3());
  private readonly lengths = new Float32Array(SAMPLES + 1);
  private readonly control = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly mid = new Vector3();
  private readonly dir = new Vector3();
  private readonly scale = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly matrix = new Matrix4();

  constructor() {
    const geometry = new CylinderGeometry(0.024, 0.024, 1, 6, 1);
    const material = new MeshBasicMaterial({ color: TALK_LINE, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    this.mesh = new InstancedMesh(geometry, material, this.capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  begin(): void {
    this.count = 0;
  }

  add(from: Vector3, to: Vector3, phase: number): void {
    const distance = from.distanceTo(to);
    if (distance < 0.3) return;
    this.control.addVectors(from, to).multiplyScalar(0.5);
    this.control.y += 0.3 + Math.min(2.5, distance * 0.16);
    let total = 0;
    for (let index = 0; index <= SAMPLES; index += 1) {
      const t = index / SAMPLES;
      const u = 1 - t;
      const point = this.points[index];
      point.set(
        u * u * from.x + 2 * u * t * this.control.x + t * t * to.x,
        u * u * from.y + 2 * u * t * this.control.y + t * t * to.y,
        u * u * from.z + 2 * u * t * this.control.z + t * t * to.z,
      );
      if (index > 0) total += point.distanceTo(this.points[index - 1]);
      this.lengths[index] = total;
    }
    const offset = ((phase * 0.9) % PERIOD + PERIOD) % PERIOD;
    for (let start = offset - PERIOD; start < total && this.count < this.capacity; start += PERIOD) {
      const s0 = Math.max(0, start);
      const s1 = Math.min(total, start + DASH);
      if (s1 - s0 < 0.03) continue;
      this.at(s0, this.a);
      this.at(s1, this.b);
      this.dir.subVectors(this.b, this.a);
      const length = this.dir.length();
      if (length < 1e-4) continue;
      this.dir.divideScalar(length);
      this.quaternion.setFromUnitVectors(UP, this.dir);
      this.mid.addVectors(this.a, this.b).multiplyScalar(0.5);
      this.matrix.compose(this.mid, this.quaternion, this.scale.set(1, length, 1));
      this.mesh.setMatrixAt(this.count, this.matrix);
      this.count += 1;
    }
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = this.count > 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.dispose();
  }

  private at(distance: number, target: Vector3): void {
    let index = 1;
    while (index < SAMPLES && this.lengths[index] < distance) index += 1;
    const before = this.lengths[index - 1];
    const span = this.lengths[index] - before;
    const t = span > 1e-6 ? (distance - before) / span : 0;
    target.lerpVectors(this.points[index - 1], this.points[index], t);
  }
}

type PropKit = {
  ceramic: MeshStandardMaterial;
  coffee: MeshStandardMaterial;
  cover: MeshStandardMaterial;
  paper: MeshStandardMaterial;
  wood: MeshStandardMaterial;
  rubber: MeshStandardMaterial;
  pad: MeshStandardMaterial;
  mug: CylinderGeometry;
  handle: TorusGeometry;
  coffeeTop: CylinderGeometry;
  folder: BoxGeometry;
  sheet: BoxGeometry;
  stampHandle: CylinderGeometry;
  stampBase: BoxGeometry;
  padDisc: CylinderGeometry;
};

let propKit: PropKit | null = null;

function kit(): PropKit {
  if (propKit) return propKit;
  propKit = {
    ceramic: new MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.35 }),
    coffee: new MeshStandardMaterial({ color: 0x3b2314, roughness: 0.2 }),
    cover: new MeshStandardMaterial({ color: 0x2f5fe0, roughness: 0.55 }),
    paper: new MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.85 }),
    wood: new MeshStandardMaterial({ color: 0x7a5230, roughness: 0.6 }),
    rubber: new MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.7 }),
    pad: new MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.8 }),
    mug: new CylinderGeometry(0.042, 0.038, 0.1, 16),
    handle: new TorusGeometry(0.028, 0.008, 6, 14, Math.PI),
    coffeeTop: new CylinderGeometry(0.036, 0.036, 0.004, 16),
    folder: new BoxGeometry(0.24, 0.012, 0.32),
    sheet: new BoxGeometry(0.22, 0.004, 0.3),
    stampHandle: new CylinderGeometry(0.016, 0.02, 0.08, 10),
    stampBase: new BoxGeometry(0.065, 0.024, 0.045),
    padDisc: new CylinderGeometry(0.55, 0.55, 0.05, 32),
  };
  return propKit;
}

export type Props = { mug: Group; folder: Group; stamp: Group; pad: Mesh };

function part(group: Group, geometry: BoxGeometry | CylinderGeometry | TorusGeometry, material: MeshStandardMaterial, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

export function buildProps(): Props {
  const k = kit();
  const mug = new Group();
  part(mug, k.mug, k.ceramic, 0, 0, 0);
  part(mug, k.coffeeTop, k.coffee, 0, 0.046, 0);
  const handle = part(mug, k.handle, k.ceramic, 0.042, 0, 0);
  handle.rotation.set(0, 0, -Math.PI / 2);
  const folder = new Group();
  part(folder, k.folder, k.cover, 0, 0, 0);
  part(folder, k.sheet, k.paper, 0, 0.008, 0);
  const stamp = new Group();
  part(stamp, k.stampHandle, k.wood, 0, 0.05, 0);
  part(stamp, k.stampBase, k.rubber, 0, 0, 0);
  const pad = new Mesh(k.padDisc, k.pad);
  pad.position.y = -0.03;
  pad.receiveShadow = true;
  for (const item of [mug, folder, stamp, pad]) item.visible = false;
  return { mug, folder, stamp, pad };
}

export function disposeProps(): void {
  if (!propKit) return;
  for (const value of Object.values(propKit)) value.dispose();
  propKit = null;
}
