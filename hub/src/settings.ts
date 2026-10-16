import {
  LIMITS,
  ROLE_IDS,
  docsRepoPath,
  loadConfig,
  permissionModeFor,
  roleSettingsFor,
  saveConfig,
  targetRoles,
  validBranch,
  validEffort,
  validInt,
  validModel,
  validPermissionMode,
  type Paths,
} from './config';
import { ensureDocsRepo } from './docs-repo';
import { regenerateAgents } from './floor-cli';
import type { Profiles } from './profiles';
import { record } from './state-machine';
import type { HubText, OfficeConfig, RoleId, RoleSettings, SettingsResult, SettingsTarget, SettingsView } from './types';

export function permissionTargets(config: OfficeConfig): string[] {
  const targets = ['direccion'];
  if (config.departments.redaccion) targets.push('redaccion');
  if (config.departments.mantenimiento) targets.push('mantenimiento');
  for (const [slug, floor] of Object.entries(config.floors).sort(([a], [b]) => a.localeCompare(b))) {
    if (floor.managed) targets.push(slug);
  }
  return targets;
}

const TARGET_LABELS: Record<string, string> = { redaccion: 'Redacción', mantenimiento: 'Mantenimiento' };

function settingsTargets(config: OfficeConfig): SettingsTarget[] {
  return permissionTargets(config)
    .filter((id) => id !== 'direccion')
    .map((id) => ({
      id,
      label: TARGET_LABELS[id] ?? id,
      stack: config.floors[id]?.stack ?? null,
      roles: [...targetRoles(id)],
    }));
}

export function settingsView(config: OfficeConfig): SettingsView {
  const permissionModes: SettingsView['permissionModes'] = {};
  for (const slug of permissionTargets(config)) permissionModes[slug] = permissionModeFor(config, slug);
  return {
    roles: structuredClone(config.roles),
    floorRoles: structuredClone(config.floorRoles),
    targets: settingsTargets(config),
    departments: { ...config.departments },
    review: { ...config.review },
    memory: { ...config.memory },
    docsRepo: config.docsRepo,
    port: config.port,
    permissionModes,
    leaveAfterMinutes: config.leaveAfterMinutes,
    floors: Object.entries(config.floors)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([slug, f]) => ({ slug, path: f.path, stack: f.stack, managed: f.managed, baseBranch: f.baseBranch })),
  };
}

