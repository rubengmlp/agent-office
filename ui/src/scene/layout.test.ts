import { describe, expect, test } from 'bun:test';
import type { AgentView, FloorView } from '../types';
import { AISLE_Z, BRIDGE_LANDING_DX, COFFEE_DX, COFFEE_Z, HALF_D, LIFT_GAP, LIFT_W, PARK_AISLE_Z, ROAD_Z, STOREY_H, WALL_T } from './constants';
import {
  STREET,
  STREET_DX,
  coffeeTarget,
  computeFloorPlan,
  deskTarget,
  exitTarget,
  liftLeg,
  planPath,
  servesLift,
  streetNav,
  streetPoint,
  type FloorNav,
  type Nav,
  type Waypoint,
} from './layout';

const MAIN_W = 20;
const ANNEX_W = 12;

function agent(key: string, roleKind: AgentView['roleKind'], parentKey: string | null = null): AgentView {
  return {
    key,
    sessionId: 's-1',
    parentKey,
    name: key,
    role: null,
    roleId: null,
    roleKind,
    floor: 'mobile',
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

const MOBILE: FloorView = { slug: 'mobile', label: 'mobile', path: '/m', stack: 'flutter', kind: 'managed', building: 'principal' };

function nav(): Nav {
  const floors = new Map<string, FloorNav>();
  const mainExit = MAIN_W / 2 + LIFT_GAP + LIFT_W / 2;
  const annexExit = -ANNEX_W / 2 - WALL_T - 0.7;
  floors.set('direccion', { slug: 'direccion', building: 'main', level: 2, width: MAIN_W, exitX: mainExit });
  floors.set('mobile', { slug: 'mobile', building: 'main', level: 1, width: MAIN_W, exitX: mainExit });
  floors.set('redaccion', { slug: 'redaccion', building: 'main', level: 0, width: MAIN_W, exitX: mainExit });
  floors.set('mantenimiento', { slug: 'mantenimiento', building: 'annex', level: 0, width: ANNEX_W, exitX: annexExit });
  floors.set('taller', { slug: 'taller', building: 'annex', level: 1, width: ANNEX_W, exitX: annexExit });
  floors.set(STREET, streetNav(floors.get('redaccion')!));
  return { floors, mainGround: 'redaccion', annexGround: 'mantenimiento' };
}

function floorsOf(path: readonly Waypoint[]): string[] {
  return path.map((point) => point.floor).filter((floor, index, all) => index === 0 || all[index - 1] !== floor);
}

describe('the street', () => {
  test('the exit is on the sidewalk past the ground floor lift, outside the building', () => {
    const map = nav();
    const exit = exitTarget(map)!;
    const ground = map.floors.get('redaccion')!;
    expect(exit).toMatchObject({ kind: 'exit', floor: STREET, x: ground.exitX + STREET_DX, lane: ground.exitX });
    expect(exit.z).toBeGreaterThan(HALF_D);
    expect(map.floors.get(STREET)).toMatchObject({ level: 0, building: 'main' });
    expect(streetPoint(map)).toEqual({ floor: STREET, x: ground.exitX, z: ROAD_Z - 1, lane: ground.exitX });
  });

  test('without a ground floor there is no street', () => {
    const empty: Nav = { floors: new Map(), mainGround: null, annexGround: null };
    expect(exitTarget(empty)).toBeNull();
    expect(streetPoint(empty)).toBeNull();
  });

  test('from a desk upstairs: aisle, lift down at exitX, out to the sidewalk', () => {
    const map = nav();
    const plan = computeFloorPlan(MOBILE, [agent('dev-1', 'dev')], MAIN_W, 3, () => 0);
    const desk = deskTarget('mobile', plan.assignment.get('dev-1')!);
    const exit = exitTarget(map)!;
    const path = planPath({ floor: 'mobile', x: desk.x, z: desk.z, lane: desk.lane }, exit, map)!;
    expect(floorsOf(path)).toEqual(['mobile', STREET]);
    const exitX = map.floors.get('mobile')!.exitX;
    const leaveFloor = path.findLast((point) => point.floor === 'mobile')!;
    expect(leaveFloor).toMatchObject({ x: exitX, z: AISLE_Z });
    const firstStreet = path.find((point) => point.floor === STREET)!;
    expect(firstStreet).toMatchObject({ x: exitX, z: AISLE_Z });
    expect(path.at(-1)).toMatchObject({ floor: STREET, x: exit.x, z: exit.z });
  });

  test('from the annex: stairs, corridor to the main ground floor, then out', () => {
    const map = nav();
    const exit = exitTarget(map)!;
    const path = planPath({ floor: 'taller', x: 0, z: AISLE_Z, lane: null }, exit, map)!;
    expect(floorsOf(path)).toEqual(['taller', 'mantenimiento', 'redaccion', STREET]);
    expect(path.at(-1)).toMatchObject({ floor: STREET, x: exit.x, z: exit.z });
  });

  test('an agent arriving walks from the street to its desk through the lift', () => {
    const map = nav();
    const plan = computeFloorPlan(MOBILE, [agent('dev-1', 'dev')], MAIN_W, 3, () => 0);
    const desk = deskTarget('mobile', plan.assignment.get('dev-1')!);
    const path = planPath(streetPoint(map)!, desk, map)!;
    expect(floorsOf(path)).toEqual([STREET, 'mobile']);
    const lift = path.findLast((point) => point.floor === STREET)!;
    expect(lift).toMatchObject({ x: map.floors.get(STREET)!.exitX, z: AISLE_Z });
    expect(path.filter((point) => point.floor === STREET).every((point) => point.x === lift.x)).toBe(true);
    expect(path.at(-1)).toMatchObject({ floor: 'mobile', x: desk.x, z: desk.z });
  });

  test('going home to a parking spot: out through the tower door, down the garden path, along the aisle', () => {
    const map = nav();
    const ground = map.floors.get('redaccion')!;
    const spot = { x: 3.1, z: PARK_AISLE_Z };
    const exit = exitTarget(map, spot)!;
    expect(exit).toMatchObject({ kind: 'exit', floor: STREET, x: spot.x, z: spot.z, lane: ground.exitX });
    const plan = computeFloorPlan(MOBILE, [agent('dev-1', 'dev')], MAIN_W, 3, () => 0);
    const desk = deskTarget('mobile', plan.assignment.get('dev-1')!);
    const path = planPath({ floor: 'mobile', x: desk.x, z: desk.z, lane: desk.lane }, exit, map)!;
    const street = path.filter((point) => point.floor === STREET);
    expect(street[0]).toMatchObject({ x: ground.exitX, z: AISLE_Z });
    expect(street.at(-2)).toMatchObject({ x: ground.exitX, z: PARK_AISLE_Z });
    expect(path.at(-1)).toMatchObject({ floor: STREET, x: spot.x, z: spot.z });
  });
});

describe('the lift', () => {
  const stops = new Map<string, number>([
    ['direccion', 0.35 + 2 * STOREY_H],
    ['mobile', 0.35 + STOREY_H],
    ['redaccion', 0.35],
    [STREET, 0.35],
  ]);

  test('serves the floors of the main building and the street, not the annex', () => {
    const map = nav();
    expect(servesLift('mobile', STREET, map, stops)).toBe(true);
    expect(servesLift('redaccion', STREET, map, stops)).toBe(false);
    expect(servesLift('taller', 'mantenimiento', map, stops)).toBe(false);
    expect(servesLift('mantenimiento', 'redaccion', map, stops)).toBe(false);
    expect(servesLift('redaccion', 'direccion', map, stops)).toBe(true);
  });

  test('from the annex: no ride on the stairs, a ride from the bridge landing up to the top floor', () => {
    const map = nav();
    const plan = computeFloorPlan(MOBILE, [agent('dev-1', 'dev')], MAIN_W, 3, () => 0);
    const desk = deskTarget('direccion', plan.assignment.get('dev-1')!);
    const path = planPath({ floor: 'taller', x: 0, z: AISLE_Z, lane: null }, desk, map)!;
    const atAnnex = path.findIndex((point) => point.floor === 'mantenimiento');
    expect(liftLeg(path[atAnnex]!, path.slice(atAnnex + 1), map, stops, false)).toBeNull();
    const toMain = path.findIndex((point) => point.floor === 'redaccion');
    const exitX = map.floors.get('redaccion')!.exitX;
    const landing = { floor: 'redaccion', x: exitX + BRIDGE_LANDING_DX, z: AISLE_Z, lane: null };
    expect(liftLeg(landing, path.slice(toMain + 1), map, stops, true)).toEqual({
      from: 'redaccion',
      to: 'direccion',
      fromFace: 'bridge',
      toFace: 'room',
      approach: false,
    });
  });

  test('to the annex: approach on the top floor and leave through the bridge face', () => {
    const map = nav();
    const back = planPath({ floor: 'direccion', x: 2, z: AISLE_Z, lane: null }, { id: 'x', kind: 'desk', floor: 'taller', x: 0, z: 0, lane: 0, facing: 0, slot: null }, map)!;
    expect(back[0]).toMatchObject({ floor: 'direccion', x: map.floors.get('direccion')!.exitX, z: AISLE_Z });
    expect(liftLeg({ floor: 'direccion', x: 2, z: AISLE_Z, lane: null }, back, map, stops, false)).toEqual({
      from: 'direccion',
      to: 'redaccion',
      fromFace: 'room',
      toFace: 'bridge',
      approach: true,
    });
  });

  test('going home from upstairs leaves the cabin through the street face', () => {
    const map = nav();
    const exit = exitTarget(map, { x: 3, z: PARK_AISLE_Z })!;
    const from = { floor: 'mobile', x: 1, z: AISLE_Z, lane: null };
    const path = planPath(from, exit, map)!;
    expect(liftLeg(from, path, map, stops, false)).toMatchObject({ from: 'mobile', to: STREET, fromFace: 'room', toFace: 'street', approach: true });
  });
});

describe('desks', () => {
  test('an agent left out of the plan frees its desk', () => {
    const lead = agent('lead-1', 'lead');
    const devs = [agent('dev-1', 'dev', 'lead-1'), agent('dev-2', 'dev', 'lead-1')];
    const order = (key: string): number => ['lead-1', 'dev-1', 'dev-2'].indexOf(key);
    const full = computeFloorPlan(MOBILE, [lead, ...devs], MAIN_W, 3, order);
    expect(full.slots).toHaveLength(2);
    const without = computeFloorPlan(MOBILE, [lead, devs[1]!], MAIN_W, 3, order);
    expect(without.assignment.has('dev-1')).toBe(false);
    expect(without.slots).toHaveLength(1);
    expect(without.assignment.get('dev-2')).toEqual(full.assignment.get('dev-1'));
    expect(without.assignment.get('lead-1')).toEqual(full.assignment.get('lead-1'));
  });
});

describe('the coffee machine', () => {
  test('has two places in front of the counter that face each other', () => {
    const first = coffeeTarget('mobile', MAIN_W, 0);
    const second = coffeeTarget('mobile', MAIN_W, 1);
    expect(first).toMatchObject({ kind: 'coffee', floor: 'mobile', id: 'coffee:mobile:0', slot: null });
    expect(second.id).toBe('coffee:mobile:1');
    expect(first.z).toBe(second.z);
    expect(first.z).toBeGreaterThan(COFFEE_Z);
    expect(first.z).toBeLessThan(AISLE_Z);
    expect(second.x - first.x).toBeGreaterThan(0.5);
    expect(second.x - first.x).toBeLessThan(1.2);
    expect(Math.abs(first.x - (MAIN_W / 2 - COFFEE_DX))).toBeLessThan(1);
    expect(first.facing).toBeCloseTo(Math.PI / 2, 5);
    expect(second.facing).toBeCloseTo(-Math.PI / 2, 5);
    expect(first.lane).toBe(first.x);
  });

  test('a seat outside the two wraps around, and the path to it goes by the aisle', () => {
    expect(coffeeTarget('mobile', MAIN_W, 2).id).toBe('coffee:mobile:0');
    expect(coffeeTarget('mobile', MAIN_W, -1).id).toBe('coffee:mobile:1');
    const map = nav();
    const target = coffeeTarget('mobile', MAIN_W, 1);
    const path = planPath({ floor: 'mobile', x: 0, z: -2.25, lane: 1 }, target, map)!;
    expect(path.some((point) => Math.abs(point.z - AISLE_Z) < 0.02)).toBe(true);
    expect(path[path.length - 1]).toMatchObject({ floor: 'mobile', x: target.x, z: target.z });
    expect(floorsOf(path)).toEqual(['mobile']);
  });
});
