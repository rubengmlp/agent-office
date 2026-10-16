import {
  Bone,
  Box3,
  BoxGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type AnimationClip,
  type BufferGeometry,
  type Color,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { RoleKind } from '../types';

export type LogicalClip = 'idle' | 'neutral' | 'walk' | 'run' | 'wave' | 'interact' | 'hit' | 'death' | 'sit' | 'type' | 'talk' | 'think';

const LOGICAL_CLIPS: ReadonlySet<string> = new Set<LogicalClip>([
  'idle',
  'neutral',
  'walk',
  'run',
  'wave',
  'interact',
  'hit',
  'death',
  'sit',
  'type',
  'talk',
  'think',
]);

export type BoneKey = 'head' | 'neck' | 'upperArmL' | 'lowerArmL' | 'handL' | 'upperArmR' | 'lowerArmR' | 'handR';

export const BONE_KEYS: readonly BoneKey[] = ['head', 'neck', 'upperArmL', 'lowerArmL', 'handL', 'upperArmR', 'lowerArmR', 'handR'];

export type RoleSpec = { model: string; vary: string[]; tint: Record<string, string> };

export type Manifest = {
  version: number;
  height: number;
  pack: { clips: Partial<Record<LogicalClip, string>> };
  custom: { dir: string; clips: Partial<Record<LogicalClip, string>>; seated: LogicalClip[] };
  bones: Record<BoneKey, string[]>;
  variety: Record<string, string[]>;
  roles: Partial<Record<RoleKind, RoleSpec>>;
};

const role = (model: string, vary: string[] = [], tint: Record<string, string> = {}): RoleSpec => ({ model, vary, tint });

export const DEFAULT_MANIFEST: Manifest = {
  version: 1,
  height: 1.75,
  pack: {
    clips: {
      idle: 'CharacterArmature|Idle',
      neutral: 'CharacterArmature|Idle_Neutral',
      walk: 'CharacterArmature|Walk',
      run: 'CharacterArmature|Run',
      wave: 'CharacterArmature|Wave',
      interact: 'CharacterArmature|Interact',
      hit: 'CharacterArmature|HitRecieve',
      death: 'CharacterArmature|Death',
    },
  },
  custom: {
    dir: 'custom/',
    clips: { idle: 'idle', walk: 'walk', sit: 'sit', type: 'type', talk: 'talk', wave: 'wave', think: 'think' },
    seated: ['sit', 'type'],
  },
  bones: {
    head: ['Head', 'mixamorig:Head', 'head'],
    neck: ['Neck', 'mixamorig:Neck', 'neck'],
    upperArmL: ['UpperArm.L', 'mixamorig:LeftArm', 'LeftArm', 'upper_arm.L'],
    lowerArmL: ['LowerArm.L', 'mixamorig:LeftForeArm', 'LeftForeArm', 'forearm.L'],
    handL: ['Wrist.L', 'mixamorig:LeftHand', 'LeftHand', 'hand.L'],
    upperArmR: ['UpperArm.R', 'mixamorig:RightArm', 'RightArm', 'upper_arm.R'],
    lowerArmR: ['LowerArm.R', 'mixamorig:RightForeArm', 'RightForeArm', 'forearm.R'],
    handR: ['Wrist.R', 'mixamorig:RightHand', 'RightHand', 'hand.R'],
  },
  variety: {
    Skin: ['#f1c9a5', '#e3b08a', '#c98f62', '#a06a45', '#74492c'],
    Hair: ['#2b1d14', '#4a2f1d', '#6e4a2c', '#b8894f', '#1c1c1e', '#8a8a8c'],
  },
  roles: {
    director: role('quaternius/business-man.glb'),
    lead: role('quaternius/casual.glb'),
    dev: role('quaternius/hoodie.glb', ['Purple']),
    tester: role('quaternius/worker.glb'),
    reviewer: role('quaternius/punk.glb'),
    writer: role('quaternius/adventurer.glb'),
    planReviewer: role('quaternius/adventurer.glb', [], { Green: '#2f3f5f', LightGreen: '#4d618a' }),
    skillwright: role('quaternius/farmer.glb'),
    skillReviewer: role('quaternius/swat.glb'),
    intern: role('quaternius/beach.glb', [], { LightBrown: '#d3d9e0' }),
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

function isLogical(value: string): value is LogicalClip {
  return LOGICAL_CLIPS.has(value);
}

function clipRecord(value: unknown): Partial<Record<LogicalClip, string>> {
  const out: Partial<Record<LogicalClip, string>> = {};
  for (const [key, name] of Object.entries(stringRecord(value))) {
    if (isLogical(key)) out[key] = name;
  }
  return out;
}

export function parseManifest(data: unknown): Manifest {
  const base = DEFAULT_MANIFEST;
  if (!isRecord(data)) return base;
  const pack: Record<string, unknown> = isRecord(data.pack) ? data.pack : {};
  const custom: Record<string, unknown> = isRecord(data.custom) ? data.custom : {};
  const bones: Record<BoneKey, string[]> = { ...base.bones };
  if (isRecord(data.bones)) {
    for (const key of BONE_KEYS) {
      const list = stringList(data.bones[key]);
      if (list.length > 0) bones[key] = list;
    }
  }
  let variety: Record<string, string[]> = { ...base.variety };
  if (isRecord(data.variety)) {
    variety = {};
    for (const [key, value] of Object.entries(data.variety)) {
      const list = stringList(value);
      if (list.length > 0) variety[key] = list;
    }
  }
  const roles: Partial<Record<RoleKind, RoleSpec>> = { ...base.roles };
  if (isRecord(data.roles)) {
    for (const [key, value] of Object.entries(data.roles)) {
      if (!isRecord(value) || typeof value.model !== 'string') continue;
      roles[key as RoleKind] = { model: value.model, vary: stringList(value.vary), tint: stringRecord(value.tint) };
    }
  }
  const seated = custom.seated === undefined ? base.custom.seated : stringList(custom.seated).filter(isLogical);
  return {
    version: typeof data.version === 'number' ? data.version : base.version,
    height: typeof data.height === 'number' && data.height > 0.5 && data.height < 4 ? data.height : base.height,
    pack: { clips: { ...base.pack.clips, ...clipRecord(pack.clips) } },
    custom: {
      dir: typeof custom.dir === 'string' ? custom.dir : base.custom.dir,
      clips: { ...base.custom.clips, ...clipRecord(custom.clips) },
      seated,
    },
    bones,
    variety,
    roles,
  };
}

export async function loadManifest(url: string): Promise<Manifest> {
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) return DEFAULT_MANIFEST;
    return parseManifest(await response.json());
  } catch {
    return DEFAULT_MANIFEST;
  }
}

async function listCustom(url: string): Promise<Set<string>> {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) return new Set();
    const names: unknown = await response.json();
    return new Set(Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : []);
  } catch {
    return new Set();
  }
}

