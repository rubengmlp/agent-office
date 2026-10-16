import {
  LIMITS,
  ROLE_IDS,
  docsRepoPath,
  loadConfig,
  permissionModeFor,
  saveConfig,
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
import type { HubText, OfficeConfig, SettingsResult, SettingsView } from './types';

export function permissionTargets(config: OfficeConfig): string[] {
  const targets = ['direccion'];
  if (config.departments.redaccion) targets.push('redaccion');
  if (config.departments.mantenimiento) targets.push('mantenimiento');
  for (const [slug, floor] of Object.entries(config.floors).sort(([a], [b]) => a.localeCompare(b))) {
    if (floor.managed) targets.push(slug);
  }
  return targets;
}

export function settingsView(config: OfficeConfig): SettingsView {
  const permissionModes: SettingsView['permissionModes'] = {};
  for (const slug of permissionTargets(config)) permissionModes[slug] = permissionModeFor(config, slug);
  return {
    roles: structuredClone(config.roles),
    departments: { ...config.departments },
    review: { ...config.review },
    memory: { ...config.memory },
    docsRepo: config.docsRepo,
    port: config.port,
    permissionModes,
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
  const allowedTargets = new Set(['direccion', 'redaccion', 'mantenimiento', ...Object.keys(next.floors)]);
  for (const [slug, mode] of Object.entries(modes)) {
    if (!allowedTargets.has(slug)) {
      errors.push({ key: 'hub.settings.noTarget', params: { slug } });
      continue;
    }
    if (validPermissionMode(mode)) next.permissionModes[slug] = mode;
    else errors.push({ key: 'hub.settings.badPermissionMode', params: { slug } });
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
