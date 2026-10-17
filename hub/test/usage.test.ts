import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prune } from '../src/prune';
import { STATUSLINE_SCRIPT } from '../src/office-sh';
import { forecast, type UsageSample } from '../src/usage';
import type { UsageWindow } from '../src/types';
import { startServer } from '../src/server';
import type { ServerMessage, Snapshot } from '../src/types';
import { openDb } from '../src/db';
import { harness } from './helpers';

const KEY = 'u'.repeat(64);
const LINE = /^5 h 23 % · reinicio \d\d:\d\d · semana 41 %$/;

async function freePort(): Promise<number> {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
  const port = Number(probe.port);
  probe.stop(true);
  return port;
}

describe('usage', () => {
  const h = harness();
  let base = '';
  let port = 0;
  let stop = () => {};
  const seconds = () => Math.floor(h.clock.now / 1000);
  const limits = (five: number | null, seven: number | null) => ({
    session_id: 'lead-1',
    rate_limits: {
      ...(five === null ? {} : { five_hour: { used_percentage: 23, resets_at: seconds() + five } }),
      ...(seven === null ? {} : { seven_day: { used_percentage: 41, resets_at: seconds() + seven } }),
    },
  });
  const post = (body: unknown, key: string | null = KEY) =>
    fetch(`${base}/usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key === null ? {} : { 'X-Office-Key': key }) },
      body: JSON.stringify(body),
    });
  const usageMessages = (): Extract<ServerMessage, { type: 'usage' }>[] =>
    h.messages.filter((m): m is Extract<ServerMessage, { type: 'usage' }> => m.type === 'usage');

  beforeAll(async () => {
    port = await freePort();
    base = `http://127.0.0.1:${port}`;
    mkdirSync(join(h.root, 'public'), { recursive: true });
    ({ stop } = startServer({ office: h.office, port, key: () => KEY, publicDir: join(h.root, 'public') }));
  });

  afterAll(() => {
    stop();
    h.cleanup();
  });

  test('before any sample the snapshot has an empty usage and nothing is announced', () => {
    expect(h.office.snapshot().usage).toEqual({ fiveHour: null, sevenDay: null, at: null });
    expect(usageMessages()).toHaveLength(0);
  });

  test('a sample is stored, announced and answered as a status line', async () => {
    const res = await post(limits(7800, 3 * 86400));
    expect(res.status).toBe(200);
    expect((await res.text()).trim()).toMatch(LINE);
    const view = h.office.snapshot().usage;
    expect(view.fiveHour).toMatchObject({ usedPct: 23, resetsAt: (seconds() + 7800) * 1000, forecast: { basis: 'thin' } });
    expect(view.sevenDay).toMatchObject({ usedPct: 41, resetsAt: (seconds() + 3 * 86400) * 1000, forecast: { basis: 'thin' } });
    expect(view.at).toBe(h.clock.now);
    expect(usageMessages().at(-1)?.data).toEqual(view);
    const snapshot: Snapshot = h.office.snapshot();
    expect(snapshot.usage).toEqual(view);
  });

  test('the key is required', async () => {
    expect((await post(limits(7800, null), null)).status).toBe(401);
    expect((await post(limits(7800, null), 'x'.repeat(64))).status).toBe(401);
  });

  test('the latest sample wins, whichever session sends it', async () => {
    h.clock.advance(60_000);
    const res = await post({ session_id: 'lead-2', rate_limits: { five_hour: { used_percentage: 30, resets_at: seconds() + 7000 } } });
    expect((await res.text()).trim()).toMatch(/^5 h 30 % · reinicio \d\d:\d\d · semana 41 %$/);
    const view = h.office.snapshot().usage;
    expect(view.fiveHour?.usedPct).toBe(30);
    expect(view.sevenDay?.usedPct).toBe(41);
    expect(view.at).toBe(h.clock.now);
  });

  test('a window whose reset has passed is dropped', async () => {
    const before = usageMessages().length;
    const res = await post(limits(-10, -10));
    expect(await res.text()).toBe('');
    expect(usageMessages()).toHaveLength(before);
    h.clock.advance(7100 * 1000);
    const view = h.office.snapshot().usage;
    expect(view.fiveHour).toBeNull();
    expect(view.sevenDay).not.toBeNull();
    expect(view.at).not.toBeNull();
  });

  test('a body without rate_limits answers empty and changes nothing', async () => {
    const before = h.office.snapshot().usage;
    const count = usageMessages().length;
    for (const body of [{ session_id: 'api', model: { id: 'x' } }, { rate_limits: {} }, { rate_limits: { five_hour: { used_percentage: 'a' } } }, null, 'texto']) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('');
    }
    expect(h.office.snapshot().usage).toEqual(before);
    expect(usageMessages()).toHaveLength(count);
  });

  test('percentages are clamped to 0-100', async () => {
    await post({ rate_limits: { five_hour: { used_percentage: 140, resets_at: seconds() + 100 } } });
    expect(h.office.snapshot().usage.fiveHour?.usedPct).toBe(100);
  });

  describe('status line script', () => {
    const home = join(h.root, 'office-home');
    const run = async (env: Record<string, string>, stdin: string) => {
      const proc = Bun.spawn(['sh', STATUSLINE_SCRIPT], {
        stdin: new Blob([stdin]),
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, AGENT_OFFICE_HOME: home, ...env },
      });
      const out = await new Response(proc.stdout).text();
      return { out, code: await proc.exited };
    };

    test('posts the stdin JSON to the hub and prints its line', async () => {
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, 'key'), KEY);
      writeFileSync(join(home, 'headers'), `X-Office-Key: ${KEY}\n`);
      writeFileSync(join(home, 'port'), String(port));
      const result = await run({}, JSON.stringify(limits(7800, 3 * 86400)));
      expect(result.code).toBe(0);
      expect(result.out.trim()).toMatch(LINE);
    });

    test('prints nothing and exits 0 when the hub does not answer or there is no key', async () => {
      writeFileSync(join(home, 'port'), String(await freePort()));
      const down = await run({}, '{}');
      expect(down).toEqual({ out: '', code: 0 });
      const lost = await run({ AGENT_OFFICE_HOME: join(h.root, 'nowhere') }, '{}');
      expect(lost).toEqual({ out: '', code: 0 });
      writeFileSync(join(home, 'port'), String(port));
    });
  });
});

