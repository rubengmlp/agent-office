import type { LiftFace } from '../lift';
import type { AgentView, FloorLayoutOverride, FloorView, FurnitureKind, MessageView, RoleKind, Spot } from '../types';
import {
  AISLE_Z,
  CHILD_SCALE,
  COFFEE_DX,
  COFFEE_STAND_DX,
  COFFEE_STAND_DZ,
  COFFEE_Z,
  DEPTH,
  HALF_D,
  LAB_BENCH_DX,
  LAB_LANE_DX,
  LAB_QUEUE_STEP,
  LAB_STAND_DX,
  LAB_STAND_Z,
  LEAD_DESK_DX,
  LEAD_DESK_Z,
  LEAD_LANE_DX,
  LEAD_STAND_OFFSET,
  LEAD_ZONE,
  MEET_D,
  MEET_DX,
  MEET_W,
  MEET_Z,
  MEETING_WINDOW_MS,
  PITCH,
  PRINTER_DX,
  PRINTER_Z,
  ROAD_Z,
  ROW_DESK_Z,
  ROWS,
  STAND_OFFSET,
} from './constants';

export type BuildingId = 'main' | 'annex';

export type SlotKind = 'lead' | 'desk' | 'child';

export type DeskSlot = {
  index: number;
  kind: SlotKind;
  x: number;
  z: number;
  standX: number;
  standZ: number;
  lane: number;
  scale: number;
};

export type FloorPlan = {
  slug: string;
  view: FloorView;
  leadSlot: DeskSlot | null;
  slots: DeskSlot[];
  assignment: Map<string, DeskSlot>;
};

export type TargetKind = 'desk' | 'lab' | 'meeting' | 'coffee' | 'exit';

export type Target = {
  id: string;
  kind: TargetKind;
  floor: string;
  x: number;
  z: number;
  lane: number;
  facing: number;
  slot: DeskSlot | null;
};

export type Waypoint = { floor: string; x: number; z: number; lane: number | null };

export type FloorNav = { slug: string; building: BuildingId; level: number; width: number; exitX: number };

export type Nav = { floors: Map<string, FloorNav>; mainGround: string | null; annexGround: string | null };

export const STREET = 'calle';

export const STREET_DX = 2.5;

export const STREET_Z = HALF_D + 1.5;

export function streetNav(ground: FloorNav): FloorNav {
  return { slug: STREET, building: ground.building, level: 0, width: ground.width, exitX: ground.exitX };
}

export function exitTarget(nav: Nav, spot?: { x: number; z: number }): Target | null {
  const street = nav.floors.get(STREET);
  if (!street) return null;
  if (spot) return { id: 'exit', kind: 'exit', floor: STREET, x: spot.x, z: spot.z, lane: street.exitX, facing: 0, slot: null };
  const x = street.exitX + (street.building === 'main' ? STREET_DX : -STREET_DX);
  return { id: 'exit', kind: 'exit', floor: STREET, x, z: STREET_Z, lane: street.exitX, facing: 0, slot: null };
}

export function streetPoint(nav: Nav): Waypoint | null {
  const street = nav.floors.get(STREET);
  return street ? { floor: STREET, x: street.exitX, z: ROAD_Z - 1, lane: street.exitX } : null;
}

export type LiftStops = ReadonlyMap<string, number>;

export type LiftLeg = { from: string; to: string; fromFace: LiftFace; toFace: LiftFace; approach: boolean };

export function servesLift(a: string, b: string, nav: Nav, stops: LiftStops): boolean {
  const from = nav.floors.get(a);
  const to = nav.floors.get(b);
  if (!from || !to || a === b || from.building !== 'main' || to.building !== 'main') return false;
  const fromY = stops.get(a);
  const toY = stops.get(b);
  return fromY !== undefined && toY !== undefined && Math.abs(fromY - toY) > EPS;
}

function atMouth(point: Waypoint, nav: Nav): boolean {
  const floor = nav.floors.get(point.floor);
  return floor !== undefined && Math.abs(point.x - floor.exitX) < EPS && Math.abs(point.z - AISLE_Z) < EPS;
}

