import { describe, expect, test } from 'bun:test';
import { emptyLayouts } from '../src/layouts';
import { LEAD_ZONE, MIN_COLS, MIN_COLS_ANNEX, PITCH, UTIL_ZONE } from '../src/scene/constants';
import { applyDrop, dropSpot, editorView, floorWidth, hitItem } from '../src/settings/layout-model';
import type { AgentView } from '../src/types';
import { agent, floor } from './fixtures';

const mobile = floor('mobile');
const backend = floor('backend');
const mantenimiento = floor('mantenimiento', { kind: 'mantenimiento', building: 'mantenimiento' });
const floors = [mobile, backend, mantenimiento];

const order = (key: string): number => ['lead-1', 'dev-1', 'dev-2', 'dev-3'].indexOf(key);

function crew(slug: string, devs: number): AgentView[] {
  return [
    agent('lead-1', { roleKind: 'lead', floor: slug }),
    ...Array.from({ length: devs }, (_, index) => agent(`dev-${index + 1}`, { roleKind: 'dev', floor: slug, parentKey: 'lead-1' })),
  ];
}

const by = (entries: [string, AgentView[]][]): Map<string, AgentView[]> => new Map(entries);

describe('floorWidth', () => {
  test('every floor of a building is as wide as its widest one, and the annex has its own minimum', () => {
    const empty = floorWidth(mobile, floors, by([]), order);
    expect(empty).toEqual({ cols: MIN_COLS, width: LEAD_ZONE + MIN_COLS * PITCH + UTIL_ZONE });
    expect(floorWidth(mantenimiento, floors, by([]), order).cols).toBe(MIN_COLS_ANNEX);
    const wide = by([['backend', crew('backend', 9)]]);
    expect(floorWidth(mobile, floors, wide, order)).toEqual(floorWidth(backend, floors, wide, order));
    expect(floorWidth(mobile, floors, wide, order).cols).toBeGreaterThan(MIN_COLS);
    expect(floorWidth(mantenimiento, floors, wide, order).cols).toBe(MIN_COLS_ANNEX);
  });
});

describe('editorView', () => {
  const agents = by([['mobile', crew('mobile', 3)]]);

  test('lists the five pieces of furniture, the desks and the lead of the floor, at the places of the plan', () => {
    const view = editorView(mobile, floors, agents, order, emptyLayouts());
    expect(view.items.map((item) => item.kind)).toEqual(['coffee', 'meeting', 'lab', 'board', 'printer', 'desk', 'desk', 'desk', 'lead']);
    expect(view.items.filter((item) => item.kind === 'desk').map((item) => item.index)).toEqual([0, 1, 2]);
    expect(view.width).toBe(floorWidth(mobile, floors, agents, order).width);
    for (const item of view.items) {
      expect(Math.abs(item.x)).toBeLessThanOrEqual(view.width / 2);
      expect(item.w).toBeGreaterThan(0);
    }
  });

  test('a floor without agents has its furniture and the desk of its lead, and no other desk', () => {
    const view = editorView(backend, floors, agents, order, emptyLayouts());
    expect(view.items.map((item) => item.kind)).toEqual(['coffee', 'meeting', 'lab', 'board', 'printer', 'lead']);
  });

  test('shows what the user moved as the scene will draw it', () => {
    const base = editorView(mobile, floors, agents, order, emptyLayouts());
    const file = applyDrop(emptyLayouts(), 'mobile', base.items.find((item) => item.kind === 'coffee')!, { u: 0.4, v: 0.5 });
    const moved = editorView(mobile, floors, agents, order, file);
    const coffee = moved.items.find((item) => item.kind === 'coffee')!;
    expect(coffee.x).toBeCloseTo(-moved.width / 2 + 0.4 * moved.width, 5);
    expect(moved.items.find((item) => item.kind === 'lab')).toEqual(base.items.find((item) => item.kind === 'lab'));
    const desks = applyDrop(emptyLayouts(), 'mobile', base.items.find((item) => item.kind === 'desk' && item.index === 0)!, { u: 0.2, v: 0.6 });
    const row = editorView(mobile, floors, agents, order, desks).items.find((item) => item.kind === 'desk' && item.index === 0)!;
    expect(row.z).toBeCloseTo(0.35, 5);
  });
});

describe('dragging', () => {
  const agents = by([['mobile', crew('mobile', 2)]]);
  const view = editorView(mobile, floors, agents, order, emptyLayouts());

  test('hitItem finds the item under a point, the lead and the desks before the furniture', () => {
    const lead = view.items.find((item) => item.kind === 'lead')!;
    expect(hitItem(view.items, lead.x, lead.z)).toBe(lead);
    const printer = view.items.find((item) => item.kind === 'printer')!;
    expect(hitItem(view.items, printer.x + printer.w / 2 - 0.01, printer.z)).toBe(printer);
    expect(hitItem(view.items, printer.x + printer.w / 2 + 0.2, printer.z + 3)).toBeNull();
    const desk = view.items.find((item) => item.kind === 'desk')!;
    expect(hitItem([{ ...printer, x: desk.x, z: desk.z }, desk], desk.x, desk.z)).toBe(desk);
  });

  test('dropping puts a spot on the right part of the file, of the right floor', () => {
    const spot = dropSpot(0, 0, view.width);
    expect(spot).toEqual({ u: 0.5, v: 0.5 });
    const desk = view.items.find((item) => item.kind === 'desk' && item.index === 1)!;
    const lead = view.items.find((item) => item.kind === 'lead')!;
    const board = view.items.find((item) => item.kind === 'board')!;
    expect(applyDrop(emptyLayouts(), 'mobile', desk, spot).floors.mobile).toEqual({ desks: [null, spot] });
    expect(applyDrop(emptyLayouts(), 'mobile', lead, spot).floors.mobile).toEqual({ lead: spot });
    expect(applyDrop(emptyLayouts(), 'backend', board, spot).floors).toEqual({ backend: { furniture: { board: spot } } });
  });

  test('every dropped position survives the hub validation range', () => {
    for (const x of [-1000, 0, 1000]) {
      for (const z of [-1000, 0, 1000]) {
        const { u, v } = dropSpot(x, z, view.width);
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
