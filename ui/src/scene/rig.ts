import {
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  PropertyBinding,
  Quaternion,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from 'three';
import type { BoneKey, LogicalClip, Mannequin, MannequinJoint } from './assets';

export type RigBones = Partial<Record<BoneKey, Object3D>>;

export type PlayOptions = { once?: boolean; fade?: number; timeScale?: number; randomStart?: boolean };

const _a = new Vector3();
const _b = new Vector3();
const _dir = new Vector3();
const _q1 = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();

export abstract class Rig {
  abstract readonly object: Object3D;
  abstract readonly bones: RigBones;
  abstract readonly custom: boolean;
  current: LogicalClip | null = null;
  private readonly saved = new Map<Object3D, Quaternion>();
  private readonly touched = new Set<Object3D>();

  abstract has(clip: LogicalClip): boolean;
  abstract play(clip: LogicalClip, options?: PlayOptions): void;
  abstract seated(clip: LogicalClip): boolean;
  protected abstract advance(dt: number): void;
  abstract dispose(): void;

  update(dt: number): void {
    for (const bone of this.touched) {
      const base = this.saved.get(bone);
      if (base) bone.quaternion.copy(base);
    }
    this.touched.clear();
    this.advance(dt);
  }

  private touch(bone: Object3D): void {
    if (this.touched.has(bone)) return;
    let base = this.saved.get(bone);
    if (!base) {
      base = new Quaternion();
      this.saved.set(bone, base);
    }
    base.copy(bone.quaternion);
    this.touched.add(bone);
  }

  aim(key: BoneKey, tipKey: BoneKey, direction: Vector3, weight: number): void {
    const bone = this.bones[key];
    const tip = this.bones[tipKey];
    if (!bone || !tip || !bone.parent || weight <= 0.001) return;
    bone.getWorldPosition(_a);
    tip.getWorldPosition(_b);
    _dir.subVectors(_b, _a);
    if (_dir.lengthSq() < 1e-10) return;
    _dir.normalize();
    this.touch(bone);
    _q1.setFromUnitVectors(_dir, direction);
    bone.getWorldQuaternion(_q2);
    _q1.multiply(_q2);
    bone.parent.getWorldQuaternion(_q3).invert().multiply(_q1);
    bone.quaternion.slerp(_q3, Math.min(1, weight));
    bone.updateMatrixWorld(true);
  }

  turn(key: BoneKey, axis: Vector3, angle: number): void {
    const bone = this.bones[key];
    if (!bone || !bone.parent || Math.abs(angle) < 1e-4) return;
    this.touch(bone);
    bone.getWorldQuaternion(_q2);
    _q1.setFromAxisAngle(axis, angle).multiply(_q2);
    bone.parent.getWorldQuaternion(_q3).invert().multiply(_q1);
    bone.quaternion.copy(_q3);
    bone.updateMatrixWorld(true);
  }

  handPosition(side: 'L' | 'R', target: Vector3): Vector3 | null {
    const hand = this.bones[side === 'L' ? 'handL' : 'handR'];
    const lower = this.bones[side === 'L' ? 'lowerArmL' : 'lowerArmR'];
    if (!hand) return null;
    hand.getWorldPosition(target);
    if (lower) {
      lower.getWorldPosition(_a);
      _dir.subVectors(target, _a);
      const length = _dir.length();
      if (length > 1e-5) target.addScaledVector(_dir, 0.35);
    }
    return target;
  }
}

export function findBones(root: Object3D, candidates: Record<BoneKey, string[]>): RigBones {
  const byName = new Map<string, Object3D>();
  root.traverse((object) => {
    if (object.name && !byName.has(object.name)) byName.set(object.name, object);
    const original = (object.userData as { name?: unknown }).name;
    if (typeof original === 'string' && !byName.has(original)) byName.set(original, object);
  });
  const bones: RigBones = {};
  for (const key of Object.keys(candidates) as BoneKey[]) {
    for (const name of candidates[key]) {
      const found = byName.get(name) ?? byName.get(PropertyBinding.sanitizeNodeName(name));
      if (found) {
        bones[key] = found;
        break;
      }
    }
  }
  return bones;
}

export class GltfRig extends Rig {
  private readonly mixer: AnimationMixer;
  private readonly actions = new Map<LogicalClip, AnimationAction>();
  private active: AnimationAction | null = null;

  constructor(
    readonly object: Object3D,
    clips: ReadonlyMap<LogicalClip, AnimationClip>,
    readonly bones: RigBones,
    readonly custom: boolean,
    private readonly seatedClips: ReadonlySet<LogicalClip>,
  ) {
    super();
    this.mixer = new AnimationMixer(object);
    for (const [name, clip] of clips) this.actions.set(name, this.mixer.clipAction(clip));
  }

  has(clip: LogicalClip): boolean {
    return this.actions.has(clip);
  }

  seated(clip: LogicalClip): boolean {
    return this.seatedClips.has(clip);
  }

  play(clip: LogicalClip, options: PlayOptions = {}): void {
    const next = this.actions.get(clip);
    if (!next) return;
    if (this.current === clip && this.active === next) return;
    next.reset();
    next.setLoop(options.once ? LoopOnce : LoopRepeat, Infinity);
    next.clampWhenFinished = options.once === true;
    next.timeScale = options.timeScale ?? 1;
    next.setEffectiveWeight(1);
    if (options.randomStart) next.time = Math.random() * next.getClip().duration;
    next.play();
    if (this.active && this.active !== next) next.crossFadeFrom(this.active, options.fade ?? 0.3, false);
    this.active = next;
    this.current = clip;
  }

  protected advance(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.object);
  }
}

