import type { CheckSpec, GateMode, SettingsFloor, SettingsFloorUpdate } from '../types';

export const MAX_CHECKS = 8;
export const MAX_COMMAND = 300;
export const MAX_LINK_DIRS = 8;
export const MAX_CHECK_FILES = 20;
export const CHECK_NAME = /^[a-z0-9-]{1,20}$/;
const LINK_DIR = /^[A-Za-z0-9._][A-Za-z0-9._/-]{0,99}$/;

export type SetupMode = 'default' | 'none' | 'custom';

export type FloorDeliveryDraft = {
  checksMode: 'default' | 'custom';
  checks: CheckSpec[];
  setupMode: SetupMode;
  setup: string;
  gateMode: GateMode | '';
  linkDirs: string;
  checkFiles: string;
};

export type FloorDeliveryProblem = 'checks' | 'setup' | 'linkDirs' | 'checkFiles';

export function splitList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

export function draftOf(floor: SettingsFloor): FloorDeliveryDraft {
  return {
    checksMode: floor.checks.mode,
    checks: floor.checks.list.map((check) => ({ ...check })),
    setupMode: floor.setup.mode,
    setup: floor.setup.command ?? '',
    gateMode: floor.gateMode ?? '',
    linkDirs: floor.linkDirs.join(', '),
    checkFiles: floor.checkFiles.join(', '),
  };
}

// What stops the draft from being saved: the same rules the hub applies.
export function problemsOf(draft: FloorDeliveryDraft): Set<FloorDeliveryProblem> {
  const problems = new Set<FloorDeliveryProblem>();
  if (draft.checksMode === 'custom') {
    const names = new Set<string>();
    const ok =
      draft.checks.length <= MAX_CHECKS &&
      draft.checks.every((check) => {
        const fresh = CHECK_NAME.test(check.name) && !names.has(check.name);
        names.add(check.name);
        return fresh && check.command.trim() !== '' && check.command.length <= MAX_COMMAND && !/[\r\n\0]/.test(check.command);
      });
    if (!ok) problems.add('checks');
  }
  if (draft.setupMode === 'custom' && (draft.setup.trim() === '' || draft.setup.length > MAX_COMMAND || /[\r\n\0]/.test(draft.setup))) problems.add('setup');
  const dirs = splitList(draft.linkDirs);
  if (dirs.length > MAX_LINK_DIRS || dirs.some((dir) => !LINK_DIR.test(dir) || dir.split('/').includes('..') || dir.endsWith('/'))) problems.add('linkDirs');
  const files = splitList(draft.checkFiles);
  if (files.length > MAX_CHECK_FILES || files.some((file) => file.length > 120 || file.startsWith('/') || file.includes('..'))) problems.add('checkFiles');
  return problems;
}

function sameChecks(a: readonly CheckSpec[], b: readonly CheckSpec[]): boolean {
  return a.length === b.length && a.every((check, i) => check.name === b[i]?.name && check.command === b[i]?.command.trim());
}

// Only what changed, in the shape the hub takes; null when nothing did.
export function updateOf(floor: SettingsFloor, draft: FloorDeliveryDraft): SettingsFloorUpdate | null {
  const update: SettingsFloorUpdate = {};
  if (draft.checksMode !== floor.checks.mode || (draft.checksMode === 'custom' && !sameChecks(draft.checks, floor.checks.list))) {
    update.checks = draft.checksMode === 'default' ? { mode: 'default' } : { mode: 'custom', list: draft.checks.map((check) => ({ name: check.name, command: check.command.trim() })) };
  }
  if (draft.setupMode !== floor.setup.mode || (draft.setupMode === 'custom' && draft.setup.trim() !== (floor.setup.command ?? ''))) {
    update.setup = draft.setupMode === 'custom' ? { mode: 'custom', command: draft.setup.trim() } : { mode: draft.setupMode };
  }
  const gate = draft.gateMode === '' ? null : draft.gateMode;
  if (gate !== floor.gateMode) update.gateMode = gate;
  const dirs = splitList(draft.linkDirs);
  if (dirs.join('\0') !== floor.linkDirs.join('\0')) update.linkDirs = dirs;
  const files = splitList(draft.checkFiles);
  if (files.join('\0') !== floor.checkFiles.join('\0')) update.checkFiles = files;
  return Object.keys(update).length > 0 ? update : null;
}

// What the floor does with the gate when the user leaves it on automatic.
export function automaticGate(draft: Pick<FloorDeliveryDraft, 'checksMode' | 'checks'>, defaults: readonly CheckSpec[]): GateMode {
  const list = draft.checksMode === 'default' ? defaults : draft.checks;
  return list.length > 0 ? 'checks' : 'tester';
}

// The body that turns the folders and checks per order of one floor on or off.
export function deliverySwitchBody(slug: string, on: boolean): { floors: Record<string, SettingsFloorUpdate> } {
  return { floors: { [slug]: { delivery: on } } };
}
