import { describe, expect, test } from 'bun:test';
import { checksTouched, decideOrderGate, remainingDirty, type OrderGateFacts } from '../src/gate';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

const green = { sha: HEAD, status: 'passed' as const, failed: null };

function facts(over: Partial<OrderGateFacts> = {}): OrderGateFacts {
  return { mode: 'checks', hasChecks: true, head: HEAD, dirty: [], run: green, tester: null, touched: [], forcedSha: null, ...over };
}

describe('decideOrderGate', () => {
  test('green on HEAD with a clean folder passes', () => {
    expect(decideOrderGate(facts())).toEqual({ pass: true, reason: `comprobaciones en verde sobre ${HEAD.slice(0, 7)}`, action: null });
  });

  test('mode tester is not decided here', () => {
    expect(decideOrderGate(facts({ mode: 'tester', run: null }))).toMatchObject({ pass: true, action: null });
  });

  test('no run yet, a run of another sha or a cancelled one asks the hub to run the checks', () => {
    for (const run of [null, { sha: OLD, status: 'passed' as const, failed: null }, { sha: HEAD, status: 'cancelled' as const, failed: null }]) {
      const decision = decideOrderGate(facts({ run }));
      expect(decision).toMatchObject({ pass: false, action: 'run-checks' });
      expect(decision.reason).toContain('Hay cambios sin comprobar');
    }
    expect(decideOrderGate(facts({ run: { sha: OLD, status: 'passed', failed: null } })).reason).toContain(OLD.slice(0, 7));
  });

  test('changes nobody committed block and ask for a run, naming the files', () => {
    const decision = decideOrderGate(facts({ dirty: ['lib/a.dart', 'lib/b.dart'] }));
    expect(decision).toMatchObject({ pass: false, action: 'run-checks' });
    expect(decision.reason).toContain('lib/a.dart, lib/b.dart');
    const many = decideOrderGate(facts({ dirty: Array.from({ length: 9 }, (_, i) => `f${i}.txt`) }));
    expect(many.reason).toContain('(y 4 más)');
  });

  test('a run in progress on HEAD only asks to wait', () => {
    expect(decideOrderGate(facts({ run: { sha: HEAD, status: 'running', failed: null } }))).toMatchObject({ pass: false, action: null, reason: expect.stringContaining('Comprobaciones en marcha') });
  });

  test('a red names the check and the code, or the timeout', () => {
    const red = decideOrderGate(facts({ run: { sha: HEAD, status: 'failed', failed: { name: 'analyze', exitCode: 2, timedOut: false } } }));
    expect(red).toMatchObject({ pass: false, action: null });
    expect(red.reason).toContain('Rojo en analyze (código 2)');
    const slow = decideOrderGate(facts({ run: { sha: HEAD, status: 'failed', failed: { name: 'test', exitCode: null, timedOut: true } } }));
    expect(slow.reason).toContain('Rojo en test (se pasó del tiempo)');
    expect(decideOrderGate(facts({ run: { sha: HEAD, status: 'failed', failed: null } })).reason).toContain('una comprobación');
  });

  test('an unreadable HEAD blocks without running anything', () => {
    expect(decideOrderGate(facts({ head: null }))).toMatchObject({ pass: false, action: null });
  });

  test('a diff that touches the definition of the checks blocks even on green, until the user forces that HEAD', () => {
    const touched = ['package.json#scripts'];
    const blocked = decideOrderGate(facts({ touched }));
    expect(blocked).toMatchObject({ pass: false, action: null });
    expect(blocked.reason).toContain('package.json#scripts');
    expect(blocked.reason).toContain('cambia cómo se comprueba');
    expect(decideOrderGate(facts({ touched, forcedSha: OLD })).pass).toBe(false);
    expect(decideOrderGate(facts({ touched, forcedSha: HEAD })).pass).toBe(true);
    expect(decideOrderGate(facts({ touched, forcedSha: HEAD, run: { sha: HEAD, status: 'failed', failed: { name: 'test', exitCode: 1, timedOut: false } } })).pass).toBe(false);
  });

  test('checks+tester needs both', () => {
    const tester = { pass: false, reason: 'Falta tester' };
    expect(decideOrderGate(facts({ mode: 'checks+tester', tester }))).toMatchObject({ pass: false, reason: 'Falta tester', action: null });
    expect(decideOrderGate(facts({ mode: 'checks+tester', tester: { pass: true, reason: 'ok' } })).pass).toBe(true);
    expect(decideOrderGate(facts({ mode: 'checks', tester })).pass).toBe(true);
    const unchecked = decideOrderGate(facts({ mode: 'checks+tester', tester: { pass: true, reason: 'ok' }, run: null }));
    expect(unchecked).toMatchObject({ pass: false, action: 'run-checks' });
  });

  test('a floor with no checks passes in checks mode and defers to the tester in checks+tester', () => {
    expect(decideOrderGate(facts({ hasChecks: false, run: null }))).toMatchObject({ pass: true });
    expect(decideOrderGate(facts({ hasChecks: false, run: null, mode: 'checks+tester', tester: { pass: false, reason: 'Falta tester' } }))).toMatchObject({ pass: false, reason: 'Falta tester' });
  });

  test('the files a checkpoint left out stop counting as changes while they stay as they were', () => {
    const skipped = [{ path: 'debug.log', size: 10, mtime: 5 }];
    const stat = (size: number, mtime: number) => () => ({ size, mtime });
    expect(remainingDirty(['debug.log', 'lib/a.dart'], skipped, stat(10, 5))).toEqual(['lib/a.dart']);
    expect(remainingDirty(['debug.log'], skipped, stat(11, 5))).toEqual(['debug.log']);
    expect(remainingDirty(['debug.log'], skipped, stat(10, 6))).toEqual(['debug.log']);
    expect(remainingDirty(['debug.log'], skipped, () => null)).toEqual(['debug.log']);
    expect(remainingDirty(['lib/a.dart'], [], () => null)).toEqual(['lib/a.dart']);
    const gate = (dirty: string[]) => decideOrderGate(facts({ dirty }));
    expect(gate(remainingDirty(['debug.log'], skipped, stat(10, 5))).pass).toBe(true);
    expect(gate(remainingDirty(['debug.log'], skipped, stat(99, 5))).pass).toBe(false);
  });
});

