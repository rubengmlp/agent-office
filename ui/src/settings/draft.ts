import type {
  DepartmentsConfig,
  Effort,
  MemoryConfig,
  PermissionMode,
  ReviewConfig,
  RoleId,
  RoleSettings,
  SettingsUpdate,
  SettingsView,
} from '../types';
import {
  BRANCH_PATTERN,
  DEPARTMENT_ROWS,
  MODEL_OPTIONS,
  MODEL_PATTERN,
  NUMBER_FIELDS,
  OTHER_MODEL,
  ROLE_ROWS,
  type NumberKey,
} from './options';

export type RoleDraft = { choice: string; custom: string; effort: Effort };

export type SettingsDraft = {
  roles: Record<RoleId, RoleDraft>;
  departments: DepartmentsConfig;
  numbers: Record<NumberKey, string>;
  branches: Record<string, string>;
  modes: Record<string, PermissionMode>;
};

export type Problems = Map<string, string>;

type ManagedFloor = SettingsView['floors'][number];

const FALLBACK_ROLE: RoleSettings = { model: 'inherit', effort: 'medium' };

const PRESETS: ReadonlySet<string> = new Set(
  MODEL_OPTIONS.map((option) => option.value).filter((value) => value !== OTHER_MODEL),
);

export function roleProblemKey(id: RoleId): string {
  return `role:${id}`;
}

export function branchProblemKey(slug: string): string {
  return `branch:${slug}`;
}

export function roleOf(view: SettingsView, id: RoleId): RoleSettings {
  const roles: Partial<Record<RoleId, RoleSettings>> = view.roles;
  return roles[id] ?? FALLBACK_ROLE;
}

export function managedFloors(view: SettingsView): ManagedFloor[] {
  return view.floors.filter((floor) => floor.managed);
}

function numbersOf(view: SettingsView): Record<NumberKey, number> {
  return {
    maxRounds: view.review.maxRounds,
    maxLessons: view.memory.maxLessons,
    maxLessonsPerSession: view.memory.maxLessonsPerSession,
    maxContextChars: view.memory.maxContextChars,
  };
}

function parseInteger(text: string): number | null {
  const value = text.trim();
  return /^\d+$/.test(value) ? Number(value) : null;
}

function validBranch(value: string): boolean {
  return (
    BRANCH_PATTERN.test(value) &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.endsWith('/') &&
    !value.endsWith('.lock')
  );
}

export function modelOf(role: RoleDraft): string {
  return role.choice === OTHER_MODEL ? role.custom.trim() : role.choice;
}

export function draftFrom(view: SettingsView): SettingsDraft {
  const roles = {} as Record<RoleId, RoleDraft>;
  for (const { id } of ROLE_ROWS) {
    const role = roleOf(view, id);
    const preset = PRESETS.has(role.model);
    roles[id] = { choice: preset ? role.model : OTHER_MODEL, custom: preset ? '' : role.model, effort: role.effort };
  }

  const values = numbersOf(view);
  const numbers = {} as Record<NumberKey, string>;
  for (const field of NUMBER_FIELDS) numbers[field.key] = String(values[field.key]);

  const branches: Record<string, string> = {};
  for (const floor of managedFloors(view)) branches[floor.slug] = floor.baseBranch;

  return { roles, departments: { ...view.departments }, numbers, branches, modes: { ...view.permissionModes } };
}

export function reconcileDraft(draft: SettingsDraft, view: SettingsView): SettingsDraft {
  const branches: Record<string, string> = {};
  for (const floor of managedFloors(view)) branches[floor.slug] = draft.branches[floor.slug] ?? floor.baseBranch;
  const modes: Record<string, PermissionMode> = {};
  for (const [slug, mode] of Object.entries(view.permissionModes)) modes[slug] = draft.modes[slug] ?? mode;
  return { ...draft, branches, modes };
}

