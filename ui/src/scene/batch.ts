import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  FrontSide,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const UNIT_BOX = new BoxGeometry(1, 1, 1);
export const UNIT_SPHERE = new SphereGeometry(0.5, 18, 12);

const cylinders = new Map<string, CylinderGeometry>();

export function unitCylinder(segments = 18, topRatio = 1): CylinderGeometry {
  const key = `${segments}|${topRatio.toFixed(3)}`;
  let geometry = cylinders.get(key);
  if (!geometry) {
    geometry = new CylinderGeometry(0.5 * topRatio, 0.5, 1, segments);
    cylinders.set(key, geometry);
  }
  return geometry;
}

export type Pose = { rx?: number; ry?: number; rz?: number };

const _position = new Vector3();
const _scale = new Vector3();
const _quaternion = new Quaternion();
const _euler = new Euler();

export function transform(x: number, y: number, z: number, sx: number, sy: number, sz: number, pose: Pose = {}): Matrix4 {
  _euler.set(pose.rx ?? 0, pose.ry ?? 0, pose.rz ?? 0, 'YXZ');
  _quaternion.setFromEuler(_euler);
  return new Matrix4().compose(_position.set(x, y, z), _quaternion, _scale.set(sx, sy, sz));
}

export type PartOptions = Pose & { cast?: boolean; receive?: boolean };

type Bucket = { material: Material; cast: boolean; receive: boolean; parts: BufferGeometry[] };

type ColorClass = 'matte' | 'gloss' | 'metal';

const vertexMaterials = new Map<ColorClass, MeshStandardMaterial>();

function vertexMaterial(kind: ColorClass): MeshStandardMaterial {
  let material = vertexMaterials.get(kind);
  if (!material) {
    material = new MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: kind === 'matte' ? 0.82 : kind === 'gloss' ? 0.45 : 0.35,
      metalness: kind === 'metal' ? 0.8 : 0,
    });
    vertexMaterials.set(kind, material);
  }
  return material;
}

function colorClass(material: Material): ColorClass | null {
  if (!(material instanceof MeshStandardMaterial)) return null;
  if (material.transparent || material.opacity < 1 || material.vertexColors || material.side !== FrontSide) return null;
  if (material.map || material.emissiveMap) return null;
  if (material.emissiveIntensity > 0 && material.emissive.r + material.emissive.g + material.emissive.b > 0) return null;
  if (material.metalness >= 0.5) return 'metal';
  return material.roughness >= 0.6 ? 'matte' : 'gloss';
}

export function disposeBatchMaterials(): void {
  for (const material of vertexMaterials.values()) material.dispose();
  vertexMaterials.clear();
}

export class Batcher {
  private readonly buckets = new Map<string, Bucket>();
  private readonly frame: Matrix4 | null;

  constructor(frame: Matrix4 | null = null) {
    this.frame = frame;
  }

  get empty(): boolean {
    return this.buckets.size === 0;
  }

  private parent: Batcher | null = null;

  within(frame: Matrix4): Batcher {
    const child = new Batcher(frame.clone());
    child.parent = this;
    return child;
  }

  add(geometry: BufferGeometry, material: Material, matrix: Matrix4, cast = true, receive = true): void {
    if (this.parent) {
      this.parent.add(geometry, material, this.frame ? this.frame.clone().multiply(matrix) : matrix, cast, receive);
      return;
    }
    const part = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    part.applyMatrix4(this.frame ? this.frame.clone().multiply(matrix) : matrix);
    for (const name of Object.keys(part.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') part.deleteAttribute(name);
    }
    part.clearGroups();
    const flags = `${cast ? 1 : 0}|${receive ? 1 : 0}`;
    const kind = colorClass(material);
    let key = `${material.uuid}|${flags}`;
    let target = material;
    if (kind !== null && material instanceof MeshStandardMaterial) {
      const count = part.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      const { r, g, b } = material.color;
      for (let index = 0; index < count; index += 1) {
        colors[index * 3] = r;
        colors[index * 3 + 1] = g;
        colors[index * 3 + 2] = b;
      }
      part.setAttribute('color', new Float32BufferAttribute(colors, 3));
      key = `vc|${kind}|${flags}`;
      target = vertexMaterial(kind);
    }
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { material: target, cast, receive, parts: [] };
      this.buckets.set(key, bucket);
    }
    bucket.parts.push(part);
  }

  box(material: Material, w: number, h: number, d: number, x: number, y: number, z: number, options: PartOptions = {}): void {
    this.add(UNIT_BOX, material, transform(x, y, z, w, h, d, options), options.cast ?? true, options.receive ?? true);
  }

  cylinder(
    material: Material,
    radius: number,
    height: number,
    x: number,
    y: number,
    z: number,
    options: PartOptions & { segments?: number; topRatio?: number } = {},
  ): void {
    const geometry = unitCylinder(options.segments ?? 18, options.topRatio ?? 1);
    this.add(geometry, material, transform(x, y, z, radius * 2, height, radius * 2, options), options.cast ?? true, options.receive ?? true);
  }

  sphere(material: Material, radius: number, x: number, y: number, z: number, options: PartOptions & { sx?: number; sy?: number; sz?: number } = {}): void {
    const d = radius * 2;
    this.add(
      UNIT_SPHERE,
      material,
      transform(x, y, z, d * (options.sx ?? 1), d * (options.sy ?? 1), d * (options.sz ?? 1), options),
      options.cast ?? true,
      options.receive ?? true,
    );
  }

  geometry(geometry: BufferGeometry, material: Material, x: number, y: number, z: number, options: PartOptions & { scale?: number } = {}): void {
    const s = options.scale ?? 1;
    this.add(geometry, material, transform(x, y, z, s, s, s, options), options.cast ?? true, options.receive ?? true);
  }

  build(parent: Object3D): Mesh[] {
    const meshes: Mesh[] = [];
    for (const bucket of this.buckets.values()) {
      let merged: BufferGeometry | null;
      if (bucket.parts.length === 1) {
        merged = bucket.parts[0];
      } else {
        merged = mergeGeometries(bucket.parts, false) as BufferGeometry | null;
        for (const part of bucket.parts) part.dispose();
      }
      if (!merged) continue;
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, bucket.material);
      mesh.castShadow = bucket.cast;
      mesh.receiveShadow = bucket.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}

export function disposeMeshes(meshes: readonly Mesh[]): void {
  for (const mesh of meshes) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }
}