export type LoadedModel = {
  url: string;
  custom: boolean;
  scene: Group;
  clips: Map<LogicalClip, AnimationClip>;
  scale: number;
  offset: Vector3;
  seated: ReadonlySet<LogicalClip>;
};

function findClip(clips: readonly AnimationClip[], wanted: string): AnimationClip | undefined {
  const lower = wanted.toLowerCase();
  return (
    clips.find((clip) => clip.name === wanted) ??
    clips.find((clip) => clip.name.toLowerCase() === lower) ??
    clips.find((clip) => clip.name.toLowerCase().endsWith(`|${lower}`)) ??
    clips.find((clip) => clip.name.toLowerCase().includes(lower))
  );
}

function rootBoneName(scene: Object3D): string | null {
  const bones: Bone[] = [];
  scene.traverse((object) => {
    if (object instanceof Bone) bones.push(object);
  });
  return bones.length > 0 ? bones[0].name : null;
}

function stripRootMotion(clip: AnimationClip, rootName: string): void {
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0 || track.name.slice(0, dot) !== rootName || track.name.slice(dot + 1) !== 'position') continue;
    const values = track.values;
    if (values.length < 3) continue;
    const x = values[0];
    const z = values[2];
    for (let index = 0; index + 2 < values.length; index += 3) {
      values[index] = x;
      values[index + 2] = z;
    }
  }
}

