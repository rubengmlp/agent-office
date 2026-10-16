import { Color, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { ParkingLot, type Car as CarModel } from '../parking';
import { buildMannequin, type AssetLibrary, type LoadedModel } from './assets';
import { Batcher, disposeMeshes, UNIT_BOX, unitCylinder } from './batch';
import {
  BAY_W,
  CAR_HOLD_S,
  CAR_LEAVE_S,
  CAR_LEN,
  CAR_QUICK_RETURN_S,
  CAR_RETURN_S,
  CAR_VANISH_K,
  GARDEN_FAR_Z,
  GARDEN_Z0,
  GARDEN_Z1,
  HALF_D,
  PARK_AISLE_Z,
  PARK_Z,
  PATH_CLEARANCE,
  ROAD_Z,
  WALK_SPEED,
} from './constants';
import { gardenKit, hashString, prng } from './materials';
import { findBones, GltfRig, MannequinRig, type Rig } from './rig';

const CAR_W = 1.8;
const PATH_W = 1.6;
const ROAD_W = 3;
const ROAD_LEN = 600;
const DRIVER_DX = 0.9;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

class Car {
  readonly group = new Group();
  private readonly paint: Mesh;
  private readonly head: MeshStandardMaterial;
  private readonly tail: MeshStandardMaterial;
  private seed = -1;

  constructor(parent: Group) {
    const kit = gardenKit();
    this.head = kit.headlight.clone();
    this.tail = kit.taillight.clone();
    const part = (material: MeshStandardMaterial, w: number, h: number, d: number, x: number, y: number, z: number): Mesh => {
      const mesh = new Mesh(UNIT_BOX, material);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    this.paint = part(kit.paints[0], CAR_W, 0.62, CAR_LEN, 0, 0.62, 0);
    part(kit.carGlass, CAR_W - 0.16, 0.5, CAR_LEN * 0.5, 0, 1.18, 0.15);
    for (const x of [-0.55, 0.55]) {
      part(this.head, 0.32, 0.14, 0.05, x, 0.72, -CAR_LEN / 2 - 0.01);
      part(this.tail, 0.32, 0.12, 0.05, x, 0.74, CAR_LEN / 2 + 0.01);
    }
    for (const x of [-CAR_W / 2 + 0.1, CAR_W / 2 - 0.1]) {
      for (const z of [-CAR_LEN / 2 + 0.75, CAR_LEN / 2 - 0.75]) {
        const wheel = new Mesh(unitCylinder(14), kit.tyre);
        wheel.scale.set(0.66, 0.24, 0.66);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.33, z);
        wheel.castShadow = true;
        this.group.add(wheel);
      }
    }
    parent.add(this.group);
  }

  update(car: CarModel, bayX: number, vanish: number): void {
    if (car.seed !== this.seed) {
      this.seed = car.seed;
      const paints = gardenKit().paints;
      this.paint.material = paints[(car.seed >>> 9) % paints.length];
    }
    let x = bayX;
    let z = PARK_Z;
    let heading = 0;
    let lit = 0;
    if (car.state === 'leaving') {
      lit = 1;
      const hold = CAR_HOLD_S / CAR_LEAVE_S;
      const q = car.progress <= hold ? 0 : (car.progress - hold) / (1 - hold);
      if (q < 1 / 3) {
        const t = ease(q * 3);
        z = PARK_Z + (ROAD_Z - PARK_Z) * t;
        heading = -t * (Math.PI / 2);
      } else {
        const t = (q - 1 / 3) * 1.5;
        z = ROAD_Z;
        heading = -Math.PI / 2;
        x = bayX + (vanish + 4 - bayX) * t * t;
      }
    } else if (car.state === 'arriving') {
      lit = 1;
      const q = car.progress;
      if (q < 2 / 3) {
        const t = 1 - q * 1.5;
        z = ROAD_Z;
        heading = -Math.PI / 2;
        x = bayX - (vanish + 4 + bayX) * t * t;
      } else {
        const t = ease((q - 2 / 3) * 3);
        z = ROAD_Z + (PARK_Z - ROAD_Z) * t;
        heading = -(1 - t) * (Math.PI / 2);
      }
    }
    this.group.visible = car.state !== 'away' && Math.abs(x) <= vanish;
    this.group.position.set(x, 0, z);
    this.group.rotation.y = heading;
    this.head.emissiveIntensity = lit * 2.2;
    this.tail.emissiveIntensity = lit * 1.6;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.head.dispose();
    this.tail.dispose();
  }
}

type Job = 'mow' | 'prune';

class Gardener {
  readonly group = new Group();
  private rig: Rig | null = null;
  private body: Group | null = null;
  private readonly mower = new Group();
  private x = 0;
  private dir = 1;
  private disposed = false;

  constructor(
    parent: Group,
    private readonly job: Job,
    assets: AssetLibrary,
  ) {
    parent.add(this.group);
    if (job === 'mow') {
      const kit = gardenKit();
      const box = (material: MeshStandardMaterial, w: number, h: number, d: number, x: number, y: number, z: number): void => {
        const mesh = new Mesh(UNIT_BOX, material);
        mesh.scale.set(w, h, d);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        this.mower.add(mesh);
      };
      box(kit.paints[0], 0.5, 0.22, 0.6, 0, 0.2, 0);
      box(kit.tyre, 0.56, 0.1, 0.62, 0, 0.06, 0);
      box(kit.pole, 0.04, 0.04, 0.6, 0, 0.6, -0.4);
      this.mower.position.set(0, 0, 0.75);
      this.group.add(this.mower);
    }
    void assets.modelFor('skillwright').then((model) => {
      if (this.disposed) return;
      try {
        this.attach(model, assets);
      } catch {
        this.attach(null, assets);
      }
    });
  }

  update(dt: number, from: number, to: number, z: number): void {
    if (this.job === 'mow') {
      this.x = clamp(this.x, from, to) + this.dir * WALK_SPEED * 0.6 * dt;
      if (this.x >= to) this.dir = -1;
      if (this.x <= from) this.dir = 1;
      this.group.rotation.y = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      this.x = from;
      this.group.rotation.y = Math.PI;
    }
    this.group.position.set(this.x, 0, z);
    if (this.rig) {
      this.rig.play(this.job === 'mow' ? (this.rig.has('walk') ? 'walk' : 'idle') : this.rig.has('interact') ? 'interact' : 'idle');
      this.rig.update(dt);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.rig?.dispose();
    this.rig = null;
    this.group.removeFromParent();
  }

  private attach(model: LoadedModel | null, assets: AssetLibrary): void {
    if (this.body) this.body.removeFromParent();
    this.rig?.dispose();
    const body = new Group();
    if (model) {
      const object = cloneSkinned(model.scene);
      body.add(object);
      body.scale.setScalar(model.scale);
      body.position.copy(model.offset);
      object.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = false;
      });
      this.rig = new GltfRig(object, model.clips, findBones(object, assets.manifest.bones), model.custom, model.seated);
    } else {
      const mannequin = buildMannequin(new Color(0x8e5a2b), new Color(0x4b4034), new Color(0xe3b08a));
      body.add(mannequin.root);
      mannequin.root.traverse((child) => {
        if (child instanceof Mesh) child.castShadow = true;
      });
      this.rig = new MannequinRig(mannequin);
    }
    this.body = body;
    this.group.add(body);
  }
}

