import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from '../src/config';
import { LayoutStore, MAX_DESKS, MAX_FLOORS, MAX_LAYOUTS_BYTES, emptyLayouts, validateLayouts } from '../src/layouts';
import { createApp } from '../src/server';
import type { LayoutsFile, ServerMessage } from '../src/types';
import { harness, keyOf, tempDir, type Harness } from './helpers';

const KEY = 'l'.repeat(64);
const PORT = 4747;

const sample: LayoutsFile = {
  version: 1,
  floors: {
    mobile: {
      lead: { u: 0.1, v: 0.4 },
      desks: [{ u: 0.3, v: 0.2 }, null, { u: 0.5, v: 0.8 }],
      furniture: { coffee: { u: 0.9, v: 0.1 }, board: { u: 0.7, v: 0 }, printer: { u: 0.95, v: 0.55 } },
    },
  },
  all: { characters: { dev: 'quaternius/punk.glb', lead: 'custom/boss.glb' } },
};

describe('validateLayouts', () => {
  test('accepts the empty layout and a full one, and gives back the same data', () => {
    expect(validateLayouts(emptyLayouts())).toEqual({ ok: true, data: { version: 1, floors: {} } });
    expect(validateLayouts(sample)).toEqual({ ok: true, data: sample });
  });

  test('rounds positions to four decimals and drops what the panel does not draw', () => {
    const result = validateLayouts({ version: 1, floors: { mobile: { lead: { u: 0.123456, v: 1, junk: true }, rooms: 7 } }, extra: 1 });
    expect(result).toEqual({ ok: true, data: { version: 1, floors: { mobile: { lead: { u: 0.1235, v: 1 } } } } });
  });

  test('keeps floors it does not know, so a floor that comes back finds its layout', () => {
    const result = validateLayouts({ version: 1, floors: { 'planta-borrada': { desks: [{ u: 0.2, v: 0.2 }] } } });
    expect(result.ok && Object.keys(result.data.floors)).toEqual(['planta-borrada']);
  });

  const reject = (raw: unknown, key: string, params?: Record<string, unknown>): void => {
    const result = validateLayouts(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error as unknown).toEqual(params ? { key, params } : { key });
  };
  const floorWith = (override: unknown) => ({ version: 1, floors: { mobile: override } });

  test('refuses what is not a version 1 layout', () => {
    for (const raw of [null, 3, 'x', [], {}, { version: 2, floors: {} }, { version: 1 }, { version: 1, floors: [] }]) reject(raw, 'hub.layouts.invalid');
    reject(floorWith([]), 'hub.layouts.invalid');
    reject(floorWith({ desks: 'x' }), 'hub.layouts.invalid');
    reject(floorWith({ furniture: [] }), 'hub.layouts.invalid');
    reject(floorWith({ characters: 4 }), 'hub.layouts.invalid');
  });

  test('refuses a position outside the floor or that is not a number', () => {
    for (const spot of [{ u: -0.01, v: 0 }, { u: 0, v: 1.01 }, { u: Number.NaN, v: 0 }, { u: '0.5', v: 0 }, { u: 0.5 }, null, 3]) {
      reject(floorWith({ lead: spot }), 'hub.layouts.spot', { where: 'mobile.lead' });
    }
    reject(floorWith({ desks: [{ u: 0, v: 0 }, { u: 2, v: 0 }] }), 'hub.layouts.spot', { where: 'mobile.desks[1]' });
    reject(floorWith({ furniture: { coffee: { u: 0, v: 9 } } }), 'hub.layouts.spot', { where: 'mobile.furniture.coffee' });
    reject({ version: 1, floors: {}, all: { lead: { u: 9, v: 0 } } }, 'hub.layouts.spot', { where: 'all.lead' });
  });

  test('at most 40 desks per floor and 64 floors', () => {
    const desks = (n: number) => Array.from({ length: n }, () => ({ u: 0.5, v: 0.5 }));
    expect(validateLayouts(floorWith({ desks: desks(MAX_DESKS) })).ok).toBe(true);
    reject(floorWith({ desks: desks(MAX_DESKS + 1) }), 'hub.layouts.tooManyDesks', { max: MAX_DESKS });
    const floors = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, index) => [`planta-${index}`, {}]));
    expect(validateLayouts({ version: 1, floors: floors(MAX_FLOORS) }).ok).toBe(true);
    reject({ version: 1, floors: floors(MAX_FLOORS + 1) }, 'hub.layouts.tooManyFloors', { max: MAX_FLOORS });
  });

  test('only the five pieces of furniture and the roles of the characters', () => {
    reject(floorWith({ furniture: { sofa: { u: 0, v: 0 } } }), 'hub.layouts.furniture', { name: 'sofa' });
    reject(floorWith({ characters: { wizard: 'quaternius/punk.glb' } }), 'hub.layouts.role', { role: 'wizard' });
  });

  test('models are a file of the pack or of the custom folder, nothing else', () => {
    for (const model of ['quaternius/punk.glb', 'quaternius/business-man.glb', 'custom/mi_jefe-2.glb']) {
      expect(validateLayouts(floorWith({ characters: { dev: model } })).ok, model).toBe(true);
    }
    for (const model of ['../x.glb', 'quaternius/../x.glb', 'quaternius/Punk.glb', 'quaternius/punk.gltf', 'custom/a/b.glb', 'http://x/y.glb', '/etc/passwd', '', 7]) {
      reject(floorWith({ characters: { dev: model } }), 'hub.layouts.model', { role: 'dev' });
    }
  });

  test('floor names that could not be a slug are refused', () => {
    for (const slug of ['../etc', 'a/b', '', ' mobile', 'x'.repeat(65)]) reject({ version: 1, floors: { [slug]: {} } }, 'hub.layouts.slug', { slug });
  });
});