export class AssetLibrary {
  private readonly loader = new GLTFLoader();
  private readonly byUrl = new Map<string, Promise<LoadedModel | null>>();
  private readonly byRole = new Map<RoleKind, Promise<LoadedModel | null>>();
  private customList: Promise<Set<string>> | null = null;

  constructor(
    readonly base: string,
    readonly manifest: Manifest,
  ) {}

  spec(kind: RoleKind): RoleSpec | undefined {
    return this.manifest.roles[kind] ?? this.manifest.roles.dev;
  }

  modelFor(kind: RoleKind): Promise<LoadedModel | null> {
    let pending = this.byRole.get(kind);
    if (!pending) {
      pending = this.resolve(kind);
      this.byRole.set(kind, pending);
    }
    return pending;
  }

  dispose(): void {
    for (const pending of this.byUrl.values()) {
      void pending.then((model) => {
        if (!model) return;
        model.scene.traverse((object) => {
          if (object instanceof Mesh) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            for (const material of materials) material.dispose();
          }
        });
      });
    }
    this.byUrl.clear();
    this.byRole.clear();
    this.customList = null;
  }

  private customNames(): Promise<Set<string>> {
    this.customList ??= listCustom(`${this.base}${this.manifest.custom.dir}index.json`);
    return this.customList;
  }

  private async resolve(kind: RoleKind): Promise<LoadedModel | null> {
    const customUrl = `${this.base}${this.manifest.custom.dir}${kind}.glb`;
    if ((await this.customNames()).has(`${kind}.glb`)) {
      const custom = await this.load(customUrl, true);
      if (custom) return custom;
    }
    const spec = this.spec(kind);
    if (!spec) return null;
    return this.load(`${this.base}${spec.model}`, false);
  }

  private load(url: string, custom: boolean): Promise<LoadedModel | null> {
    const key = `${custom ? 'custom' : 'pack'}|${url}`;
    let pending = this.byUrl.get(key);
    if (!pending) {
      pending = this.loader
        .loadAsync(url)
        .then((gltf) => this.prepare(url, custom, gltf.scene, gltf.animations))
        .catch((error: unknown) => {
          console.warn(`Agent Office: no se pudo cargar ${url}`, error);
          return null;
        });
      this.byUrl.set(key, pending);
    }
    return pending;
  }

  private prepare(url: string, custom: boolean, scene: Group, animations: readonly AnimationClip[]): LoadedModel {
    scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(scene, true);
    const size = box.getSize(new Vector3());
    const height = Number.isFinite(size.y) && size.y > 0.01 ? size.y : 1.8;
    const scale = this.manifest.height / height;
    const center = box.getCenter(new Vector3());
    const offset = new Vector3(
      Number.isFinite(center.x) ? -center.x * scale : 0,
      Number.isFinite(box.min.y) ? -box.min.y * scale : 0,
      Number.isFinite(center.z) ? -center.z * scale : 0,
    );
    const mapping = custom ? this.manifest.custom.clips : this.manifest.pack.clips;
    const clips = new Map<LogicalClip, AnimationClip>();
    for (const [logical, name] of Object.entries(mapping)) {
      if (typeof name !== 'string' || !isLogical(logical)) continue;
      const clip = findClip(animations, name);
      if (clip) clips.set(logical, clip);
    }
    if (custom) {
      const root = rootBoneName(scene);
      const walk = clips.get('walk');
      if (root && walk) stripRootMotion(walk, root);
    }
    const seated = new Set<LogicalClip>(custom ? this.manifest.custom.seated.filter((clip) => clips.has(clip)) : []);
    return { url, custom, scene, clips, scale, offset, seated };
  }
}

export type MannequinJoint =
  | 'hips'
  | 'spine'
  | 'neck'
  | 'head'
  | 'upperArmL'
  | 'lowerArmL'
  | 'handL'
  | 'upperArmR'
  | 'lowerArmR'
  | 'handR'
  | 'upperLegL'
  | 'lowerLegL'
  | 'footL'
  | 'upperLegR'
  | 'lowerLegR'
  | 'footR';

export type Mannequin = { root: Group; joints: Record<MannequinJoint, Group>; materials: MeshStandardMaterial[] };

const geometries = new Map<string, BufferGeometry>();