export function liftLeg(at: Waypoint, path: readonly Waypoint[], nav: Nav, stops: LiftStops, viaBridge: boolean): LiftLeg | null {
  const [first, second, third] = path;
  if (!first || !atMouth(first, nav)) return null;
  let from: string;
  let to: string;
  let next: Waypoint | undefined;
  let approach: boolean;
  if (first.floor !== at.floor && servesLift(at.floor, first.floor, nav, stops)) {
    from = at.floor;
    to = first.floor;
    next = second;
    approach = false;
  } else if (first.floor === at.floor && second && second.floor !== first.floor && servesLift(first.floor, second.floor, nav, stops)) {
    from = first.floor;
    to = second.floor;
    next = third;
    approach = true;
  } else {
    return null;
  }
  const fromFace: LiftFace = from === STREET ? 'street' : viaBridge ? 'bridge' : 'room';
  const target = nav.floors.get(to);
  const after = next ? nav.floors.get(next.floor) : undefined;
  const toFace: LiftFace = to === STREET ? 'street' : after && target && after.building !== target.building ? 'bridge' : 'room';
  return { from, to, fromFace, toFace, approach };
}

export function buildingOf(floor: FloorView): BuildingId {
  return floor.building === 'mantenimiento' || floor.kind === 'mantenimiento' ? 'annex' : 'main';
}

export function leadKindFor(floor: FloorView): RoleKind | null {
  if (floor.kind === 'direccion') return 'director';
  if (floor.kind === 'observed') return null;
  return 'lead';
}

function splitAgents(floor: FloorView, agents: readonly AgentView[], order: (key: string) => number) {
  const leadKind = leadKindFor(floor);
  const ordered = [...agents].sort((a, b) => order(a.key) - order(b.key));
  const keys = new Set(ordered.map((agent) => agent.key));
  const children = new Map<string, AgentView[]>();
  const roots: AgentView[] = [];
  for (const agent of ordered) {
    if (agent.parentKey !== null && agent.parentKey !== agent.key && keys.has(agent.parentKey)) {
      const siblings = children.get(agent.parentKey) ?? [];
      siblings.push(agent);
      children.set(agent.parentKey, siblings);
    } else {
      roots.push(agent);
    }
  }
  const leadAgent = leadKind === null ? undefined : roots.find((agent) => agent.roleKind === leadKind);
  return { ordered, children, roots, leadAgent, leadKind };
}

export function deskCount(floor: FloorView, agents: readonly AgentView[], order: (key: string) => number): number {
  const { ordered, leadAgent } = splitAgents(floor, agents, order);
  return ordered.length - (leadAgent ? 1 : 0);
}

export function requiredCols(desks: number, minimum: number): number {
  return Math.max(minimum, Math.ceil(desks / ROWS));
}

export function deskSlot(index: number, child: boolean, width: number, cols: number): DeskSlot {
  const row = Math.min(ROWS - 1, Math.floor(index / cols));
  const col = index - row * cols;
  const scale = child ? CHILD_SCALE : 1;
  const x = -width / 2 + LEAD_ZONE + PITCH * (col + 0.5);
  const z = ROW_DESK_Z[row];
  return { index, kind: child ? 'child' : 'desk', x, z, standX: x, standZ: z - STAND_OFFSET * scale, lane: x + PITCH / 2, scale };
}

export function leadSlotFor(width: number): DeskSlot {
  const x = -width / 2 + LEAD_DESK_DX;
  return {
    index: -1,
    kind: 'lead',
    x,
    z: LEAD_DESK_Z,
    standX: x,
    standZ: LEAD_DESK_Z - LEAD_STAND_OFFSET,
    lane: -width / 2 + LEAD_LANE_DX,
    scale: 1,
  };
}

export function computeFloorPlan(
  floor: FloorView,
  agents: readonly AgentView[],
  width: number,
  cols: number,
  order: (key: string) => number,
  override?: FloorLayoutOverride,
): FloorPlan {
  const { ordered, children, roots, leadAgent, leadKind } = splitAgents(floor, agents, order);
  const assignment = new Map<string, DeskSlot>();
  const slots: DeskSlot[] = [];
  const leadSlot = leadKind === null ? null : leadSlotFor(width);

  const place = (key: string, child: boolean): void => {
    const slot = deskSlot(slots.length, child, width, cols);
    slots.push(slot);
    assignment.set(key, slot);
  };

  const visited = new Set<string>();
  const placeChildren = (parentKey: string): void => {
    for (const child of children.get(parentKey) ?? []) {
      if (visited.has(child.key)) continue;
      visited.add(child.key);
      place(child.key, true);
      placeChildren(child.key);
    }
  };

  if (leadAgent && leadSlot) {
    visited.add(leadAgent.key);
    assignment.set(leadAgent.key, leadSlot);
    placeChildren(leadAgent.key);
  }
  for (const root of roots) {
    if (visited.has(root.key)) continue;
    visited.add(root.key);
    place(root.key, false);
    placeChildren(root.key);
  }
  for (const agent of ordered) {
    if (visited.has(agent.key)) continue;
    visited.add(agent.key);
    place(agent.key, false);
  }
  if (override) applyDeskOverrides(width, leadSlot, slots, override);
  return { slug: floor.slug, view: floor, leadSlot, slots, assignment };
}

