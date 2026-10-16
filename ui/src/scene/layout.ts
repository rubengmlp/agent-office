import type { AgentView, FloorView, MessageView, RoleKind } from '../types';
import {
  AISLE_Z,
  CHILD_SCALE,
  HALF_D,
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

export type TargetKind = 'desk' | 'lab' | 'meeting' | 'exit';

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

export function exitTarget(nav: Nav): Target | null {
  const street = nav.floors.get(STREET);
  if (!street) return null;
  const x = street.exitX + (street.building === 'main' ? STREET_DX : -STREET_DX);
  return { id: 'exit', kind: 'exit', floor: STREET, x, z: STREET_Z, lane: street.exitX, facing: 0, slot: null };
}

export function streetPoint(nav: Nav): Waypoint | null {
  const exit = exitTarget(nav);
  return exit ? { floor: STREET, x: exit.x, z: exit.z, lane: exit.lane } : null;
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
  return { slug: floor.slug, view: floor, leadSlot, slots, assignment };
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

export function labTarget(floor: string, width: number, index: number): Target {
  const stands = LAB_STAND_DX.length;
  const round = Math.floor(index / stands);
  const z = LAB_STAND_Z + round * LAB_QUEUE_STEP;
  return {
    id: `lab:${floor}:${index}`,
    kind: 'lab',
    floor,
    x: width / 2 - LAB_STAND_DX[index % stands],
    z,
    lane: width / 2 - LAB_LANE_DX,
    facing: Math.PI,
    slot: null,
  };
}

export const MEETING_SEATS = 4;

export function meetingTarget(floor: string, width: number, seat: number): Target {
  const cx = width / 2 - MEET_DX;
  const spots = [
    { x: cx - MEET_W / 2 - 0.55, z: MEET_Z, facing: Math.PI / 2 },
    { x: cx + MEET_W / 2 + 0.55, z: MEET_Z, facing: -Math.PI / 2 },
    { x: cx - 0.5, z: MEET_Z + MEET_D / 2 + 0.55, facing: Math.PI },
    { x: cx + 0.5, z: MEET_Z + MEET_D / 2 + 0.55, facing: Math.PI },
  ];
  const spot = spots[((seat % MEETING_SEATS) + MEETING_SEATS) % MEETING_SEATS];
  return { id: `meet:${floor}:${seat}`, kind: 'meeting', floor, x: spot.x, z: spot.z, lane: spot.x, facing: spot.facing, slot: null };
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
