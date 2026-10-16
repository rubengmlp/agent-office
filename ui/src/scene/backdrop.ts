import { BackSide, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, SRGBColorSpace, SphereGeometry, type BufferGeometry, type MeshStandardMaterial, type Vector3 } from 'three';
import { UNIT_BOX } from './batch';
import { BLOCKS_FAR_K, BLOCKS_GAP, BLOCKS_HAZE, BLOCKS_RING, SKY_RADIUS } from './constants';
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
  private ring: Group[] = [];
  private far = 0;
  private radius = 0;
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
    for (const block of this.ring) block.visible = block.position.x * eye.x + block.position.z * eye.z < 0;
  }

  retheme(dark: boolean): void {
    this.dark = dark;
    this.paint();
    const horizon = this.horizon;
    for (const block of gardenKit().blocks) block.color.lerp(horizon, BLOCKS_HAZE);
  }

  setFar(far: number, radius: number): void {
    if (Math.abs(far - this.far) < 0.5 && Math.abs(radius - this.radius) < 0.5) return;
    this.far = far;
    this.radius = radius;
    this.build();
  }

  dispose(): void {
    this.clearRing();
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

  private clearRing(): void {
    for (const block of this.ring) block.removeFromParent();
    this.ring = [];
  }

  private build(): void {
    this.clearRing();
    if (this.far <= 0) return;
    const kit = gardenKit();
    const random = prng(97);
    const near = this.radius + BLOCKS_GAP;
    const span = Math.max(10, Math.min(BLOCKS_RING, this.far * BLOCKS_FAR_K - near));
    const part = (parent: Group, geometry: BufferGeometry, material: MeshStandardMaterial, w: number, h: number, d: number, x: number, y: number, z: number): void => {
      const mesh = new Mesh(geometry, material);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
    };
    for (let index = 0; index < BLOCKS; index += 1) {
      const angle = ((index + random() * 0.6) / BLOCKS) * Math.PI * 2;
      const distance = near + random() * span;
      const block = new Group();
      block.position.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
      block.rotation.y = -angle;
      const height = 6 + random() * 18;
      part(block, UNIT_BOX, kit.blocks[index % kit.blocks.length], 6 + random() * 10, height, 5 + random() * 8, 0, height / 2, 0);
      this.root.add(block);
      this.ring.push(block);
    }
  }
}
