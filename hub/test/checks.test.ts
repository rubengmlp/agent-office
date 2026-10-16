import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resultText } from '../src/checks';
import type { OfficeConfig } from '../src/types';
import { deskRig, type DeskRig } from './desk-rig';
import { git } from './helpers';

let rig: DeskRig | undefined;
afterEach(() => {
  rig?.cleanup();
  rig = undefined;
});

const checksOf = (...specs: [string, string][]) => (config: OfficeConfig) => {
  const floor = config.floors.mobile;
  if (floor) floor.checks = specs.map(([name, command]) => ({ name, command }));
};

async function startAndWait(r: DeskRig, trigger: 'listo' | 'comprobar' | 'panel' | 'hecho' = 'comprobar') {
  const started = await r.checks.start(r.order.id, trigger);
  if (!started.ok) throw new Error(`not started: ${started.reason}`);
  return { started, view: await started.done };
}

describe('a run', () => {
  test('green: every check passes, the lead is told which sha to repeat the HECHO on', async () => {
    rig = deskRig({ configure: checksOf(['uno', 'echo hola'], ['dos', 'exit 0']) });
    const { started, view } = await startAndWait(rig);
    expect(view).toMatchObject({ status: 'passed', trigger: 'comprobar', sha: git(rig.path, 'rev-parse', 'HEAD') });
    expect(view.checks.map((c) => [c.name, c.status, c.exitCode])).toEqual([['uno', 'passed', 0], ['dos', 'passed', 0]]);
    expect(view.checks[0]?.outputTail).toBe('hola\n');
    expect(view.checks[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(started.run.status).toBe('running');
    expect(rig.notified).toEqual([{ slug: 'login-a1b2', text: `[Agent Office] COMPROBACIONES encargo/login-a1b2 en verde @${view.sha.slice(0, 7)}: repite el HECHO` }]);
    expect(rig.checks.summary(rig.order)).toMatchObject({ status: 'passed', passed: 2, total: 2, sha: view.sha, touched: [], forced: false });
    expect(rig.messages.filter((m) => m.type === 'checks').length).toBeGreaterThan(1);
    expect(rig.checks.latest(rig.order.id)?.id).toBe(view.id);
  });

  test('red: the first failing check, its code and the end of its output reach the lead', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `linea ${i + 1}`).join('\\n');
    rig = deskRig({ configure: checksOf(['lint', 'exit 0'], ['test', `printf '${lines}\\n'; exit 3`]) });
    const { view } = await startAndWait(rig);
    expect(view.status).toBe('failed');
    expect(view.checks.map((c) => c.status)).toEqual(['passed', 'failed']);
    const text = rig.notified[0]?.text ?? '';
    expect(text).toContain('en rojo');
    expect(text).toContain('test terminó con código 3');
    expect(text).toContain('linea 60');
    expect(text).toContain('linea 21');
    expect(text).not.toContain('linea 20\n');
    expect(rig.checks.summary(rig.order)).toMatchObject({ status: 'failed', passed: 1, total: 2 });
  });

  test('a checkpoint comes first, so the run is about the new HEAD', async () => {
    rig = deskRig({ configure: checksOf(['uno', 'exit 0']) });
    const before = git(rig.path, 'rev-parse', 'HEAD');
    writeFileSync(join(rig.path, 'nuevo.txt'), 'x');
    const { view } = await startAndWait(rig, 'listo');
    expect(view.sha).not.toBe(before);
    expect(view.sha).toBe(git(rig.path, 'rev-parse', 'HEAD'));
    expect(rig.checkpoints.list(rig.order.id)).toHaveLength(1);
    expect(git(rig.path, 'log', '-1', '--format=%s')).toBe('encargo(login-a1b2): listo');
  });

  test('a failed commit runs the checks on HEAD-dirty, which never matches a HEAD', async () => {
    rig = deskRig({ configure: checksOf(['uno', 'exit 0']) });
    const hook = join(git(rig.path, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'hooks', 'pre-commit');
    await Bun.$`mkdir -p ${join(hook, '..')}`;
    writeFileSync(hook, '#!/bin/sh\nexit 1\n');
    await Bun.$`chmod +x ${hook}`;
    writeFileSync(join(rig.path, 'nuevo.txt'), 'x');
    const head = git(rig.path, 'rev-parse', 'HEAD');
    const { view } = await startAndWait(rig);
    expect(view.sha).toBe(`${head}-dirty`);
    expect(rig.checks.gateReading(rig.order)).toMatchObject({ head, dirty: ['nuevo.txt'], run: { sha: `${head}-dirty`, status: 'passed' } });
  });

  test('without checks or without a folder nothing starts', async () => {
    rig = deskRig({ configure: (config) => (config.floors.mobile!.checks = []) });
    expect(await rig.checks.start(rig.order.id, 'panel')).toEqual({ ok: false, reason: 'no-checks' });
    expect(await rig.checks.start(999, 'panel')).toEqual({ ok: false, reason: 'no-folder' });
    expect(rig.checks.summary(rig.order)).toBeNull();
    expect(rig.checks.latest(rig.order.id)).toBeNull();
  });

  test('the output keeps only the last tailBytes', async () => {
    rig = deskRig({
      configure: (config) => {
        checksOf(['ruido', "yes abcdefghij | head -c 20000; echo FINAL; exit 1"])(config);
        config.checksConfig.tailBytes = 1000;
      },
    });
    const { view } = await startAndWait(rig);
    const tail = view.checks[0]?.outputTail ?? '';
    expect(new TextEncoder().encode(tail).length).toBeLessThanOrEqual(1000);
    expect(tail.endsWith('FINAL\n')).toBe(true);
  });
});

describe('time, cancel and sharing', () => {
  test('a check past its timeout is killed with everything it started', async () => {
    rig = deskRig({
      configure: (config) => {
        checksOf(['lento', 'sleep 37 & sleep 38; echo no'])(config);
        config.checksConfig.timeoutMinutes = 0.02;
      },
    });
    const started = Date.now();
    const { view } = await startAndWait(rig);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(view).toMatchObject({ status: 'failed' });
    expect(view.checks[0]).toMatchObject({ status: 'timeout' });
    expect(rig.notified[0]?.text).toContain('lento se pasó del tiempo');
    const left = Bun.spawnSync(['sh', '-c', 'ps -axo command | grep "sleep 3[78]" | grep -v grep']).stdout.toString();
    expect(left).toBe('');
    expect(rig.checks.gateReading(rig.order).run).toMatchObject({ status: 'failed', failed: { name: 'lento', timedOut: true } });
  });

  test('cancelling stops the run, marks it cancelled and tells nobody', async () => {
    rig = deskRig({ configure: checksOf(['lento', 'sleep 39']) });
    const started = await rig.checks.start(rig.order.id, 'panel');
    if (!started.ok) throw new Error('start');
    await Bun.sleep(100);
    expect(rig.checks.cancel(rig.order.id)).toBe(true);
    const view = await started.done;
    expect(view.status).toBe('cancelled');
    expect(view.checks[0]?.status).toBe('cancelled');
    expect(rig.notified).toEqual([]);
    expect(rig.checks.cancel(rig.order.id)).toBe(false);
    expect(rig.checks.summary(rig.order)).toMatchObject({ status: 'none' });
    expect(rig.checks.gateReading(rig.order).run).toMatchObject({ status: 'cancelled' });
  });

  test('a second request on the same HEAD joins the run; a new HEAD restarts it', async () => {
    const marks = () => join(rig?.root ?? '', 'marks.txt');
    rig = deskRig();
    rig.config.floors.mobile!.checks = [{ name: 'cuenta', command: `echo run >> ${marks()}; sleep 0.4` }];
    const first = await rig.checks.start(rig.order.id, 'panel');
    const joined = await rig.checks.start(rig.order.id, 'comprobar');
    if (!first.ok || !joined.ok) throw new Error('start');
    expect(joined.run.id).toBe(first.run.id);
    await first.done;
    expect(readFileSync(marks(), 'utf8').trim().split('\n')).toHaveLength(1);

    const slow = await rig.checks.start(rig.order.id, 'panel');
    if (!slow.ok) throw new Error('start');
    writeFileSync(join(rig.path, 'otro.txt'), 'x');
    const restarted = await rig.checks.start(rig.order.id, 'listo');
    if (!restarted.ok) throw new Error('start');
    expect(restarted.run.id).not.toBe(slow.run.id);
    expect((await slow.done).status).toBe('cancelled');
    expect((await restarted.done).status).toBe('passed');
    expect(rig.notified).toHaveLength(2);
  });

  test('maxParallel caps the checks that run at once across the hub', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'checks-'));
    const log = () => join(dir, 'order.txt');
    const spec = (name: string): [string, string] => [name, `echo start >> ${log()}; sleep 0.3; echo end >> ${log()}`];
    rig = deskRig({
      configure: (config) => {
        checksOf(spec('a'), spec('b'), spec('c'))(config);
        config.checksConfig.maxParallel = 1;
      },
    });
    await startAndWait(rig);
    expect(readFileSync(log(), 'utf8').trim().split('\n')).toEqual(['start', 'end', 'start', 'end', 'start', 'end']);

    writeFileSync(log(), '');
    rig.config.checksConfig.maxParallel = 3;
    writeFileSync(join(rig.path, 'x.txt'), 'x');
    await startAndWait(rig);
    expect(readFileSync(log(), 'utf8').trim().split('\n').slice(0, 3)).toEqual(['start', 'start', 'start']);

    writeFileSync(log(), '');
    rig.config.checksConfig.maxParallel = 2;
    const other = rig.second();
    writeFileSync(join(other.worktree_path as string, 'y.txt'), 'y');
    writeFileSync(join(rig.path, 'z.txt'), 'z');
    const [one, two] = await Promise.all([rig.checks.start(rig.order.id, 'panel'), rig.checks.start(other.id, 'panel')]);
    if (!one.ok || !two.ok) throw new Error('start');
    await Promise.all([one.done, two.done]);
    const lines = readFileSync(log(), 'utf8').trim().split('\n');
    let running = 0;
    let peak = 0;
    for (const line of lines) {
      running += line === 'start' ? 1 : -1;
      peak = Math.max(peak, running);
    }
    expect(lines).toHaveLength(12);
    expect(peak).toBeLessThanOrEqual(2);
  });

  test('listo schedules one run after the delay however many times it is said', async () => {
    rig = deskRig({ configure: checksOf(['uno', 'exit 0']), listoDelayMs: 80 });
    rig.checks.scheduleListo(rig.order);
    await Bun.sleep(40);
    rig.checks.scheduleListo(rig.order);
    expect(rig.checks.latest(rig.order.id)).toBeNull();
    await Bun.sleep(60);
    expect(rig.checks.latest(rig.order.id)).toBeNull();
    await Bun.sleep(150);
    await rig.checks.idle();
    expect(rig.checks.latest(rig.order.id)).toMatchObject({ trigger: 'listo', status: 'passed' });
    expect(rig.notified).toHaveLength(1);
  });

  test('stop drops the pending listo', async () => {
    rig = deskRig({ configure: checksOf(['uno', 'exit 0']), listoDelayMs: 50 });
    rig.checks.scheduleListo(rig.order);
    rig.checks.stop();
    await Bun.sleep(120);
    expect(rig.checks.latest(rig.order.id)).toBeNull();
  });
});