describe('LayoutStore', () => {
  test('without a file it starts empty, and what it saves survives a restart, in a file of mode 600', () => {
    const t = tempDir();
    try {
      const file = join(t.dir, 'home', 'layouts.json');
      const store = new LayoutStore(file);
      expect(store.get()).toEqual(emptyLayouts());
      expect(store.save(sample)).toEqual({ ok: true, data: sample });
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(sample);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(readdirSync(join(t.dir, 'home'))).toEqual(['layouts.json']);
      expect(new LayoutStore(file).get()).toEqual(sample);
    } finally {
      t.cleanup();
    }
  });

  test('an invalid body changes nothing, in memory or on disk', () => {
    const t = tempDir();
    try {
      const file = join(t.dir, 'layouts.json');
      const store = new LayoutStore(file);
      store.save(sample);
      const before = readFileSync(file, 'utf8');
      expect(store.save({ version: 1, floors: { mobile: { lead: { u: 3, v: 0 } } } }).ok).toBe(false);
      expect(store.get()).toEqual(sample);
      expect(readFileSync(file, 'utf8')).toBe(before);
    } finally {
      t.cleanup();
    }
  });

  test('a broken file on disk is logged and ignored, not fatal', () => {
    const t = tempDir();
    try {
      const file = join(t.dir, 'layouts.json');
      const lines: string[] = [];
      writeFileSync(file, '{not json');
      expect(new LayoutStore(file, (line) => lines.push(line)).get()).toEqual(emptyLayouts());
      writeFileSync(file, JSON.stringify({ version: 9, floors: {} }));
      expect(new LayoutStore(file, (line) => lines.push(line)).get()).toEqual(emptyLayouts());
      expect(lines).toHaveLength(2);
    } finally {
      t.cleanup();
    }
  });

  test('a file that cannot be written is reported and the old layout stays', () => {
    const t = tempDir();
    try {
      const blocked = join(t.dir, 'blocked');
      writeFileSync(blocked, 'a file where a folder should be');
      const lines: string[] = [];
      const store = new LayoutStore(join(blocked, 'layouts.json'), (line) => lines.push(line));
      const result = store.save(sample);
      expect(result).toMatchObject({ ok: false, failed: true, error: { key: 'hub.layouts.saveFailed' } });
      expect(store.get()).toEqual(emptyLayouts());
      expect(lines).toHaveLength(1);
    } finally {
      t.cleanup();
    }
  });

  test('lives in layouts.json of the home folder', () => {
    expect(paths({ AGENT_OFFICE_HOME: '/h', AGENT_OFFICE_CLAUDE_HOME: '/c' }).layouts).toBe('/h/layouts.json');
  });
});

