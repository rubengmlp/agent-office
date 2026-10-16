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

export type FloorRolesDraft = Record<string, Partial<Record<RoleId, RoleDraft | null>>>;

export type SettingsDraft = {
  roles: Record<RoleId, RoleDraft>;
  floorRoles: FloorRolesDraft;
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

export function floorRoleProblemKey(target: string, id: RoleId): string {
  return `floorRole:${target}:${id}`;
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
    leaveAfterMinutes: view.leaveAfterMinutes,
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

export function roleDraftOf(role: RoleSettings): RoleDraft {
  const preset = PRESETS.has(role.model);
  return { choice: preset ? role.model : OTHER_MODEL, custom: preset ? '' : role.model, effort: role.effort };
}

function floorRolesFrom(view: SettingsView, previous: FloorRolesDraft = {}): FloorRolesDraft {
  const floorRoles: FloorRolesDraft = {};
  for (const target of view.targets) {
    const rows: Partial<Record<RoleId, RoleDraft | null>> = {};
    for (const id of target.roles) {
      const kept = previous[target.id]?.[id];
      const override = view.floorRoles[target.id]?.[id];
      rows[id] = kept !== undefined ? kept : override ? roleDraftOf(override) : null;
    }
    floorRoles[target.id] = rows;
  }
  return floorRoles;
}

export function draftFrom(view: SettingsView): SettingsDraft {
  const roles = {} as Record<RoleId, RoleDraft>;
  for (const { id } of ROLE_ROWS) roles[id] = roleDraftOf(roleOf(view, id));

  const values = numbersOf(view);
  const numbers = {} as Record<NumberKey, string>;
  for (const field of NUMBER_FIELDS) numbers[field.key] = String(values[field.key]);

  const branches: Record<string, string> = {};
  for (const floor of managedFloors(view)) branches[floor.slug] = floor.baseBranch;

  return {
    roles,
    floorRoles: floorRolesFrom(view),
    departments: { ...view.departments },
    numbers,
    branches,
    modes: { ...view.permissionModes },
  };
}

export function reconcileDraft(draft: SettingsDraft, view: SettingsView): SettingsDraft {
  const branches: Record<string, string> = {};
  for (const floor of managedFloors(view)) branches[floor.slug] = draft.branches[floor.slug] ?? floor.baseBranch;
  const modes: Record<string, PermissionMode> = {};
  for (const [slug, mode] of Object.entries(view.permissionModes)) modes[slug] = draft.modes[slug] ?? mode;
  return { ...draft, floorRoles: floorRolesFrom(view, draft.floorRoles), branches, modes };
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

  for (const [target, rows] of Object.entries(draft.floorRoles)) {
    for (const { id, label } of ROLE_ROWS) {
      const role = rows[id];
      if (!role) continue;
      const model = modelOf(role);
      const key = floorRoleProblemKey(target, id);
      if (model === '') problems.set(key, `${label} en ${target}: indica el id del modelo`);
      else if (!MODEL_PATTERN.test(model)) problems.set(key, `${label} en ${target}: el id del modelo no es válido`);
    }
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

  const floorRoles: NonNullable<SettingsUpdate['floorRoles']> = {};
  for (const target of baseline.targets) {
    const changes: Partial<Record<RoleId, RoleSettings | null>> = {};
    for (const id of target.roles) {
      const before = baseline.floorRoles[target.id]?.[id] ?? null;
      const after = draft.floorRoles[target.id]?.[id] ?? null;
      if (after === null) {
        if (before !== null) changes[id] = null;
        continue;
      }
      const model = modelOf(after);
      if (model === '') continue;
      if (before === null || before.model !== model || before.effort !== after.effort) {
        changes[id] = { model, effort: after.effort };
      }
    }
    if (Object.keys(changes).length > 0) floorRoles[target.id] = changes;
  }
  if (Object.keys(floorRoles).length > 0) update.floorRoles = floorRoles;

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

  if (changed.leaveAfterMinutes !== undefined) update.leaveAfterMinutes = changed.leaveAfterMinutes;

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
  const floorRoles: SettingsView['floorRoles'] = {};
  for (const [target, rows] of Object.entries(view.floorRoles)) floorRoles[target] = { ...rows };
  for (const [target, changes] of Object.entries(update.floorRoles ?? {})) {
    const rows = { ...floorRoles[target] };
    for (const [id, change] of Object.entries(changes) as [RoleId, Partial<RoleSettings> | null | undefined][]) {
      if (change === undefined) continue;
      if (change === null) delete rows[id];
      else rows[id] = { ...(rows[id] ?? roleOf(view, id)), ...change };
    }
    if (Object.keys(rows).length > 0) floorRoles[target] = rows;
    else delete floorRoles[target];
  }
  return {
    ...view,
    roles,
    floorRoles,
    departments: { ...view.departments, ...update.departments },
    review: { ...view.review, ...update.review },
    memory: { ...view.memory, ...update.memory },
    permissionModes: { ...view.permissionModes, ...update.permissionModes },
    leaveAfterMinutes: update.leaveAfterMinutes ?? view.leaveAfterMinutes,
    floors: view.floors.map((floor) => {
      const baseBranch = update.floors?.[floor.slug]?.baseBranch;
      return baseBranch === undefined ? floor : { ...floor, baseBranch };
    }),
  };
}