function capsule(radius: number, length: number): BufferGeometry {
  const key = `c|${radius}|${length}`;
  let geometry = geometries.get(key);
  if (!geometry) {
    geometry = new CapsuleGeometry(radius, length, 4, 12);
    geometries.set(key, geometry);
  }
  return geometry;
}

function sphere(radius: number): BufferGeometry {
  const key = `s|${radius}`;
  let geometry = geometries.get(key);
  if (!geometry) {
    geometry = new SphereGeometry(radius, 16, 12);
    geometries.set(key, geometry);
  }
  return geometry;
}

function block(w: number, h: number, d: number): BufferGeometry {
  const key = `b|${w}|${h}|${d}`;
  let geometry = geometries.get(key);
  if (!geometry) {
    geometry = new BoxGeometry(w, h, d);
    geometries.set(key, geometry);
  }
  return geometry;
}

export function buildMannequin(shirt: Color, pants: Color, skin: Color): Mannequin {
  const top = new MeshStandardMaterial({ color: shirt, roughness: 0.75 });
  const bottom = new MeshStandardMaterial({ color: pants, roughness: 0.8 });
  const flesh = new MeshStandardMaterial({ color: skin, roughness: 0.6 });
  const dark = new MeshStandardMaterial({ color: 0x1d2026, roughness: 0.5 });
  const materials = [top, bottom, flesh, dark];
  const joint = (parent: Object3D, x: number, y: number, z: number): Group => {
    const group = new Group();
    group.position.set(x, y, z);
    parent.add(group);
    return group;
  };
  const part = (parent: Object3D, geometry: BufferGeometry, material: MeshStandardMaterial, x: number, y: number, z: number): Mesh => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const root = new Group();
  const hips = joint(root, 0, 0.92, 0);
  part(hips, sphere(0.16), bottom, 0, 0, 0).scale.set(1.05, 0.7, 0.75);
  const spine = joint(hips, 0, 0.06, 0);
  part(spine, capsule(0.165, 0.26), top, 0, 0.24, 0).scale.set(1.1, 1, 0.75);
  const neck = joint(spine, 0, 0.5, 0);
  part(neck, capsule(0.045, 0.05), flesh, 0, 0.04, 0);
  const head = joint(neck, 0, 0.1, 0);
  part(head, sphere(0.115), flesh, 0, 0.1, 0.005).scale.set(0.95, 1.08, 1);
  part(head, sphere(0.018), dark, 0.04, 0.12, 0.1);
  part(head, sphere(0.018), dark, -0.04, 0.12, 0.1);
  part(head, sphere(0.118), dark, 0, 0.15, -0.012).scale.set(1, 0.62, 1);

  const arm = (side: 1 | -1): [Group, Group, Group] => {
    const upper = joint(spine, side * 0.215, 0.43, 0);
    part(upper, capsule(0.05, 0.2), top, 0, -0.13, 0);
    const lower = joint(upper, 0, -0.28, 0);
    part(lower, capsule(0.044, 0.18), top, 0, -0.12, 0);
    const hand = joint(lower, 0, -0.25, 0);
    part(hand, sphere(0.048), flesh, 0, -0.04, 0.01);
    return [upper, lower, hand];
  };
  const leg = (side: 1 | -1): [Group, Group, Group] => {
    const upper = joint(hips, side * 0.095, -0.02, 0);
    part(upper, capsule(0.07, 0.28), bottom, 0, -0.2, 0);
    const lower = joint(upper, 0, -0.42, 0);
    part(lower, capsule(0.058, 0.3), bottom, 0, -0.2, 0);
    const foot = joint(lower, 0, -0.42, 0);
    part(foot, block(0.1, 0.07, 0.24), dark, 0, -0.035, 0.05);
    return [upper, lower, foot];
  };
  const [upperArmL, lowerArmL, handL] = arm(1);
  const [upperArmR, lowerArmR, handR] = arm(-1);
  const [upperLegL, lowerLegL, footL] = leg(1);
  const [upperLegR, lowerLegR, footR] = leg(-1);
  return {
    root,
    joints: { hips, spine, neck, head, upperArmL, lowerArmL, handL, upperArmR, lowerArmR, handR, upperLegL, lowerLegL, footL, upperLegR, lowerLegR, footR },
    materials,
  };
}
