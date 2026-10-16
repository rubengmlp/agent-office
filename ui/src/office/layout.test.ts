import { describe, expect, test } from 'bun:test';
import type { AgentView, FloorView } from '../types';
import { FLOOR_GAP } from './constants';
import { computeFloorLayout, liftGate, liftRoute, streetExit } from './layout';

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
  test('from an upper floor: its lift door, the ground floor lift door, then off the canvas on the right', () => {
    const { upper, upperTop, ground, groundTop } = building();
    const exit = streetExit(ground, groundTop);
    const route = liftRoute(liftGate(upper, upperTop), liftGate(ground, groundTop), exit);
    expect(route).toEqual([liftGate(upper, upperTop), liftGate(ground, groundTop), exit]);
    expect(route[1]).toEqual({ x: ground.lift.x + ground.lift.w / 2, y: groundTop + ground.walkY });
    expect(exit.x).toBeGreaterThan(ground.width);
    expect(exit.y).toBe(route[1]!.y);
  });

  test('from the ground floor the lift door is passed once', () => {
    const { ground, groundTop } = building();
    const exit = streetExit(ground, groundTop);
    expect(liftRoute(liftGate(ground, groundTop), liftGate(ground, groundTop), exit)).toEqual([liftGate(ground, groundTop), exit]);
    expect(liftRoute(null, liftGate(ground, groundTop), exit)).toEqual([liftGate(ground, groundTop), exit]);
  });

  test('an agent arriving enters through the ground floor lift and rides up to its desk', () => {
    const { upper, upperTop, ground, groundTop } = building();
    const desk = upper.desks.get('dev-1')!;
    const goal = { x: desk.x, y: upperTop + desk.y };
    expect(liftRoute(liftGate(ground, groundTop), liftGate(upper, upperTop), goal)).toEqual([
      liftGate(ground, groundTop),
      liftGate(upper, upperTop),
      goal,
    ]);
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