export type GardenSpan = { origin: Vector3; left: number; right: number; exitX: number };

export class Garden {
  readonly root = new Group();
  readonly lot = new ParkingLot(3, {
    leaveTime: CAR_LEAVE_S,
    returnAfter: CAR_RETURN_S,
    quickReturn: CAR_QUICK_RETURN_S,
    arriveTime: CAR_LEAVE_S,
  });

  private meshes: Mesh[] = [];
  private readonly cars: Car[] = [];
  private readonly mower: Gardener;
  private readonly pruner: Gardener;
  private bayX: number[] = [];
  private left = 0;
  private right = 0;
  private exitX = 0;
  private vanish = 150;
  private signature = '';

  constructor(assets: AssetLibrary) {
    this.mower = new Gardener(this.root, 'mow', assets);
    this.pruner = new Gardener(this.root, 'prune', assets);
    this.root.visible = false;
  }

  spot(bay: number): { x: number; z: number } {
    const x = this.bayX[bay] ?? this.exitX + PATH_CLEARANCE + BAY_W;
    return { x: x - DRIVER_DX, z: PARK_AISLE_Z };
  }

  update(span: GardenSpan | null): void {
    this.root.visible = span !== null;
    if (!span) return;
    this.root.position.copy(span.origin);
    this.left = span.left - span.origin.x;
    this.right = span.right - span.origin.x;
    this.exitX = span.exitX;
    const signature = [this.left, this.right, this.exitX].map((value) => value.toFixed(2)).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.bayX = this.usefulBays();
    this.lot.resize(this.bayX.length);
    while (this.cars.length < this.lot.size) this.cars.push(new Car(this.root));
    while (this.cars.length > this.lot.size) this.cars.pop()?.dispose();
    this.build();
  }

  setFar(far: number): void {
    this.vanish = CAR_VANISH_K * far;
  }

  retheme(): void {
    if (this.signature) this.build();
  }

  tick(dt: number): void {
    if (!this.root.visible) return;
    this.lot.tick(dt);
    this.lot.cars.forEach((car, index) => this.cars[index]?.update(car, this.bayX[car.bay] ?? 0, this.vanish - this.root.position.x));
    const lawnEnd = this.exitX - PATH_W / 2 - 1.2;
    this.mower.update(dt, this.left + 1, Math.max(this.left + 2, lawnEnd), GARDEN_Z0 + 4.5);
    this.pruner.update(dt, this.left + 2.2, 0, GARDEN_Z0 + 1.15);
  }

  dispose(): void {
    disposeMeshes(this.meshes);
    this.meshes = [];
    for (const car of this.cars) car.dispose();
    this.cars.length = 0;
    this.mower.dispose();
    this.pruner.dispose();
    this.root.removeFromParent();
  }