describe('the reading of the gate', () => {
  test('HEAD, dirt, the last run and the definition files of the order', async () => {
    rig = deskRig({ configure: checksOf(['uno', 'exit 0']) });
    const head = git(rig.path, 'rev-parse', 'HEAD');
    expect(rig.checks.gateReading(rig.order)).toEqual({ head, dirty: [], run: null, touched: [], forcedSha: null, hasChecks: true });
    writeFileSync(join(rig.path, 'a.txt'), 'a');
    expect(rig.checks.gateReading(rig.order).dirty).toEqual(['a.txt']);
    const { view } = await startAndWait(rig);
    const clean = rig.checks.gateReading(rig.order);
    expect(clean).toMatchObject({ head: view.sha, dirty: [], run: { sha: view.sha, status: 'passed', failed: null } });
  });

  test('a changed package.json scripts key is touched, the force is valid for one HEAD only', async () => {
    rig = deskRig({ configure: checksOf(['uno', 'exit 0']) });
    rig.config.floors.mobile!.stack = 'node';
    const first = JSON.stringify({ name: 'x', scripts: { test: 'vitest' }, version: '1' });
    writeFileSync(join(rig.path, 'package.json'), first);
    git(rig.path, 'add', '-A');
    git(rig.path, 'commit', '-q', '-m', 'package.json');
    const base = git(rig.path, 'rev-parse', 'HEAD');
    rig.store.update(rig.order.id, { base_sha: base });
    const order = rig.store.get(rig.order.id)!;

    writeFileSync(join(rig.path, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'true' }, version: '2' }));
    await rig.checkpoints.commit(order, 'listo', 'listo');
    const reading = rig.checks.gateReading(order);
    expect(reading.touched).toEqual(['package.json#scripts']);
    expect(rig.checks.summary(order)).toMatchObject({ touched: ['package.json#scripts'], forced: false });

    const forcedAt = rig.checks.force(order);
    expect(forcedAt).toBe(reading.head);
    const forced = rig.store.get(order.id)!;
    expect(rig.checks.gateReading(forced)).toMatchObject({ forcedSha: reading.head, touched: ['package.json#scripts'] });
    expect(rig.checks.summary(forced)).toMatchObject({ forced: true });

    writeFileSync(join(rig.path, 'a.txt'), 'a');
    await rig.checkpoints.commit(forced, 'listo', 'listo');
    const next = rig.checks.gateReading(rig.store.get(order.id)!);
    expect(next.head).not.toBe(reading.head);
    expect(next.forcedSha).toBe(reading.head);
    expect(next.forcedSha === next.head).toBe(false);
  });

  test('resultText for a run without a red check', () => {
    expect(resultText(rig?.order ?? ({ slug: 'x' } as never), { id: 1, orderId: 1, sha: 'abcdef1234', trigger: 'panel', status: 'cancelled', startedAt: 1, endedAt: 2, checks: [] })).toContain('sin resultado');
  });

  test('a folder that does not exist reads as no HEAD', () => {
    rig = deskRig({ configure: checksOf(['uno', 'exit 0']) });
    const gone = rig.store.update(rig.order.id, { worktree_path: join(rig.root, 'nada') })!;
    expect(existsSync(gone.worktree_path as string)).toBe(false);
    expect(rig.checks.gateReading(gone)).toMatchObject({ head: null, dirty: [], run: null });
  });
});