export function sameDraft(a: SettingsDraft, b: SettingsDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function validateDraft(draft: SettingsDraft): Problems {
  const problems: Problems = new Map();

  for (const { id, label } of ROLE_ROWS) {
    const model = modelOf(draft.roles[id]);
    if (model === '') problems.set(roleProblemKey(id), `${label}: indica el id del modelo`);
    else if (!MODEL_PATTERN.test(model)) problems.set(roleProblemKey(id), `${label}: el id del modelo no es válido`);
  }

  for (const field of NUMBER_FIELDS) {
    const value = parseInteger(draft.numbers[field.key]);
    const valid = value !== null && value >= field.min && value <= field.max;
    if (!valid) problems.set(field.key, `${field.label}: entre ${field.min} y ${field.max}`);
  }

  for (const [slug, branch] of Object.entries(draft.branches)) {
    const value = branch.trim();
    if (value === '') problems.set(branchProblemKey(slug), `Rama base de ${slug}: indica la rama`);
    else if (!validBranch(value)) problems.set(branchProblemKey(slug), `Rama base de ${slug}: nombre de rama no válido`);
  }

  return problems;
}

export function diffDraft(baseline: SettingsView, draft: SettingsDraft): SettingsUpdate {
  const update: SettingsUpdate = {};

  const roles: Partial<Record<RoleId, Partial<RoleSettings>>> = {};
  for (const { id } of ROLE_ROWS) {
    const before = roleOf(baseline, id);
    const after = draft.roles[id];
    const model = modelOf(after);
    const change: Partial<RoleSettings> = {};
    if (model !== '' && model !== before.model) change.model = model;
    if (after.effort !== before.effort) change.effort = after.effort;
    if (Object.keys(change).length > 0) roles[id] = change;
  }
  if (Object.keys(roles).length > 0) update.roles = roles;

  const departments: Partial<DepartmentsConfig> = {};
  for (const { key } of DEPARTMENT_ROWS) {
    if (draft.departments[key] !== baseline.departments[key]) departments[key] = draft.departments[key];
  }
  if (Object.keys(departments).length > 0) update.departments = departments;

  const current = numbersOf(baseline);
  const changed: Partial<Record<NumberKey, number>> = {};
  for (const field of NUMBER_FIELDS) {
    const value = parseInteger(draft.numbers[field.key]);
    if (value !== null && value !== current[field.key]) changed[field.key] = value;
  }

  const review: Partial<ReviewConfig> = {};
  if (changed.maxRounds !== undefined) review.maxRounds = changed.maxRounds;
  if (Object.keys(review).length > 0) update.review = review;

  const memory: Partial<MemoryConfig> = {};
  if (changed.maxLessons !== undefined) memory.maxLessons = changed.maxLessons;
  if (changed.maxLessonsPerSession !== undefined) memory.maxLessonsPerSession = changed.maxLessonsPerSession;
  if (changed.maxContextChars !== undefined) memory.maxContextChars = changed.maxContextChars;
  if (Object.keys(memory).length > 0) update.memory = memory;

  const floors: Record<string, { baseBranch?: string }> = {};
  for (const floor of managedFloors(baseline)) {
    const branch = (draft.branches[floor.slug] ?? floor.baseBranch).trim();
    if (branch !== '' && branch !== floor.baseBranch) floors[floor.slug] = { baseBranch: branch };
  }
  if (Object.keys(floors).length > 0) update.floors = floors;

  const modes: Record<string, PermissionMode> = {};
  for (const [slug, mode] of Object.entries(draft.modes)) {
    if (baseline.permissionModes[slug] !== undefined && baseline.permissionModes[slug] !== mode) modes[slug] = mode;
  }
  if (Object.keys(modes).length > 0) update.permissionModes = modes;

  return update;
}

export function isEmptyUpdate(update: SettingsUpdate): boolean {
  return Object.keys(update).length === 0;
}

export function applyUpdate(view: SettingsView, update: SettingsUpdate): SettingsView {
  const roles = { ...view.roles };
  for (const { id } of ROLE_ROWS) {
    const change = update.roles?.[id];
    if (change) roles[id] = { ...roleOf(view, id), ...change };
  }
  return {
    ...view,
    roles,
    departments: { ...view.departments, ...update.departments },
    review: { ...view.review, ...update.review },
    memory: { ...view.memory, ...update.memory },
    permissionModes: { ...view.permissionModes, ...update.permissionModes },
    floors: view.floors.map((floor) => {
      const baseBranch = update.floors?.[floor.slug]?.baseBranch;
      return baseBranch === undefined ? floor : { ...floor, baseBranch };
    }),
  };
}
