import { describe, expect, test } from 'bun:test';
import { applyUpdate, diffDraft, draftFrom } from '../src/settings/draft';
import { automaticGate, deliverySwitchBody, draftOf, problemsOf, splitList, updateOf } from '../src/settings/floor-delivery-model';
import { groupWorktrees, overWarning, panelVisible, sizeText } from '../src/settings/worktrees-model';
import type { SettingsFloor, SettingsView, WorktreeView } from '../src/types';

Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => {} }, document: { documentElement: { lang: 'es' } } });

const floor = (over: Partial<SettingsFloor> = {}): SettingsFloor => ({
  slug: 'mobile',
  path: '/m',
  stack: 'flutter',
  managed: true,
  baseBranch: 'develop',
  checks: { mode: 'default', list: [{ name: 'analyze', command: 'flutter analyze' }, { name: 'test', command: 'flutter test' }] },
  setup: { mode: 'default', command: 'flutter pub get' },
  linkDirs: [],
  delivery: true,
  gateMode: null,
  effectiveGateMode: 'checks',
  checkFiles: [],
  profileCheckFiles: ['analysis_options.yaml'],
  ...over,
});

describe('the delivery switch of a floor', () => {
  test('is a body of its own and never part of the draft of the editor', () => {
    expect(deliverySwitchBody('mobile', true)).toEqual({ floors: { mobile: { delivery: true } } });
    expect(deliverySwitchBody('mobile', false)).toEqual({ floors: { mobile: { delivery: false } } });
    expect(updateOf(floor({ delivery: false }), draftOf(floor({ delivery: false })))).toBeNull();
  });

  test('the panel of folders shows when a floor delivers or folders are left over', () => {
    expect(panelVisible([{ delivery: false }, { delivery: false }], 0)).toBe(false);
    expect(panelVisible([], 0)).toBe(false);
    expect(panelVisible([{ delivery: false }, { delivery: true }], 0)).toBe(true);
    expect(panelVisible([{ delivery: false }], 2)).toBe(true);
  });
});

describe('the delivery draft of a floor', () => {
  test('starts equal to the floor and changes nothing', () => {
    expect(updateOf(floor(), draftOf(floor()))).toBeNull();
    expect(problemsOf(draftOf(floor())).size).toBe(0);
  });

  test('only what changed goes in the update', () => {
    const f = floor();
    const draft = draftOf(f);
    draft.checksMode = 'custom';
    draft.checks = [{ name: 'test', command: ' make test ' }];
    draft.setupMode = 'custom';
    draft.setup = 'make deps';
    draft.gateMode = 'checks+tester';
    draft.linkDirs = 'vendor, node_modules';
    draft.checkFiles = 'Makefile\nbuild.yaml';
    expect(updateOf(f, draft)).toEqual({
      checks: { mode: 'custom', list: [{ name: 'test', command: 'make test' }] },
      setup: { mode: 'custom', command: 'make deps' },
      gateMode: 'checks+tester',
      linkDirs: ['vendor', 'node_modules'],
      checkFiles: ['Makefile', 'build.yaml'],
    });
    const back = floor({ checks: { mode: 'custom', list: [{ name: 'test', command: 'make test' }] }, setup: { mode: 'custom', command: 'make deps' }, gateMode: 'tester', linkDirs: ['vendor'] });
    const undo = draftOf(back);
    undo.checksMode = 'default';
    undo.setupMode = 'none';
    undo.gateMode = '';
    undo.linkDirs = '';
    expect(updateOf(back, undo)).toEqual({ checks: { mode: 'default' }, setup: { mode: 'none' }, gateMode: null, linkDirs: [] });
  });

  test('the problems are the ones the hub refuses', () => {
    const draft = draftOf(floor());
    draft.checksMode = 'custom';
    draft.checks = [{ name: 'Mal Nombre', command: 'x' }];
    expect(problemsOf(draft)).toEqual(new Set(['checks']));
    draft.checks = [{ name: 'a', command: 'x' }, { name: 'a', command: 'y' }];
    expect(problemsOf(draft)).toEqual(new Set(['checks']));
    draft.checks = [{ name: 'a', command: '  ' }];
    expect(problemsOf(draft)).toEqual(new Set(['checks']));
    draft.checks = Array.from({ length: 9 }, (_, i) => ({ name: `c${i}`, command: 'x' }));
    expect(problemsOf(draft)).toEqual(new Set(['checks']));
    draft.checks = [{ name: 'a', command: 'x' }];
    draft.setupMode = 'custom';
    draft.setup = '';
    draft.linkDirs = '../fuera';
    draft.checkFiles = '/abs';
    expect(problemsOf(draft)).toEqual(new Set(['setup', 'linkDirs', 'checkFiles']));
    draft.checksMode = 'default';
    draft.checks = [];
    draft.setupMode = 'none';
    draft.linkDirs = 'a, b';
    draft.checkFiles = 'Makefile, package.json#scripts';
    expect(problemsOf(draft).size).toBe(0);
  });

  test('the automatic gate is the checks when there are some and the tester when there are none', () => {
    const defaults = [{ name: 'test', command: 'x' }];
    expect(automaticGate({ checksMode: 'default', checks: [] }, defaults)).toBe('checks');
    expect(automaticGate({ checksMode: 'default', checks: [] }, [])).toBe('tester');
    expect(automaticGate({ checksMode: 'custom', checks: [] }, defaults)).toBe('tester');
    expect(automaticGate({ checksMode: 'custom', checks: defaults }, [])).toBe('checks');
  });

  test('splitList takes commas and lines', () => {
    expect(splitList(' a, b\nc ,, ')).toEqual(['a', 'b', 'c']);
    expect(splitList('')).toEqual([]);
  });
});

