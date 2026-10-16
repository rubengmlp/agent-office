import { describe, expect, test } from 'bun:test';
import type { AgentView, FloorView } from '../types';
import { AISLE_Z, HALF_D, LIFT_GAP, LIFT_W, WALL_T } from './constants';
import {
  STREET,
  STREET_DX,
  computeFloorPlan,
  deskTarget,
  exitTarget,
  planPath,
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
    expect(streetPoint(map)).toEqual({ floor: STREET, x: exit.x, z: exit.z, lane: exit.lane });
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
    expect(path.at(-1)).toMatchObject({ floor: 'mobile', x: desk.x, z: desk.z });
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