  private usefulBays(): number[] {
    const span = this.right - this.left;
    const count = clamp(Math.round(span / 5), 3, 7);
    const mid = (this.left + this.right) / 2;
    const first = mid - (count * BAY_W) / 2 + BAY_W / 2;
    const clear = (cx: number): boolean => cx + BAY_W / 2 <= this.exitX - PATH_CLEARANCE || cx - BAY_W / 2 >= this.exitX + PATH_CLEARANCE;
    const bays: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const cx = first + BAY_W * index;
      if (clear(cx)) bays.push(cx);
    }
    for (let step = 0; bays.length < 3 && step < 12; step += 1) {
      const cx = step % 2 === 0 ? first + BAY_W * (count + step / 2) : first - BAY_W * (1 + (step - 1) / 2);
      if (clear(cx)) bays.push(cx);
    }
    return bays.sort((a, b) => a - b);
  }

  private build(): void {
    disposeMeshes(this.meshes);
    const kit = gardenKit();
    const b = new Batcher();
    const left = this.left - 4;
    const right = this.right + 4;
    const width = right - left;
    const cx = (left + right) / 2;
    const exitX = this.exitX;
    const random = prng(hashString('garden'));

    b.box(kit.grass, width, 0.06, GARDEN_FAR_Z - GARDEN_Z0 + 0.5, cx, -0.03, (GARDEN_Z0 - 0.5 + GARDEN_FAR_Z) / 2, { cast: false });
    b.box(kit.asphalt, ROAD_LEN, 0.03, ROAD_W, cx, 0.0, ROAD_Z, { cast: false });
    for (let x = cx - ROAD_LEN / 2 + 1; x < cx + ROAD_LEN / 2; x += 4) b.box(kit.marking, 2, 0.01, 0.12, x, 0.02, ROAD_Z, { cast: false, receive: false });
    const lotLeft = Math.min(...this.bayX, exitX) - BAY_W / 2 - 0.4;
    const lotRight = Math.max(...this.bayX, exitX) + BAY_W / 2 + 0.4;
    const lotZ0 = PARK_AISLE_Z + 0.5;
    const lotZ1 = ROAD_Z - ROAD_W / 2;
    b.box(kit.asphalt, lotRight - lotLeft, 0.03, lotZ1 - lotZ0, (lotLeft + lotRight) / 2, 0, (lotZ0 + lotZ1) / 2, { cast: false });
    for (const bx of this.bayX) {
      for (const edge of [bx - BAY_W / 2, bx + BAY_W / 2]) b.box(kit.marking, 0.1, 0.01, CAR_LEN + 0.3, edge, 0.02, PARK_Z, { cast: false, receive: false });
    }
    b.box(kit.paving, lotRight - lotLeft, 0.04, 1.0, (lotLeft + lotRight) / 2, 0.0, PARK_AISLE_Z, { cast: false });
    b.box(kit.paving, PATH_W, 0.04, PARK_AISLE_Z - HALF_D - 5, exitX, 0.0, (HALF_D + 5 + PARK_AISLE_Z) / 2, { cast: false });
    b.box(kit.paving, PATH_W, 0.045, lotZ1 - PARK_AISLE_Z, exitX, 0.003, (PARK_AISLE_Z + lotZ1) / 2, { cast: false });

    const hedgeZ = GARDEN_Z0 + 0.4;
    for (const [from, to] of [[left + 1, exitX - PATH_W / 2 - 0.4], [exitX + PATH_W / 2 + 0.4, right - 1]] as const) {
      if (to - from < 0.5) continue;
      b.box(kit.hedge, to - from, 0.8, 0.6, (from + to) / 2, 0.4, hedgeZ);
      for (let x = from + 0.4; x < to - 0.2; x += 0.55) {
        b.sphere(kit.flowers[Math.floor(random() * kit.flowers.length)], 0.09, x, 0.12, hedgeZ + 0.55 + random() * 0.2, { cast: false });
      }
    }
    const trees = clamp(Math.round(width / 6), 4, 6);
    for (let index = 0; index < trees; index += 1) {
      const x = left + 1.5 + ((width - 3) * (index + 0.5)) / trees;
      if (Math.abs(x - exitX) < PATH_W + 1) continue;
      const z = GARDEN_Z1 - 1.4 - random() * 1.5;
      const height = 2.6 + random() * 1.2;
      b.cylinder(kit.trunk, 0.14, height, x, height / 2, z, { segments: 10 });
      b.sphere(kit.leafDark, 1.0 + random() * 0.3, x, height + 0.3, z);
      b.sphere(kit.leaf, 0.75, x + 0.45, height + 0.75, z + 0.2);
      b.sphere(kit.leaf, 0.65, x - 0.5, height + 0.55, z - 0.25);
    }
    for (const x of [lotLeft + 0.3, lotRight - 0.3, exitX - PATH_W / 2 - 0.4]) {
      b.cylinder(kit.pole, 0.05, 3.2, x, 1.6, PARK_AISLE_Z - 0.7, { segments: 8 });
      b.sphere(kit.lamp, 0.2, x, 3.25, PARK_AISLE_Z - 0.7, { cast: false });
    }
    this.meshes = b.build(this.root);
  }
}
