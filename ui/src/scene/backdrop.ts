import { BackSide, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, SRGBColorSpace, SphereGeometry, type Vector3 } from 'three';
import { Batcher, disposeMeshes } from './batch';
import { BLOCKS_FAR_K, BLOCKS_NEAR_K, SKY_RADIUS } from './constants';
import { gardenKit, prng } from './materials';

type SkyColors = { zenith: string; horizon: string; ground: string };

const DAY: SkyColors = { zenith: '#4f93d2', horizon: '#d6e7f1', ground: '#c9d6de' };
const NIGHT: SkyColors = { zenith: '#050a16', horizon: '#1c2a40', ground: '#151e2c' };
const BLOCKS = 36;

export class Backdrop {
  readonly root = new Group();

  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly dome: Mesh;
  private ring: Mesh[] = [];
  private far = 0;
  private dark = false;

  constructor() {
    this.canvas.width = 4;
    this.canvas.height = 256;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.material = new MeshBasicMaterial({ side: BackSide, fog: false, toneMapped: false, depthWrite: false, map: this.texture });
    this.dome = new Mesh(new SphereGeometry(SKY_RADIUS, 24, 12), this.material);
    this.dome.renderOrder = -1;
    this.dome.frustumCulled = false;
    this.root.add(this.dome);
    this.paint();
  }

  get horizon(): Color {
    return new Color(this.colors().horizon);
  }

  follow(eye: Vector3): void {
    this.dome.position.copy(eye);
  }

  retheme(dark: boolean): void {
    this.dark = dark;
    this.paint();
    this.build();
  }

  setFar(far: number): void {
    if (Math.abs(far - this.far) < 0.5) return;
    this.far = far;
    this.build();
  }

  dispose(): void {
    disposeMeshes(this.ring);
    this.ring = [];
    this.dome.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.root.removeFromParent();
  }

  private colors(): SkyColors {
    return this.dark ? NIGHT : DAY;
  }

  private paint(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { zenith, horizon, ground } = this.colors();
    const gradient = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    gradient.addColorStop(0, zenith);
    gradient.addColorStop(0.42, horizon);
    gradient.addColorStop(0.5, horizon);
    gradient.addColorStop(1, ground);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  private build(): void {
    disposeMeshes(this.ring);
    this.ring = [];
    if (this.far <= 0) return;
    const kit = gardenKit();
    const random = prng(97);
    const near = this.far * BLOCKS_NEAR_K;
    const span = this.far * (BLOCKS_FAR_K - BLOCKS_NEAR_K);
    const b = new Batcher();
    for (let index = 0; index < BLOCKS; index += 1) {
      const angle = ((index + random() * 0.6) / BLOCKS) * Math.PI * 2;
      const distance = near + random() * span;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const height = 6 + random() * 18;
      const width = 6 + random() * 10;
      b.box(kit.blocks[index % kit.blocks.length], width, height, 5 + random() * 8, x, height / 2, z, { ry: angle, cast: false, receive: false });
      if (index % 3 === 0) {
        const tx = Math.cos(angle + 0.05) * (distance - 8);
        const tz = Math.sin(angle + 0.05) * (distance - 8);
        b.cylinder(kit.trunk, 0.4, 3, tx, 1.5, tz, { segments: 6, cast: false, receive: false });
        b.sphere(kit.leafDark, 2.4, tx, 4.2, tz, { cast: false, receive: false });
        b.sphere(kit.leaf, 1.7, tx + 0.8, 5.4, tz, { cast: false, receive: false });
      }
    }
    this.ring = b.build(this.root);
  }
}
