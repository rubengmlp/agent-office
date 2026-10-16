import { describe, expect, test } from 'bun:test';
import type { CheckRunView, FinishedView, OrderView, ServerMessage, Snapshot } from '../src/types';

Object.assign(globalThis, {
  window: { setInterval: () => 0, setTimeout: () => 0 },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { documentElement: { lang: 'es' } },
});

const { Store } = await import('../src/store');

const view = (id: number, over: Partial<OrderView> = {}): OrderView =>
  ({ id, slug: `o-${id}`, floor: 'mobile', title: `T${id}`, status: 'pendiente', ...over }) as OrderView;

const finished = (id: number): FinishedView => ({ id, ts: id, kind: 'order', slug: `o-${id}`, title: `T${id}`, floors: ['mobile'], branch: null, summary: '', cycle: 1, manual: false, checks: null, touched: [], prUrl: null, orderSlugs: [] });

function snapshot(extra: Partial<Snapshot> = {}): ServerMessage {
  return { type: 'snapshot', data: { now: 1, floors: [], agents: [], sessions: [], questions: [], messages: [], activity: [], documents: [], alerts: [], ...extra } as Snapshot };
}

describe('orders in the store', () => {
  test('the snapshot brings the cards and the unseen end alerts, an old snapshot brings none', () => {
    const store = new Store();
    store.apply(snapshot({ orders: [view(1), view(2)], finished: [finished(7)] }));
    expect(store.orders.map((o) => o.id)).toEqual([1, 2]);
    expect(store.finished.map((f) => f.id)).toEqual([7]);
    store.apply(snapshot());
    expect(store.orders).toEqual([]);
    expect(store.finished).toEqual([]);
  });

  test('order upserts by id, orders replaces', () => {
    const store = new Store();
    store.apply({ type: 'order', data: view(1) });
    store.apply({ type: 'order', data: view(2) });
    store.apply({ type: 'order', data: view(1, { status: 'en-curso' }) });
    expect(store.orders.map((o) => [o.id, o.status])).toEqual([[1, 'en-curso'], [2, 'pendiente']]);
    store.apply({ type: 'orders', data: [view(3)] });
    expect(store.orders.map((o) => o.id)).toEqual([3]);
  });

  test('the runs of checks are kept by order and a finished alert is queued once and dropped on demand', () => {
    const store = new Store();
    const run = { id: 4, orderId: 1, status: 'running', checks: [] } as unknown as CheckRunView;
    store.apply({ type: 'checks', orderId: 1, data: run });
    expect(store.checkRuns.get(1)).toBe(run);
    store.apply({ type: 'finished', data: finished(1) });
    store.apply({ type: 'finished', data: finished(1) });
    store.apply({ type: 'finished', data: finished(2) });
    expect(store.finished.map((f) => f.id)).toEqual([1, 2]);
    store.dropFinished(1);
    store.dropFinished(99);
    expect(store.finished.map((f) => f.id)).toEqual([2]);
    const before = store.worktreeVersion;
    store.apply({ type: 'worktrees', floor: 'mobile' });
    expect(store.worktreeVersion).toBe(before + 1);
  });

  test('reset forgets everything', () => {
    const store = new Store();
    store.apply(snapshot({ orders: [view(1)], finished: [finished(1)] }));
    store.reset();
    expect(store.orders).toEqual([]);
    expect(store.finished).toEqual([]);
  });
});