describe('the numbers of the delivery cycle in the settings draft', () => {
  const view = {
    roles: {},
    floorRoles: {},
    targets: [],
    departments: { redaccion: true, mantenimiento: true },
    review: { maxRounds: 2, maxPlanBytes: 20000, maxReviewerReads: 30 },
    memory: { maxLessons: 30, maxLessonsPerSession: 3, maxContextChars: 2500 },
    limits: { maxBriefsPerOrder: 3, stalledAfterMinutes: 10 },
    docsRepo: '/d',
    port: 4747,
    permissionModes: {},
    leaveAfterMinutes: 5,
    checksConfig: { timeoutMinutes: 15, maxParallel: 2, tailBytes: 8000 },
    worktrees: { retentionDays: 3, maxActivePerFloor: 4, warnTotalGb: 20 },
    checkpoints: { maxFileKb: 1024, skipGlobs: ['*.log'] },
    floors: [floor()],
  } as unknown as SettingsView;

  test('they start from the view, produce nested updates and apply back', () => {
    const draft = draftFrom(view);
    expect(draft.numbers.checksTimeoutMinutes).toBe('15');
    expect(draft.numbers.worktreeWarnGb).toBe('20');
    expect(diffDraft(view, draft)).toEqual({});
    draft.numbers.checksTimeoutMinutes = '30';
    draft.numbers.checksMaxParallel = '4';
    draft.numbers.worktreeRetentionDays = '7';
    draft.numbers.worktreeMaxActive = '6';
    draft.numbers.checkpointMaxFileKb = '2048';
    const update = diffDraft(view, draft);
    expect(update).toEqual({ checksConfig: { timeoutMinutes: 30, maxParallel: 4 }, worktrees: { retentionDays: 7, maxActivePerFloor: 6 }, checkpoints: { maxFileKb: 2048 } });
    const applied = applyUpdate(view, update);
    expect(applied.checksConfig).toEqual({ timeoutMinutes: 30, maxParallel: 4, tailBytes: 8000 });
    expect(applied.worktrees).toEqual({ retentionDays: 7, maxActivePerFloor: 6, warnTotalGb: 20 });
    expect(applied.checkpoints).toEqual({ maxFileKb: 2048, skipGlobs: ['*.log'] });
  });
});

describe('the folders panel model', () => {
  const view = (over: Partial<WorktreeView>): WorktreeView => ({
    orderId: 1,
    slug: 'a',
    floor: 'mobile',
    title: 'A',
    branch: 'encargo/a',
    base: 'origin/develop',
    baseSha: 'abcdef1',
    path: '/p',
    state: 'listo',
    setupError: null,
    ahead: 0,
    behind: 0,
    sizeKb: 100,
    sizeAt: 1,
    lastActivity: 10,
    dirty: false,
    merged: false,
    orderStatus: 'en-curso',
    pending: false,
    kept: false,
    ...over,
  });

  test('grouped by floor with the ones to decide first and then the latest activity', () => {
    const groups = groupWorktrees([
      view({ orderId: 1, slug: 'viejo', lastActivity: 5 }),
      view({ orderId: 2, slug: 'nuevo', lastActivity: 50 }),
      view({ orderId: 3, slug: 'por-decidir', lastActivity: 1, pending: true }),
      view({ orderId: 4, slug: 'otra-planta', floor: 'backend', sizeKb: 400 }),
    ]);
    expect(groups.map((g) => g.floor)).toEqual(['backend', 'mobile']);
    expect(groups[1]?.worktrees.map((w) => w.slug)).toEqual(['por-decidir', 'nuevo', 'viejo']);
    expect(groups[1]).toMatchObject({ pending: 1, sizeKb: 300 });
    expect(groups[0]?.sizeKb).toBe(400);
  });

  test('sizes and the warning', () => {
    const dec = (value: number) => String(Math.round(value * 10) / 10);
    expect(sizeText(null, dec)).toBe('—');
    expect(sizeText(512, dec)).toBe('512 KB');
    expect(sizeText(2048, dec)).toBe('2 MB');
    expect(sizeText(3 * 1024 * 1024, dec)).toBe('3 GB');
    expect(overWarning(10, 5)).toBe(true);
    expect(overWarning(5, 5)).toBe(false);
    expect(overWarning(10, 0)).toBe(false);
  });
});
