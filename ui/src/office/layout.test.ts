import { describe, expect, test } from 'bun:test';
import type { AgentView, FloorView } from '../types';
import { FLOOR_GAP } from './constants';
import { computeFloorLayout, gardenArrival, gardenDoor, gardenRoute, liftGate, liftLeg, liftRoute } from './layout';

const WIDTH = 400;

function agent(key: string, roleKind: AgentView['roleKind'], floor: string, parentKey: string | null = null): AgentView {
  return {
    key,
    sessionId: 's-1',
    parentKey,
    name: key,
    role: null,
    roleId: null,
    roleKind,
    floor,
    touchedFloor: null,
    state: 'idle',
    detail: '',
    tool: null,
    lastTest: null,
    stateSince: 0,
    updatedAt: 0,
    endedAt: null,
    file: null,
    task: null,
    away: false,
  };
}

function floor(slug: string, kind: FloorView['kind']): FloorView {
  return { slug, label: slug, path: null, stack: 'generic', kind, building: 'principal' };
}

const order = (key: string): number => ['lead-1', 'dev-1', 'dev-2', 'red-1'].indexOf(key);

function building() {
  const upper = computeFloorLayout(floor('mobile', 'managed'), [agent('lead-1', 'lead', 'mobile'), agent('dev-1', 'dev', 'mobile', 'lead-1')], WIDTH, order);
  const ground = computeFloorLayout(floor('redaccion', 'redaccion'), [agent('red-1', 'writer', 'redaccion')], WIDTH, order);
  return { upper, upperTop: 0, ground, groundTop: upper.height + FLOOR_GAP };
}

describe('leaving the 2D office', () => {
  const PATH_DY = 26;

  test('from an upper floor: lift down, out through the garden door, along the path to the car', () => {
    const { upper, upperTop, ground, groundTop } = building();
    const door = gardenDoor(ground, groundTop);
    const pathY = door.y + PATH_DY;
    const spot = { x: 60, y: pathY + 22 };
    const route = liftRoute(
      liftGate(upper, upperTop, 'mobile'),
      liftGate(ground, groundTop, 'redaccion'),
      ...gardenRoute(liftGate(ground, groundTop, 'redaccion'), door, pathY, spot).slice(1),
    );
    expect(route).toEqual([
      liftGate(upper, upperTop, 'mobile'),
      liftGate(ground, groundTop, 'redaccion'),
      door,
      { x: door.x, y: pathY },
      { x: spot.x, y: pathY },
      spot,
    ]);
    expect(door.y).toBeGreaterThan(groundTop + ground.height);
    expect(route[0]!.floor).toBe('mobile');
    expect(route[1]!.floor).toBe('redaccion');
    expect(route.slice(2).every((point) => point.floor === undefined)).toBe(true);
    expect(liftLeg(route, () => true)).toEqual({ from: 'mobile', to: 'redaccion', fromFace: 'room', toFace: 'room', approach: true });
  });

  test('from the ground floor the lift door is passed once and no ride is taken', () => {
    const { ground, groundTop } = building();
    const door = gardenDoor(ground, groundTop);
    const spot = { x: 60, y: door.y + 40 };
    const gate = liftGate(ground, groundTop, 'redaccion');
    const route = liftRoute(gate, gate, door, spot);
    expect(route).toEqual([gate, door, spot]);
    expect(liftRoute(null, gate, door, spot)).toEqual([gate, door, spot]);
    expect(liftLeg(route, () => true)).toBeNull();
  });

  test('an agent arriving walks up the path, through the garden door, and rides up to its desk', () => {
    const { upper, upperTop, ground, groundTop } = building();
    const desk = upper.desks.get('dev-1')!;
    const goal = { x: desk.x, y: upperTop + desk.y };
    const door = gardenDoor(ground, groundTop);
    const pathY = door.y + PATH_DY;
    const from = { x: WIDTH + 16, y: pathY };
    const groundGate = liftGate(ground, groundTop, 'redaccion');
    const route = [...gardenArrival(from, door, pathY, groundGate), ...liftRoute(groundGate, liftGate(upper, upperTop, 'mobile'), goal).slice(1)];
    expect(route).toEqual([{ x: door.x, y: pathY }, door, groundGate, liftGate(upper, upperTop, 'mobile'), goal]);
    expect(route[0]!.y).toBe(pathY);
    expect(route.filter((point) => point.x === groundGate.x && point.y === groundGate.y)).toHaveLength(1);
    expect(liftLeg(route.slice(2), () => true)).toMatchObject({ from: 'redaccion', to: 'mobile' });
    expect(liftLeg(route.slice(2), () => false)).toBeNull();
  });

  test('coming back from a parking bay climbs to the path before heading for the door', () => {
    const { ground, groundTop } = building();
    const door = gardenDoor(ground, groundTop);
    const pathY = door.y + PATH_DY;
    const bay = { x: 300, y: pathY + 22 };
    expect(gardenArrival(bay, door, pathY, liftGate(ground, groundTop))[0]).toEqual({ x: bay.x, y: pathY });
  });

  test('an agent left out of the layout frees its desk', () => {
    const agents = [agent('lead-1', 'lead', 'mobile'), agent('dev-1', 'dev', 'mobile', 'lead-1'), agent('dev-2', 'dev', 'mobile', 'lead-1')];
    const full = computeFloorLayout(floor('mobile', 'managed'), agents, WIDTH, order);
    const without = computeFloorLayout(floor('mobile', 'managed'), [agents[0]!, agents[2]!], WIDTH, order);
    expect(full.desks.size).toBe(3);
    expect(without.desks.has('dev-1')).toBe(false);
    expect(without.desks.size).toBe(2);
    expect(without.desks.get('dev-2')).toEqual(full.desks.get('dev-1'));
  });
});

describe('the coffee machine', () => {
  test('has two places below the machine, side by side', () => {
    const layout = computeFloorLayout(floor('mobile', 'managed'), [agent('lead-1', 'lead', 'mobile')], WIDTH, order);
    expect(layout.coffeeStands).toHaveLength(2);
    const [left, right] = layout.coffeeStands;
    expect(right.x - left.x).toBeGreaterThan(10);
    expect(left.y).toBe(right.y);
    expect(left.y).toBeGreaterThan(layout.coffee.y + 24);
    expect(left.x).toBeGreaterThan(layout.coffee.x - 8);
    expect(right.x).toBeLessThan(layout.coffee.x + 30);
  });
});