describe('checksTouched', () => {
  const scripts = (value: Record<string, string>, extra: Record<string, unknown> = {}) => JSON.stringify({ name: 'x', scripts: value, ...extra });
  const NODE = ['tsconfig*.json', 'vitest.config.*', 'eslint.config.*', '.eslintrc*', 'package.json#scripts'];

  function files(base: Record<string, string>, head: Record<string, string>) {
    return (path: string, side: 'base' | 'head') => (side === 'base' ? base : head)[path] ?? null;
  }

  test('scripts changed counts, any other key of package.json does not', () => {
    const base = { 'package.json': scripts({ test: 'vitest run' }, { version: '1.0.0' }) };
    expect(checksTouched(['package.json'], NODE, files(base, { 'package.json': scripts({ test: 'true' }, { version: '1.0.0' }) }))).toEqual(['package.json#scripts']);
    expect(checksTouched(['package.json'], NODE, files(base, { 'package.json': scripts({ test: 'vitest run' }, { version: '2.0.0', dependencies: { a: '1' } }) }))).toEqual([]);
    expect(checksTouched(['package.json'], NODE, files(base, { 'package.json': scripts({ test: 'vitest run', lint: 'eslint .' }) }))).toEqual(['package.json#scripts']);
  });

  test('reordering the scripts is not a change', () => {
    const base = { 'package.json': scripts({ test: 'a', lint: 'b' }) };
    expect(checksTouched(['package.json'], NODE, files(base, { 'package.json': scripts({ lint: 'b', test: 'a' }) }))).toEqual([]);
  });

  test('a new package.json with scripts counts, one without scripts does not, a broken one is touched', () => {
    expect(checksTouched(['package.json'], NODE, files({}, { 'package.json': scripts({ test: 'x' }) }))).toEqual(['package.json#scripts']);
    expect(checksTouched(['package.json'], NODE, files({}, { 'package.json': JSON.stringify({ name: 'x' }) }))).toEqual([]);
    expect(checksTouched(['package.json'], NODE, files({ 'package.json': scripts({ test: 'x' }) }, {}))).toEqual(['package.json#scripts']);
    expect(checksTouched(['package.json'], NODE, files({ 'package.json': scripts({ test: 'x' }) }, { 'package.json': '{ roto' }))).toEqual(['package.json#scripts']);
  });

  test('composer.json#scripts reads both versions the same way', () => {
    const patterns = ['composer.json#scripts'];
    const composer = (value: Record<string, unknown>) => JSON.stringify({ scripts: value, require: {} });
    expect(checksTouched(['composer.json'], patterns, files({ 'composer.json': composer({ test: 'pest' }) }, { 'composer.json': composer({ test: 'true' }) }))).toEqual(['composer.json#scripts']);
    expect(checksTouched(['composer.json'], patterns, files({ 'composer.json': composer({ test: 'pest' }) }, { 'composer.json': JSON.stringify({ scripts: { test: 'pest' }, require: { php: '8' } }) }))).toEqual([]);
  });

  test('config files by glob, at any depth', () => {
    const none = files({}, {});
    expect(checksTouched(['tsconfig.json', 'packages/a/tsconfig.build.json', 'vitest.config.ts', '.eslintrc.cjs', 'src/index.ts'], NODE, none)).toEqual([
      '.eslintrc.cjs',
      'packages/a/tsconfig.build.json',
      'tsconfig.json',
      'vitest.config.ts',
    ]);
    expect(checksTouched(['src/a.ts', 'README.md'], NODE, none)).toEqual([]);
  });

  test('lockfiles and pubspec.yaml never count, even when a pattern names them', () => {
    const none = files({}, {});
    const lock = ['bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock', 'pubspec.lock', 'pubspec.yaml', 'app/pubspec.yaml'];
    expect(checksTouched(lock, ['*', '*.yaml', '*.lock', 'package-lock.json#scripts'], none)).toEqual([]);
  });

  test('the patterns of the floor are added to the ones of the stack', () => {
    expect(checksTouched(['build.yaml', 'lib/a.dart'], ['analysis_options.yaml', 'build.yaml'], files({}, {}))).toEqual(['build.yaml']);
    expect(checksTouched(['analysis_options.yaml'], ['analysis_options.yaml', 'dart_test.yaml'], files({}, {}))).toEqual(['analysis_options.yaml']);
  });
});
