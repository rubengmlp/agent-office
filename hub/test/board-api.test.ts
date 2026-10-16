import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { createApp } from '../src/server';
import { newOrder, deliveryRig, type Rig } from './delivery-rig';

const KEY = 'k'.repeat(64);
const PORT = 4747;
let rig: Rig | undefined;
afterEach(() => {
  rig?.h.cleanup();
  rig = undefined;
});

function api(r: Rig) {
  const app = createApp({ office: r.h.office, port: PORT, key: () => KEY, publicDir: r.h.root }, () => {});
  return async (method: string, path: string, body?: unknown) => {
    const response = await app.request(`http://127.0.0.1:${PORT}${path}`, {
      method,
      headers: { host: `127.0.0.1:${PORT}`, 'content-type': 'application/json', 'x-office-key': KEY },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : {} };
  };
}

describe('board routes', () => {
  test('every route needs the panel credential', async () => {
    rig = deliveryRig();
    const app = createApp({ office: rig.h.office, port: PORT, key: () => KEY, publicDir: rig.h.root }, () => {});
    for (const [method, path] of [
      ['GET', '/api/board'],
      ['POST', '/api/board/orders'],
      ['POST', '/api/board/orders/1/move'],
      ['POST', '/api/board/orders/1/discard'],
      ['POST', '/api/board/orders/1/folder'],
      ['POST', '/api/alerts/1/seen'],
      ['GET', '/api/worktrees'],
      ['POST', '/api/worktrees/prune'],
      ['POST', '/api/worktrees/1/keep'],
      ['DELETE', '/api/worktrees/1'],
    ] as const) {
      const response = await app.request(`http://127.0.0.1:${PORT}${path}`, { method, headers: { host: `127.0.0.1:${PORT}` } });
      expect(response.status).toBe(401);
    }
  });

  test('create, list, move, finish alert, seen and discard', async () => {
    rig = deliveryRig();
    const call = api(rig);
    expect(await call('POST', '/api/board/orders', { floor: 'mobile' })).toMatchObject({ status: 400, body: { error: { key: 'hub.api.boardFields' } } });
    const made = await call('POST', '/api/board/orders', { floor: 'mobile', title: 'Arreglar el logout', via: 'lead' });
    expect(made.status).toBe(200);
    const id = made.body.order.id as number;
    await rig.h.office.idle();
    const board = await call('GET', '/api/board');
    expect(board.body.orders).toEqual([expect.objectContaining({ id, status: 'pendiente', worktree: expect.objectContaining({ state: 'listo' }) })]);

    expect(await call('POST', `/api/board/orders/${id}/move`, { to: 'nope' })).toMatchObject({ status: 400 });
    expect((await call('POST', `/api/board/orders/${id}/move`, { to: 'en-curso' })).body.order.status).toBe('en-curso');
    expect(await call('POST', `/api/board/orders/${id}/move`, { to: 'en-curso' })).toMatchObject({ status: 409, body: { error: { key: 'hub.api.orderBadState' } } });
    expect(await call('POST', '/api/board/orders/9999/move', { to: 'hecho' })).toMatchObject({ status: 404 });
    expect((await call('POST', `/api/board/orders/${id}/move`, { to: 'hecho' })).body.order.status).toBe('hecho');

    const state = rig.h.office.snapshot();
    expect(state.finished).toHaveLength(1);
    const alertId = state.finished[0]?.id as number;
    expect((await call('POST', `/api/alerts/${alertId}/seen`)).status).toBe(200);
    expect(await call('POST', `/api/alerts/${alertId}/seen`)).toMatchObject({ status: 404, body: { error: { key: 'hub.api.alertNotFound' } } });
    expect(rig.h.office.snapshot().finished).toEqual([]);

    expect((await call('POST', `/api/board/orders/${id}/discard`)).body.order.status).toBe('descartado');
    expect((await call('POST', `/api/board/orders/${id}/discard`)).status).toBe(409);
  });
});

describe('worktree routes', () => {
  test('list, keep, refuse a dirty folder, delete with branch', async () => {
    rig = deliveryRig();
    const call = api(rig);
    const card = await newOrder(rig);
    const path = card.worktree?.path ?? '';
    const listed = await call('GET', '/api/worktrees?floor=mobile');
    expect(listed.body.worktrees).toEqual([expect.objectContaining({ orderId: card.id, slug: card.slug, state: 'listo', dirty: false })]);
    expect((await call('GET', '/api/worktrees?floor=otra')).body.worktrees).toEqual([]);

    await Bun.write(`${path}/sin-guardar.txt`, 'x');
    expect(await call('DELETE', `/api/worktrees/${card.id}`)).toMatchObject({ status: 409, body: { error: { key: 'hub.api.worktreeDirty' } } });
    expect(existsSync(path)).toBe(true);
    expect(await call('POST', `/api/worktrees/${card.id}/keep`)).toMatchObject({ status: 200 });
    expect(await call('POST', '/api/worktrees/999/keep')).toMatchObject({ status: 404, body: { error: { key: 'hub.api.worktreeNotFound' } } });
    expect(await call('DELETE', `/api/worktrees/${card.id}?branch=1&force=1`)).toMatchObject({ status: 200 });
    expect(existsSync(path)).toBe(false);
    expect(await call('DELETE', `/api/worktrees/${card.id}`)).toMatchObject({ status: 404 });
    expect(await call('DELETE', '/api/worktrees/abc')).toMatchObject({ status: 400 });
    expect((await call('POST', '/api/worktrees/prune')).status).toBe(200);
  });
});