export function applySettings(config: OfficeConfig, raw: unknown): { config: OfficeConfig; changed: boolean } | { error: HubText[] } {
  const update = record(raw);
  const next = structuredClone(config);
  const errors: HubText[] = [];
  const roles = record(update.roles);
  for (const [id, value] of Object.entries(roles)) {
    if (!(ROLE_IDS as readonly string[]).includes(id)) {
      errors.push({ key: 'hub.settings.unknownRole', params: { id } });
      continue;
    }
    const r = record(value);
    const role = next.roles[id as keyof OfficeConfig['roles']];
    if (r.model !== undefined) {
      if (validModel(r.model)) role.model = r.model;
      else errors.push({ key: 'hub.settings.badModel', params: { id } });
    }
    if (r.effort !== undefined) {
      if (validEffort(r.effort)) role.effort = r.effort;
      else errors.push({ key: 'hub.settings.badEffort', params: { id } });
    }
  }
  const allowedTargets = new Set(['direccion', 'redaccion', 'mantenimiento', ...Object.keys(next.floors)]);
  for (const [target, value] of Object.entries(record(update.floorRoles))) {
    if (target === 'direccion' || !allowedTargets.has(target)) {
      errors.push({ key: 'hub.settings.noFloor', params: { slug: target } });
      continue;
    }
    for (const [id, change] of Object.entries(record(value))) {
      if (!(ROLE_IDS as readonly string[]).includes(id)) {
        errors.push({ key: 'hub.settings.unknownRole', params: { id } });
        continue;
      }
      if (!targetRoles(target).includes(id as RoleId)) {
        errors.push({ key: 'hub.settings.roleNotOnFloor', params: { id, slug: target } });
        continue;
      }
      const roleId = id as RoleId;
      if (change === null) {
        const overrides = next.floorRoles[target];
        if (overrides) {
          delete overrides[roleId];
          if (Object.keys(overrides).length === 0) delete next.floorRoles[target];
        }
        continue;
      }
      if (typeof change !== 'object' || Array.isArray(change)) {
        errors.push({ key: 'hub.settings.badFloorRole', params: { id, slug: target } });
        continue;
      }
      const r = record(change);
      const merged: RoleSettings = { ...roleSettingsFor(next, target, roleId) };
      let valid = true;
      if (r.model !== undefined) {
        if (validModel(r.model)) merged.model = r.model;
        else {
          valid = false;
          errors.push({ key: 'hub.settings.badFloorModel', params: { id, slug: target } });
        }
      }
      if (r.effort !== undefined) {
        if (validEffort(r.effort)) merged.effort = r.effort;
        else {
          valid = false;
          errors.push({ key: 'hub.settings.badFloorEffort', params: { id, slug: target } });
        }
      }
      if (valid && (r.model !== undefined || r.effort !== undefined)) {
        next.floorRoles[target] = { ...next.floorRoles[target], [roleId]: merged };
      }
    }
  }
  const departments = record(update.departments);
  for (const key of ['redaccion', 'mantenimiento'] as const) {
    const value = departments[key];
    if (value === undefined) continue;
    if (typeof value === 'boolean') next.departments[key] = value;
    else errors.push({ key: 'hub.settings.badDepartment', params: { key } });
  }
  const review = record(update.review);
  if (review.maxRounds !== undefined) {
    if (validInt(review.maxRounds, LIMITS.maxRounds)) next.review.maxRounds = review.maxRounds;
    else errors.push({ key: 'hub.settings.badRange', params: { key: 'maxRounds', min: LIMITS.maxRounds.min, max: LIMITS.maxRounds.max } });
  }
  const memory = record(update.memory);
  for (const key of ['maxLessons', 'maxLessonsPerSession', 'maxContextChars'] as const) {
    const value = memory[key];
    if (value === undefined) continue;
    if (validInt(value, LIMITS[key])) next.memory[key] = value;
    else errors.push({ key: 'hub.settings.badRange', params: { key, min: LIMITS[key].min, max: LIMITS[key].max } });
  }
  const floors = record(update.floors);
  for (const [slug, value] of Object.entries(floors)) {
    const floor = next.floors[slug];
    if (!floor) {
      errors.push({ key: 'hub.settings.noFloor', params: { slug } });
      continue;
    }
    const branch = record(value).baseBranch;
    if (branch === undefined) continue;
    if (validBranch(branch)) floor.baseBranch = branch;
    else errors.push({ key: 'hub.settings.badBranch', params: { branch: String(branch), slug } });
  }
  const modes = record(update.permissionModes);
  for (const [slug, mode] of Object.entries(modes)) {
    if (!allowedTargets.has(slug)) {
      errors.push({ key: 'hub.settings.noTarget', params: { slug } });
      continue;
    }
    if (validPermissionMode(mode)) next.permissionModes[slug] = mode;
    else errors.push({ key: 'hub.settings.badPermissionMode', params: { slug } });
  }
  if (update.leaveAfterMinutes !== undefined) {
    if (validInt(update.leaveAfterMinutes, LIMITS.leaveAfterMinutes)) next.leaveAfterMinutes = update.leaveAfterMinutes;
    else errors.push({ key: 'hub.settings.badRange', params: { key: 'leaveAfterMinutes', min: LIMITS.leaveAfterMinutes.min, max: LIMITS.leaveAfterMinutes.max } });
  }
  if (errors.length > 0) return { error: errors };
  return { config: next, changed: JSON.stringify(next) !== JSON.stringify(config) };
}

export type SettingsService = {
  view(): SettingsView;
  update(raw: unknown): SettingsResult;
};

export function createSettings(p: Paths, profiles: () => Profiles, onSaved: (config: OfficeConfig) => void): SettingsService {
  return {
    view: () => settingsView(loadConfig(p)),
    update: (raw) => {
      const current = loadConfig(p);
      const applied = applySettings(current, raw);
      if ('error' in applied) return { ok: false, error: applied.error };
      if (!applied.changed) return { ok: true, regenerated: 0, note: [{ key: 'hub.settings.noChanges' }] };
      const config = applied.config;
      const wantsDocs = config.departments.redaccion || config.departments.mantenimiento;
      if (wantsDocs) ensureDocsRepo(docsRepoPath(config));
      saveConfig(p, config);
      const result = regenerateAgents(p, profiles());
      const failed = result.floors.filter((f) => f.error);
      onSaved(config);
      const note: HubText[] = [
        { key: 'hub.settings.saved' },
        ...failed.map((f): HubText => ({ key: 'hub.settings.regenerateFailed', params: { slug: f.slug, error: f.text ?? f.error ?? '' } })),
      ];
      return { ok: true, regenerated: result.files, note };
    },
  };
}