// Two desks closer than this are on top of each other.
export const MIN_DESK_GAP = PITCH * 0.8;
const DESK_MARGIN_X = 0.9;
const LEAD_ROWS: readonly number[] = [LEAD_DESK_Z, ...ROW_DESK_Z];

function nearestRow(z: number, rows: readonly number[]): number {
  return rows.reduce((best, row) => (Math.abs(row - z) < Math.abs(best - z) ? row : best), rows[0]);
}

// The z of the row a v belongs to: the nearest of the rows of desks, or of the lead's.
export function rowFor(v: number, lead: boolean): number {
  return nearestRow(-HALF_D + v * DEPTH, lead ? LEAD_ROWS : ROW_DESK_Z);
}

function moveSlot(slot: DeskSlot, x: number, z: number): void {
  const lead = slot.kind === 'lead';
  slot.x = x;
  slot.z = z;
  slot.standX = x;
  slot.standZ = z - (lead ? LEAD_STAND_OFFSET : STAND_OFFSET * slot.scale);
  slot.lane = lead ? x + (LEAD_LANE_DX - LEAD_DESK_DX) : x + PITCH / 2;
}

// A desk the user moved goes to the nearest row, inside the room, and only if it leaves room for the others;
// otherwise it stays where the grid put it. The lead goes first, then the desks in order, each against the
// ones that are already where they will stay.
function applyDeskOverrides(width: number, leadSlot: DeskSlot | null, slots: DeskSlot[], override: FloorLayoutOverride): void {
  const half = width / 2;
  const all = leadSlot ? [leadSlot, ...slots] : slots;
  const attempt = (slot: DeskSlot, spot: Spot | null | undefined): void => {
    if (!spot) return;
    const target = spotToWorld(spot, width);
    const x = clampRange(target.x, -half + DESK_MARGIN_X, half - DESK_MARGIN_X);
    const z = nearestRow(target.z, slot.kind === 'lead' ? LEAD_ROWS : ROW_DESK_Z);
    if (all.some((other) => other !== slot && Math.hypot(other.x - x, other.z - z) < MIN_DESK_GAP)) return;
    moveSlot(slot, x, z);
  };
  if (leadSlot) attempt(leadSlot, override.lead);
  slots.forEach((slot, index) => attempt(slot, override.desks?.[index]));
}


// Where the user may put a desk or a piece of furniture. A spot is normalised (u across the width, v across the
// depth); the plan turns it into metres, keeps it inside the room and snaps desks to a row.
export type Shift = { dx: number; dz: number };

export type Shifts = Record<FurnitureKind, Shift>;

const NO_SHIFT: Shift = { dx: 0, dz: 0 };

export const NO_SHIFTS: Shifts = { coffee: NO_SHIFT, meeting: NO_SHIFT, lab: NO_SHIFT, board: NO_SHIFT, printer: NO_SHIFT };

export type Placed = Record<FurnitureKind, { x: number; z: number }>;

const FURNITURE: readonly FurnitureKind[] = ['coffee', 'meeting', 'lab', 'board', 'printer'];

export function spotToWorld(spot: Spot, width: number): { x: number; z: number } {
  return { x: -width / 2 + spot.u * width, z: -HALF_D + spot.v * DEPTH };
}

export function worldToSpot(x: number, z: number, width: number): Spot {
  const clamp = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
  return { u: clamp((x + width / 2) / width), v: clamp((z + HALF_D) / DEPTH) };
}

