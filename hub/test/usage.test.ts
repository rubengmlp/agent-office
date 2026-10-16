import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATUSLINE_SCRIPT } from '../src/office-sh';
import { startServer } from '../src/server';
import type { ServerMessage, Snapshot } from '../src/types';
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
    expect(view.fiveHour).toEqual({ usedPct: 23, resetsAt: (seconds() + 7800) * 1000 });
    expect(view.sevenDay).toEqual({ usedPct: 41, resetsAt: (seconds() + 3 * 86400) * 1000 });
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
