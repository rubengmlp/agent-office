import {
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  RingGeometry,
  Vector2,
  type Camera,
  type Object3D,
} from 'three';
import { ACCENT, ASKING } from './constants';

const RING = new RingGeometry(0.42, 0.52, 48).rotateX(-Math.PI / 2);
const ASK_RING = new RingGeometry(0.58, 0.66, 48).rotateX(-Math.PI / 2);
export const PROXY_GEOMETRY = new CylinderGeometry(0.38, 0.38, 1.9, 10).translate(0, 0.95, 0);
const PROXY_MATERIAL = new MeshBasicMaterial({ visible: false });

const selectMaterial = new MeshBasicMaterial({
  color: ACCENT,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
});
const askMaterial = new MeshBasicMaterial({
  color: ASKING,
  transparent: true,
  opacity: 0.8,
  depthWrite: false,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
});

export type Rings = { select: Mesh; ask: Mesh };

export function createRings(): Rings {
  const select = new Mesh(RING, selectMaterial);
  const ask = new Mesh(ASK_RING, askMaterial);
  for (const ring of [select, ask]) {
    ring.position.y = 0.018;
    ring.renderOrder = 2;
    ring.visible = false;
  }
  return { select, ask };
}

export function createProxy(key: string): Mesh {
  const proxy = new Mesh(PROXY_GEOMETRY, PROXY_MATERIAL);
  proxy.userData.agentKey = key;
  return proxy;
}

export function pulseRings(seconds: number): void {
  selectMaterial.opacity = 0.72 + 0.22 * Math.sin(seconds * 3);
  askMaterial.opacity = 0.45 + 0.4 * Math.sin(seconds * 5.5);
}

export type PickHandlers = {
  select(key: string): void;
  follow(key: string): void;
  board(slug: string): void;
};

export type Pick = { kind: 'agent' | 'board'; id: string };

const CLICK_SLOP = 6;

export class Picker {
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private down: { x: number; y: number; button: number } | null = null;
  private hover: { x: number; y: number } | null = null;
  private hoverDirty = false;
  private hovered: string | null = null;

  constructor(
    private readonly element: HTMLElement,
    private readonly camera: Camera,
    private readonly targets: () => readonly Object3D[],
    private readonly handlers: PickHandlers,
  ) {
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointerup', this.onUp);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerleave', this.onLeave);
    element.addEventListener('dblclick', this.onDouble);
  }

  pick(clientX: number, clientY: number): Pick | null {
    const rect = this.element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.targets()], false);
    for (const hit of hits) {
      const data = hit.object.userData as { agentKey?: unknown; boardSlug?: unknown };
      if (typeof data.agentKey === 'string') return { kind: 'agent', id: data.agentKey };
      if (typeof data.boardSlug === 'string') return { kind: 'board', id: data.boardSlug };
    }
    return null;
  }

  update(): void {
    if (!this.hoverDirty) return;
    this.hoverDirty = false;
    const hit = this.hover ? this.pick(this.hover.x, this.hover.y) : null;
    const key = hit ? `${hit.kind}:${hit.id}` : null;
    if (key === this.hovered) return;
    this.hovered = key;
    this.element.style.cursor = key ? 'pointer' : '';
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onDown);
    this.element.removeEventListener('pointerup', this.onUp);
    this.element.removeEventListener('pointermove', this.onMove);
    this.element.removeEventListener('pointerleave', this.onLeave);
    this.element.removeEventListener('dblclick', this.onDouble);
    this.element.style.cursor = '';
  }

  private readonly onDown = (event: PointerEvent): void => {
    this.down = { x: event.clientX, y: event.clientY, button: event.button };
  };

  private readonly onUp = (event: PointerEvent): void => {
    const down = this.down;
    this.down = null;
    if (!down || down.button !== 0 || event.button !== 0) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP) return;
    const hit = this.pick(event.clientX, event.clientY);
    if (hit?.kind === 'agent') this.handlers.select(hit.id);
    else if (hit?.kind === 'board') this.handlers.board(hit.id);
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    this.hover = { x: event.clientX, y: event.clientY };
    this.hoverDirty = true;
  };

  private readonly onLeave = (): void => {
    this.hover = null;
    this.hoverDirty = true;
  };

  private readonly onDouble = (event: MouseEvent): void => {
    const hit = this.pick(event.clientX, event.clientY);
    if (hit?.kind !== 'agent') return;
    this.handlers.select(hit.id);
    this.handlers.follow(hit.id);
  };
}
