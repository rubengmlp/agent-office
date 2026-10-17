import { resolveOverride, withDesk, withFurniture, withLead } from '../layouts';
import { DESK_D, DESK_W, LAB_BENCH_LEN, LEAD_DESK_D, LEAD_DESK_W, LEAD_ZONE, MEET_D, MEET_W, MIN_COLS, MIN_COLS_ANNEX, PITCH, UTIL_ZONE } from '../scene/constants';
import { buildingOf, computeFloorPlan, deskCount, furniturePlaced, requiredCols, worldToSpot } from '../scene/layout';
import type { AgentView, FloorView, FurnitureKind, LayoutsFile, Spot } from '../types';

export type EditorKind = 'lead' | 'desk' | FurnitureKind;

// A thing on the floor the user can drag: where its centre is and how big it is, in metres.
export type EditorItem = { kind: EditorKind; index: number; x: number; z: number; w: number; d: number };

export type EditorView = { width: number; items: EditorItem[] };

const SIZES: Record<FurnitureKind, { w: number; d: number }> = {
  coffee: { w: 2.2, d: 0.62 },
  meeting: { w: MEET_W, d: MEET_D },
  lab: { w: LAB_BENCH_LEN, d: 0.72 },
  board: { w: 1.4, d: 0.5 },
  printer: { w: 0.62, d: 0.52 },
};

// Every floor of a building is as wide as its widest one; this is the width the 3D scene gives this floor.
export function floorWidth(floor: FloorView, floors: readonly FloorView[], byFloor: ReadonlyMap<string, readonly AgentView[]>, order: (key: string) => number): { width: number; cols: number } {
  const building = buildingOf(floor);
  const minimum = building === 'main' ? MIN_COLS : MIN_COLS_ANNEX;
  let cols = minimum;
  for (const other of floors) {
    if (buildingOf(other) === building) cols = Math.max(cols, requiredCols(deskCount(other, byFloor.get(other.slug) ?? [], order), minimum));
  }
  return { width: LEAD_ZONE + cols * PITCH + UTIL_ZONE, cols };
}

// The floor as the 3D scene lays it out, with what the user already moved: the plan snaps desks to rows and
// sends the overlapping ones back, so the editor draws the same thing the scene will.
export function editorView(
  floor: FloorView,
  floors: readonly FloorView[],
  byFloor: ReadonlyMap<string, readonly AgentView[]>,
  order: (key: string) => number,
  file: LayoutsFile,
): EditorView {
  const { width, cols } = floorWidth(floor, floors, byFloor, order);
  const override = resolveOverride(file, floor.slug);
  const plan = computeFloorPlan(floor, byFloor.get(floor.slug) ?? [], width, cols, order, override);
  const items: EditorItem[] = [];
  const placed = furniturePlaced(floor, width, override);
  (Object.keys(SIZES) as FurnitureKind[]).forEach((kind, index) => items.push({ kind, index, x: placed[kind].x, z: placed[kind].z, ...SIZES[kind] }));
  plan.slots.forEach((slot, index) => items.push({ kind: 'desk', index, x: slot.x, z: slot.z, w: DESK_W * slot.scale, d: DESK_D * slot.scale }));
  if (plan.leadSlot) items.push({ kind: 'lead', index: -1, x: plan.leadSlot.x, z: plan.leadSlot.z, w: LEAD_DESK_W, d: LEAD_DESK_D });
  return { width, items };
}

// The item under a point, the last drawn first (the lead and the desks sit over the furniture).
export function hitItem(items: readonly EditorItem[], x: number, z: number): EditorItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (Math.abs(x - item.x) <= item.w / 2 && Math.abs(z - item.z) <= item.d / 2) return item;
  }
  return null;
}

export function dropSpot(x: number, z: number, width: number): Spot {
  return worldToSpot(x, z, width);
}

// The layout with the item dropped at that spot.
export function applyDrop(file: LayoutsFile, slug: string, item: EditorItem, spot: Spot): LayoutsFile {
  if (item.kind === 'lead') return withLead(file, slug, spot);
  if (item.kind === 'desk') return withDesk(file, slug, item.index, spot);
  return withFurniture(file, slug, item.kind, spot);
}
