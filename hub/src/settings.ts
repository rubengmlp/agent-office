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
import type { OfficeConfig, SettingsResult, SettingsView } from './types';

export const SETTINGS_NOTE =
  'Guardado. Los agentes y los lanzadores se han regenerado: los cambios valen para las sesiones y los equipos nuevos. Las sesiones abiertas siguen con su configuración hasta que las reinicies (bun run office).';

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

export function applySettings(config: OfficeConfig, raw: unknown): { config: OfficeConfig; changed: boolean } | { error: string } {
  const update = record(raw);
  const next = structuredClone(config);
  const errors: string[] = [];
  const roles = record(update.roles);
  for (const [id, value] of Object.entries(roles)) {
    if (!(ROLE_IDS as readonly string[]).includes(id)) {
      errors.push(`Rol desconocido: ${id}`);
      continue;
    }
    const r = record(value);
    const role = next.roles[id as keyof OfficeConfig['roles']];
    if (r.model !== undefined) {
      if (validModel(r.model)) role.model = r.model;
      else errors.push(`Modelo no válido para ${id}: usa un alias (opus, sonnet, haiku, fable, inherit) o un id completo.`);
    }
    if (r.effort !== undefined) {
      if (validEffort(r.effort)) role.effort = r.effort;
      else errors.push(`Esfuerzo no válido para ${id}: low, medium, high, xhigh o max.`);
    }
  }
  const departments = record(update.departments);
  for (const key of ['redaccion', 'mantenimiento'] as const) {
    const value = departments[key];
    if (value === undefined) continue;
    if (typeof value === 'boolean') next.departments[key] = value;
    else errors.push(`departments.${key} tiene que ser verdadero o falso.`);
  }
  const review = record(update.review);
  if (review.maxRounds !== undefined) {
    if (validInt(review.maxRounds, LIMITS.maxRounds)) next.review.maxRounds = review.maxRounds;
    else errors.push(`maxRounds va de ${LIMITS.maxRounds.min} a ${LIMITS.maxRounds.max}.`);
  }
  const memory = record(update.memory);
  for (const key of ['maxLessons', 'maxLessonsPerSession', 'maxContextChars'] as const) {
    const value = memory[key];
    if (value === undefined) continue;
    if (validInt(value, LIMITS[key])) next.memory[key] = value;
    else errors.push(`${key} va de ${LIMITS[key].min} a ${LIMITS[key].max}.`);
  }
  const floors = record(update.floors);
  for (const [slug, value] of Object.entries(floors)) {
    const floor = next.floors[slug];
    if (!floor) {
      errors.push(`No hay ninguna planta "${slug}".`);
      continue;
    }
    const branch = record(value).baseBranch;
    if (branch === undefined) continue;
    if (validBranch(branch)) floor.baseBranch = branch;
    else errors.push(`"${String(branch)}" no vale como rama base de ${slug}.`);
  }
  const modes = record(update.permissionModes);
  const allowedTargets = new Set(['direccion', 'redaccion', 'mantenimiento', ...Object.keys(next.floors)]);
  for (const [slug, mode] of Object.entries(modes)) {
    if (!allowedTargets.has(slug)) {
      errors.push(`No hay ninguna sesión de la oficina para "${slug}".`);
      continue;
    }
    if (validPermissionMode(mode)) next.permissionModes[slug] = mode;
    else errors.push(`Modo de permisos no válido para ${slug}: auto, manual, acceptEdits, plan o dontAsk.`);
  }
  if (errors.length > 0) return { error: errors.join(' ') };
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
      if (!applied.changed) return { ok: true, regenerated: 0, note: 'No había cambios que guardar.' };
      const config = applied.config;
      const wantsDocs = config.departments.redaccion || config.departments.mantenimiento;
      if (wantsDocs) ensureDocsRepo(docsRepoPath(config));
      saveConfig(p, config);
      const result = regenerateAgents(p, profiles());
      const failed = result.floors.filter((f) => f.error);
      onSaved(config);
      const warning = failed.length > 0 ? ` No se pudieron regenerar: ${failed.map((f) => `${f.slug} (${f.error})`).join(', ')}.` : '';
      return { ok: true, regenerated: result.files, note: `${SETTINGS_NOTE}${warning}` };
    },
  };
}