const JOINTS: readonly MannequinJoint[] = [
  'hips',
  'spine',
  'neck',
  'head',
  'upperArmL',
  'lowerArmL',
  'handL',
  'upperArmR',
  'lowerArmR',
  'handR',
  'upperLegL',
  'lowerLegL',
  'footL',
  'upperLegR',
  'lowerLegR',
  'footR',
];

const MANNEQUIN_CLIPS: ReadonlySet<LogicalClip> = new Set<LogicalClip>(['idle', 'neutral', 'walk', 'run', 'wave', 'interact', 'hit', 'death']);

const SLOT = 3;
const HIPS_Y = JOINTS.length * SLOT;
const POSE_SIZE = HIPS_Y + 1;

function writePose(clip: LogicalClip, t: number, out: Float32Array): void {
  out.fill(0);
  const set = (joint: MannequinJoint, x: number, y: number, z: number): void => {
    const index = JOINTS.indexOf(joint) * SLOT;
    out[index] = x;
    out[index + 1] = y;
    out[index + 2] = z;
  };
  const breathe = Math.sin(t * 2.1);
  switch (clip) {
    case 'walk':
    case 'run': {
      const speed = clip === 'run' ? 1.6 : 1;
      const phase = t * Math.PI * 2 * 0.95 * speed;
      const swing = Math.sin(phase);
      const amp = clip === 'run' ? 0.7 : 0.45;
      set('upperLegL', -amp * swing, 0, 0);
      set('upperLegR', amp * swing, 0, 0);
      set('lowerLegL', Math.max(0, Math.sin(phase - 1.2)) * amp * 1.3, 0, 0);
      set('lowerLegR', Math.max(0, Math.sin(phase + Math.PI - 1.2)) * amp * 1.3, 0, 0);
      set('upperArmL', amp * 0.8 * swing, 0, 0.06);
      set('upperArmR', -amp * 0.8 * swing, 0, -0.06);
      set('lowerArmL', -0.25, 0, 0);
      set('lowerArmR', -0.25, 0, 0);
      set('spine', 0.04, 0.08 * swing, 0);
      out[HIPS_Y] = Math.abs(Math.cos(phase)) * 0.025 - 0.012;
      break;
    }
    case 'wave': {
      set('upperArmR', 0, 0, -2.55);
      set('lowerArmR', 0, 0, -0.25 + Math.sin(t * 8) * 0.35);
      set('upperArmL', 0, 0, 0.08);
      set('spine', 0.02 * breathe, 0, -0.04);
      set('head', 0, 0, 0.06);
      break;
    }
    case 'interact': {
      const press = Math.sin(t * 3.2);
      set('upperArmR', -1.05 + press * 0.12, 0, -0.1);
      set('lowerArmR', -0.55 - press * 0.2, 0, 0);
      set('upperArmL', -0.2, 0, 0.08);
      set('lowerArmL', -0.3, 0, 0);
      set('spine', 0.08, 0, 0);
      set('head', 0.15, 0, 0);
      break;
    }
    case 'hit':
    case 'death': {
      const k = Math.min(1, t / 0.15) * Math.max(0, 1 - Math.max(0, t - 0.15) / (clip === 'death' ? 99 : 0.5));
      set('spine', -0.35 * k, 0, 0);
      set('head', -0.3 * k, 0, 0);
      set('upperArmL', -0.6 * k, 0, 0.5 * k);
      set('upperArmR', -0.6 * k, 0, -0.5 * k);
      set('upperLegL', -0.15 * k, 0, 0);
      out[HIPS_Y] = -0.03 * k;
      break;
    }
    case 'neutral': {
      set('spine', 0.05 + 0.015 * breathe, 0, 0);
      set('head', 0.12, 0, 0);
      set('upperArmL', -0.15, 0, 0.05);
      set('upperArmR', -0.15, 0, -0.05);
      set('lowerArmL', -0.35, 0, 0);
      set('lowerArmR', -0.35, 0, 0);
      break;
    }
    default: {
      set('spine', 0.02 * breathe, Math.sin(t * 0.7) * 0.04, 0);
      set('head', 0.02, Math.sin(t * 0.5) * 0.12, 0);
      set('upperArmL', 0.02 * breathe, 0, 0.07);
      set('upperArmR', 0.02 * breathe, 0, -0.07);
      set('lowerArmL', -0.12, 0, 0);
      set('lowerArmR', -0.12, 0, 0);
      out[HIPS_Y] = breathe * 0.004;
    }
  }
}