describe('the layouts of the office', () => {
  let h: Harness | undefined;
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    h?.cleanup();
    cleanup?.();
    h = undefined;
    cleanup = undefined;
  });

  function rig(withStore = true) {
    const t = tempDir();
    cleanup = t.cleanup;
    const file = join(t.dir, 'home', 'layouts.json');
    h = harness(withStore ? { layouts: new LayoutStore(file) } : {});
    const app = createApp({ office: h.office, port: PORT, key: () => KEY, publicDir: h.root }, () => {});
    const call = async (method: string, path: string, body?: unknown, raw?: string) => {
      const response = await app.request(`http://127.0.0.1:${PORT}${path}`, {
        method,
        headers: { host: `127.0.0.1:${PORT}`, 'content-type': 'application/json', 'x-office-key': KEY },
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      const text = await response.text();
      return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : {} };
    };
    const layoutMessages = (): ServerMessage[] => (h?.messages ?? []).filter((message) => message.type === 'layouts');
    return { app, call, file, layoutMessages };
  }

  test('both routes need the panel credential', async () => {
    const { app } = rig();
    for (const method of ['GET', 'PUT']) {
      const response = await app.request(`http://127.0.0.1:${PORT}/api/layouts`, { method, headers: { host: `127.0.0.1:${PORT}` } });
      expect(response.status).toBe(401);
    }
  });

  test('PUT saves, GET returns it, the snapshot carries it and every panel gets a layouts message', async () => {
    const { call, file, layoutMessages } = rig();
    expect(await call('GET', '/api/layouts')).toEqual({ status: 200, body: emptyLayouts() });
    expect(h!.office.snapshot().layouts).toEqual(emptyLayouts());

    expect(await call('PUT', '/api/layouts', sample)).toEqual({ status: 200, body: { ok: true, data: sample } });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(sample);
    expect((await call('GET', '/api/layouts')).body).toEqual(sample);
    expect(h!.office.snapshot().layouts).toEqual(sample);
    expect(layoutMessages()).toEqual([{ type: 'layouts', data: sample }]);

    const empty = await call('PUT', '/api/layouts', emptyLayouts());
    expect(empty.status).toBe(200);
    expect(layoutMessages()).toHaveLength(2);
  });

  test('an invalid layout is a 400 with the reason, and nothing is saved or announced', async () => {
    const { call, file, layoutMessages } = rig();
    const result = await call('PUT', '/api/layouts', { version: 1, floors: { mobile: { desks: [{ u: 5, v: 0 }] } } });
    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    expect(keyOf(result.body.error)).toBe('hub.layouts.spot');
    expect((await call('PUT', '/api/layouts', null, 'not json')).status).toBe(400);
    expect(existsSync(file)).toBe(false);
    expect(layoutMessages()).toEqual([]);
  });

  test('a body over 64 KB is a 413 and the file keeps what it had', async () => {
    const { call, file, layoutMessages } = rig();
    await call('PUT', '/api/layouts', sample);
    const big = { ...sample, padding: 'x'.repeat(MAX_LAYOUTS_BYTES) };
    const result = await call('PUT', '/api/layouts', big);
    expect(result).toEqual({ status: 413, body: { error: { key: 'hub.api.bodyTooLarge' } } });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(sample);
    expect(layoutMessages()).toHaveLength(1);

    const desks = Array.from({ length: MAX_DESKS }, (_, index) => ({ u: 0.123456 + index / 100, v: 0.654321 }));
    const roomy = { version: 1, floors: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`planta-numero-${index}`, { desks }])) };
    expect(JSON.stringify(roomy).length).toBeLessThan(MAX_LAYOUTS_BYTES);
    expect((await call('PUT', '/api/layouts', roomy)).status).toBe(200);
    const everything = { version: 1, floors: Object.fromEntries(Array.from({ length: MAX_FLOORS }, (_, index) => [`planta-numero-${index}`, { desks }])) };
    expect(JSON.stringify(everything).length).toBeGreaterThan(MAX_LAYOUTS_BYTES);
    expect((await call('PUT', '/api/layouts', everything)).status).toBe(413);
  });

  test('without a store the office answers 503 and still serves an empty layout', async () => {
    const { call, layoutMessages } = rig(false);
    expect((await call('GET', '/api/layouts')).body).toEqual(emptyLayouts());
    const result = await call('PUT', '/api/layouts', sample);
    expect(result.status).toBe(503);
    expect(keyOf(result.body.error)).toBe('hub.layouts.unavailable');
    expect(layoutMessages()).toEqual([]);
  });

  test('saving creates the home folder when it is not there yet', async () => {
    const { call, file } = rig();
    expect(existsSync(join(file, '..'))).toBe(false);
    expect((await call('PUT', '/api/layouts', sample)).status).toBe(200);
    expect(existsSync(file)).toBe(true);
  });
});