describe('limit forecast', () => {
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const NOW = 1_800_000_000_000;
  const RESETS = NOW + 3 * HOUR;
  // A straight line: `rate` percent per hour, ending at `end` percent now, one sample per minute for `minutes`.
  const series = (rate: number, end: number, minutes: number, resetsAt = RESETS): UsageSample[] =>
    Array.from({ length: minutes + 1 }, (_, i) => {
      const ts = NOW - (minutes - i) * MIN;
      return { ts, usedPct: end - (rate * (NOW - ts)) / HOUR, resetsAt };
    });
  const win = (usedPct: number, resetsAt = RESETS): UsageWindow => ({ usedPct, resetsAt });

  test('the slope of a synthetic series gives the pace and the moment it runs dry', () => {
    const f = forecast(series(20, 50, 30), NOW, win(50), 'five');
    expect(f.basis).toBe('fit');
    expect(f.rate).toBeCloseTo(20, 5);
    expect(f.exhaustsAt).toBeCloseTo(NOW + 2.5 * HOUR, -2);
    expect(f.safe).toBe(false);
  });

  test('it is safe when the window resets before it runs dry', () => {
    const f = forecast(series(10, 50, 30, NOW + 2 * HOUR), NOW, win(50, NOW + 2 * HOUR), 'five');
    expect(f.exhaustsAt).toBeCloseTo(NOW + 5 * HOUR, -2);
    expect(f.safe).toBe(true);
  });

  test('a flat or falling series is safe and has no moment', () => {
    for (const rate of [0, 0.1, -5]) {
      const f = forecast(series(rate, 40, 30), NOW, win(40), 'five');
      expect(f).toMatchObject({ safe: true, exhaustsAt: null, basis: 'fit' });
    }
  });

  test('fewer than three points, or points closer than 10 minutes, are thin', () => {
    expect(forecast(series(12, 50, 1), NOW, win(50), 'five').basis).toBe('thin');
    expect(forecast(series(12, 50, 8), NOW, win(50), 'five')).toMatchObject({ basis: 'thin', exhaustsAt: null, safe: false });
    expect(forecast([], NOW, win(50), 'five').basis).toBe('thin');
    expect(forecast(series(12, 50, 10), NOW, win(50), 'five').basis).toBe('fit');
  });

  test('the week looks at 6 hours and wants 2 hours of spread', () => {
    expect(forecast(series(1, 30, 60), NOW, win(30), 'seven').basis).toBe('thin');
    const f = forecast(series(1, 30, 180), NOW, win(30), 'seven');
    expect(f.basis).toBe('fit');
    expect(f.rate).toBeCloseTo(1, 5);
    const old: UsageSample[] = [{ ts: NOW - 7 * HOUR, usedPct: 0, resetsAt: RESETS }, ...series(1, 30, 180)];
    expect(forecast(old, NOW, win(30), 'seven').rate).toBeCloseTo(1, 5);
  });

  test('five hours only looks at the last 45 minutes', () => {
    const early = Array.from({ length: 30 }, (_, i) => ({ ts: NOW - 4 * HOUR + i * MIN, usedPct: 5, resetsAt: RESETS }));
    const f = forecast([...early, ...series(12, 50, 30)], NOW, win(50), 'five');
    expect(f.rate).toBeCloseTo(12, 5);
  });

  test('samples of another reset do not count, the tolerance is 90 seconds', () => {
    const before = series(30, 80, 30, RESETS - 5 * HOUR);
    const after = series(2, 10, 20);
    expect(forecast([...before, ...after], NOW, win(10), 'five').rate).toBeCloseTo(2, 5);
    const jitter = series(12, 50, 30).map((p, i) => ({ ...p, resetsAt: RESETS + (i % 2 === 0 ? 80_000 : -80_000) }));
    expect(forecast(jitter, NOW, win(50), 'five').basis).toBe('fit');
    const apart = series(12, 50, 30, RESETS + 120_000);
    expect(forecast(apart, NOW, win(50), 'five').basis).toBe('thin');
  });

  describe('sampling', () => {
    const RESETS = NOW + 3 * HOUR;
    const MIN = 60_000;
    const rows = (db: ReturnType<typeof openDb>) =>
      db.query<{ ts: number; win: string; used_pct: number; resets_at: number }, []>('SELECT ts, win, used_pct, resets_at FROM usage_samples ORDER BY win, ts').all();
    const body = (_now: number, five: number, seven?: number, resets = RESETS) => ({
      rate_limits: {
        five_hour: { used_percentage: five, resets_at: Math.floor(resets / 1000) },
        ...(seven === undefined ? {} : { seven_day: { used_percentage: seven, resets_at: Math.floor((resets + 3 * 86400_000) / 1000) } }),
      },
    });

    test('one sample per window and minute, or sooner when the value moves', () => {
      const h2 = harness();
      try {
        h2.office.ingestUsage(body(h2.clock.now, 10, 3));
        h2.clock.advance(20_000);
        h2.office.ingestUsage(body(h2.clock.now, 10, 3));
        expect(rows(h2.db)).toHaveLength(2);
        h2.clock.advance(5_000);
        h2.office.ingestUsage(body(h2.clock.now, 11, 3));
        expect(rows(h2.db).filter((r) => r.win === 'five')).toHaveLength(2);
        expect(rows(h2.db).filter((r) => r.win === 'seven')).toHaveLength(1);
        h2.clock.advance(60_000);
        h2.office.ingestUsage(body(h2.clock.now, 11, 3));
        expect(rows(h2.db).filter((r) => r.win === 'five')).toHaveLength(3);
        expect(rows(h2.db).filter((r) => r.win === 'seven')).toHaveLength(2);
      } finally {
        h2.cleanup();
      }
    });

    test('a window that reset leaves the old samples out of the forecast', () => {
      const h2 = harness();
      try {
        for (let i = 0; i < 20; i += 1) {
          h2.office.ingestUsage(body(h2.clock.now, 60 + i));
          h2.clock.advance(MIN);
        }
        expect(h2.office.snapshot().usage.fiveHour?.forecast?.basis).toBe('fit');
        h2.clock.advance(4 * HOUR);
        h2.office.ingestUsage(body(h2.clock.now, 2, undefined, h2.clock.now + 5 * HOUR));
        expect(h2.office.snapshot().usage.fiveHour?.forecast).toMatchObject({ basis: 'thin' });
      } finally {
        h2.cleanup();
      }
    });

    test('an Office started later on the same database keeps forecasting with the stored samples', () => {
      const first = harness();
      try {
        for (let i = 0; i < 16; i += 1) {
          first.office.ingestUsage(body(first.clock.now, 20 + i * 2));
          first.clock.advance(MIN);
        }
        const resumed = harness({ db: first.db });
        try {
          resumed.clock.now = first.clock.now;
          expect(resumed.office.snapshot().usage.fiveHour).toBeNull();
          resumed.office.ingestUsage(body(resumed.clock.now, 52));
          expect(resumed.office.snapshot().usage.fiveHour?.forecast).toMatchObject({ basis: 'fit' });
          expect(resumed.office.snapshot().usage.fiveHour?.forecast?.rate).toBeCloseTo(120, 0);
        } finally {
          resumed.cleanup();
        }
      } finally {
        first.cleanup();
      }
    });

    test('prune keeps samples for eight days whatever the retention', () => {
      const db = openDb(':memory:');
      const now = 1_800_000_000_000;
      const insert = db.query('INSERT INTO usage_samples (ts, win, used_pct, resets_at) VALUES (?, ?, ?, ?)');
      insert.run(now - 9 * 24 * HOUR, 'five', 10, now);
      insert.run(now - 7 * 24 * HOUR, 'five', 10, now);
      prune(db, now, 30);
      expect(rows(db).map((r) => r.ts)).toEqual([now - 7 * 24 * HOUR]);
    });
  });
});