// The place of each piece of furniture with no override.
export function furnitureDefaults(floor: FloorView, width: number): Placed {
  const half = width / 2;
  const leadX = -half + LEAD_DESK_DX;
  return {
    coffee: { x: half - COFFEE_DX, z: COFFEE_Z },
    meeting: { x: half - MEET_DX, z: MEET_Z },
    lab: { x: half - LAB_BENCH_DX, z: -HALF_D + 0.36 },
    board: { x: floor.kind === 'direccion' ? leadX - 0.2 : half - 3.2, z: -HALF_D + 0.03 },
    printer: { x: half - PRINTER_DX, z: PRINTER_Z },
  };
}

const FURNITURE_MARGIN_X = 1.2;
const BOARD_MARGIN_X = 0.8;
const FURNITURE_Z: readonly [number, number] = [-HALF_D + 0.4, HALF_D - 1.2];

function clampRange(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

// How far each piece of furniture is from its default place; zero for the ones the override does not name, so
// without an override every position comes out exactly as it always did. The board stays on the back wall.
export function furnitureShifts(floor: FloorView, width: number, override?: FloorLayoutOverride): Shifts {
  const moved = override?.furniture;
  if (!moved) return NO_SHIFTS;
  const defaults = furnitureDefaults(floor, width);
  const half = width / 2;
  const shifts: Shifts = { ...NO_SHIFTS };
  for (const kind of FURNITURE) {
    const spot = moved[kind];
    if (!spot) continue;
    const target = spotToWorld(spot, width);
    const margin = kind === 'board' ? BOARD_MARGIN_X : FURNITURE_MARGIN_X;
    const x = clampRange(target.x, -half + margin, half - margin);
    const z = kind === 'board' ? defaults.board.z : clampRange(target.z, FURNITURE_Z[0], FURNITURE_Z[1]);
    shifts[kind] = { dx: x - defaults[kind].x, dz: z - defaults[kind].z };
  }
  return shifts;
}

// Where each piece of furniture ends up.
export function furniturePlaced(floor: FloorView, width: number, override?: FloorLayoutOverride): Placed {
  const defaults = furnitureDefaults(floor, width);
  const shifts = furnitureShifts(floor, width, override);
  const placed = { ...defaults };
  for (const kind of FURNITURE) placed[kind] = { x: defaults[kind].x + shifts[kind].dx, z: defaults[kind].z + shifts[kind].dz };
  return placed;
}

export function deskTarget(floor: string, slot: DeskSlot): Target {
  return {
    id: `desk:${floor}:${slot.index}`,
    kind: 'desk',
    floor,
    x: slot.standX,
    z: slot.standZ,
    lane: slot.lane,
    facing: 0,
    slot,
  };
}

export function labTarget(floor: string, width: number, index: number, shift: Shift = NO_SHIFT): Target {
  const stands = LAB_STAND_DX.length;
  const round = Math.floor(index / stands);
  const z = LAB_STAND_Z + round * LAB_QUEUE_STEP + shift.dz;
  return {
    id: `lab:${floor}:${index}`,
    kind: 'lab',
    floor,
    x: width / 2 - LAB_STAND_DX[index % stands] + shift.dx,
    z,
    lane: width / 2 - LAB_LANE_DX + shift.dx,
    facing: Math.PI,
    slot: null,
  };
}

export const MEETING_SEATS = 4;

export function meetingTarget(floor: string, width: number, seat: number, shift: Shift = NO_SHIFT): Target {
  const cx = width / 2 - MEET_DX + shift.dx;
  const spots = [
    { x: cx - MEET_W / 2 - 0.55, z: MEET_Z + shift.dz, facing: Math.PI / 2 },
    { x: cx + MEET_W / 2 + 0.55, z: MEET_Z + shift.dz, facing: -Math.PI / 2 },
    { x: cx - 0.5, z: MEET_Z + MEET_D / 2 + 0.55 + shift.dz, facing: Math.PI },
    { x: cx + 0.5, z: MEET_Z + MEET_D / 2 + 0.55 + shift.dz, facing: Math.PI },
  ];
  const spot = spots[((seat % MEETING_SEATS) + MEETING_SEATS) % MEETING_SEATS];
  return { id: `meet:${floor}:${seat}`, kind: 'meeting', floor, x: spot.x, z: spot.z, lane: spot.x, facing: spot.facing, slot: null };
}

export const COFFEE_STANDS = COFFEE_STAND_DX.length;

// Two people at the coffee machine stand a step apart and face each other.
export function coffeeTarget(floor: string, width: number, seat: number, shift: Shift = NO_SHIFT): Target {
  const index = ((seat % COFFEE_STANDS) + COFFEE_STANDS) % COFFEE_STANDS;
  const x = width / 2 - COFFEE_DX + COFFEE_STAND_DX[index] + shift.dx;
  return {
    id: `coffee:${floor}:${index}`,
    kind: 'coffee',
    floor,
    x,
    z: COFFEE_Z + COFFEE_STAND_DZ + shift.dz,
    lane: x,
    facing: index === 0 ? Math.PI / 2 : -Math.PI / 2,
    slot: null,
  };
}

const EPS = 0.02;

function pushPoint(points: Waypoint[], point: Waypoint): void {
  const last = points[points.length - 1];
  if (last && last.floor === point.floor && Math.abs(last.x - point.x) < EPS && Math.abs(last.z - point.z) < EPS) {
    last.lane = point.lane;
    return;
  }
  points.push(point);
}

export function planPath(from: Waypoint, target: Target, nav: Nav): Waypoint[] | null {
  const origin = nav.floors.get(from.floor);
  const goal = nav.floors.get(target.floor);
  if (!origin || !goal) return null;
  const points: Waypoint[] = [];
  const onAisle = Math.abs(from.z - AISLE_Z) < EPS;
  if (!onAisle && from.floor === target.floor && from.lane !== null && Math.abs(from.lane - target.lane) < EPS) {
    if (Math.abs(from.x - from.lane) > EPS) pushPoint(points, { floor: from.floor, x: from.lane, z: from.z, lane: from.lane });
    pushPoint(points, { floor: target.floor, x: target.lane, z: target.z, lane: target.lane });
    pushPoint(points, { floor: target.floor, x: target.x, z: target.z, lane: target.lane });
    return points;
  }
  if (!onAisle) {
    const lane = from.lane ?? from.x;
    if (Math.abs(from.x - lane) > EPS) pushPoint(points, { floor: from.floor, x: lane, z: from.z, lane });
    pushPoint(points, { floor: from.floor, x: lane, z: AISLE_Z, lane });
  }

  if (from.floor !== target.floor) {
    pushPoint(points, { floor: from.floor, x: origin.exitX, z: AISLE_Z, lane: null });
    if (origin.building === goal.building) {
      pushPoint(points, { floor: goal.slug, x: goal.exitX, z: AISLE_Z, lane: null });
    } else {
      const fromGround = nav.floors.get((origin.building === 'main' ? nav.mainGround : nav.annexGround) ?? '');
      const toGround = nav.floors.get((goal.building === 'main' ? nav.mainGround : nav.annexGround) ?? '');
      if (!fromGround || !toGround) return null;
      pushPoint(points, { floor: fromGround.slug, x: fromGround.exitX, z: AISLE_Z, lane: null });
      pushPoint(points, { floor: toGround.slug, x: toGround.exitX, z: AISLE_Z, lane: null });
      pushPoint(points, { floor: goal.slug, x: goal.exitX, z: AISLE_Z, lane: null });
    }
  }

  pushPoint(points, { floor: target.floor, x: target.lane, z: AISLE_Z, lane: null });
  pushPoint(points, { floor: target.floor, x: target.lane, z: target.z, lane: target.lane });
  pushPoint(points, { floor: target.floor, x: target.x, z: target.z, lane: target.lane });
  const first = points[0];
  if (first && first.floor === from.floor && Math.abs(first.x - from.x) < EPS && Math.abs(first.z - from.z) < EPS) points.shift();
  return points;
}

export type MeetingPair = { a: string; b: string };

export function findMeetingPairs(messages: readonly MessageView[], now: number): MeetingPair[] {
  const sent = new Set<string>();
  for (const message of messages) {
    if (message.toKey === null || message.toKey === message.fromKey) continue;
    if (now - message.ts > MEETING_WINDOW_MS) continue;
    sent.add(`${message.fromKey}\u0000${message.toKey}`);
  }
  const pairs: MeetingPair[] = [];
  for (const entry of sent) {
    const [from, to] = entry.split('\u0000');
    if (from < to && sent.has(`${to}\u0000${from}`)) pairs.push({ a: from, b: to });
  }
  return pairs.sort((x, y) => `${x.a}${x.b}`.localeCompare(`${y.a}${y.b}`));
}

export function latestRecipient(messages: readonly MessageView[], fromKey: string): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].fromKey === fromKey) return messages[index].toKey;
  }
  return null;
}