export class MannequinRig extends Rig {
  readonly object: Object3D;
  readonly bones: RigBones;
  readonly custom = false;
  private readonly joints: Record<MannequinJoint, Object3D>;
  private readonly hipsRest: number;
  private readonly from = new Float32Array(POSE_SIZE);
  private readonly to = new Float32Array(POSE_SIZE);
  private previous: LogicalClip | null = null;
  private previousTime = 0;
  private time = 0;
  private blend = 1;
  private fade = 0.25;
  private once = false;
  private timeScale = 1;

  constructor(private readonly mannequin: Mannequin) {
    super();
    this.object = mannequin.root;
    this.joints = mannequin.joints;
    this.hipsRest = mannequin.joints.hips.position.y;
    const j = mannequin.joints;
    this.bones = {
      head: j.head,
      neck: j.neck,
      upperArmL: j.upperArmL,
      lowerArmL: j.lowerArmL,
      handL: j.handL,
      upperArmR: j.upperArmR,
      lowerArmR: j.lowerArmR,
      handR: j.handR,
    };
    this.current = 'idle';
  }

  has(clip: LogicalClip): boolean {
    return MANNEQUIN_CLIPS.has(clip);
  }

  seated(): boolean {
    return false;
  }

  play(clip: LogicalClip, options: PlayOptions = {}): void {
    if (!this.has(clip) || clip === this.current) return;
    this.previous = this.current;
    this.previousTime = this.time;
    this.current = clip;
    this.time = options.randomStart ? Math.random() * 3 : 0;
    this.blend = 0;
    this.fade = options.fade ?? 0.25;
    this.once = options.once === true;
    this.timeScale = options.timeScale ?? 1;
  }

  protected advance(dt: number): void {
    const step = dt * this.timeScale;
    this.time += step;
    this.previousTime += step;
    if (this.once && this.current === 'wave') this.time = Math.min(this.time, 1.6);
    this.blend = Math.min(1, this.blend + dt / Math.max(0.01, this.fade));
    writePose(this.current ?? 'idle', this.time, this.to);
    if (this.previous && this.blend < 1) {
      writePose(this.previous, this.previousTime, this.from);
      for (let index = 0; index < POSE_SIZE; index += 1) this.to[index] = this.from[index] + (this.to[index] - this.from[index]) * this.blend;
    }
    JOINTS.forEach((joint, index) => {
      const base = index * SLOT;
      this.joints[joint].rotation.set(this.to[base], this.to[base + 1], this.to[base + 2]);
    });
    this.joints.hips.position.y = this.hipsRest + this.to[HIPS_Y];
  }

  dispose(): void {
    for (const material of this.mannequin.materials) material.dispose();
  }
}
