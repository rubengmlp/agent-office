import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  DepartmentsConfig,
  Effort,
  FloorConfig,
  FloorRoles,
  MemoryConfig,
  OfficeConfig,
  PermissionMode,
  ReviewConfig,
  RoleId,
  RoleSettings,
  Stack,
} from './types';

export const REPO_ROOT = resolve(import.meta.dir, '..', '..');
export const PLUGIN_DIR = join(REPO_ROOT, 'plugin');
export const PROFILES_DIR = join(PLUGIN_DIR, 'profiles');
export const TEMPLATES_DIR = join(PLUGIN_DIR, 'templates');
export const SCRIPTS_DIR = join(PLUGIN_DIR, 'scripts');
export const WORKSPACE_DIR = join(REPO_ROOT, 'workspace');
export const PUBLIC_DIR = join(REPO_ROOT, 'hub', 'public');
export const RAW_FIXTURES_DIR = join(REPO_ROOT, 'hub', 'test', 'fixtures', 'raw');

export type Paths = {
  home: string;
  claudeHome: string;
  agentsDir: string;
  skillsDir: string;
  key: string;
  id: string;
  config: string;
  port: string;
  db: string;
  officeSh: string;
  sessionsDir: string;
  directorFloors: string;
};

export function paths(env: Record<string, string | undefined> = process.env): Paths {
  const home = env.AGENT_OFFICE_HOME ?? join(homedir(), '.config', 'agent-office');
  const claudeHome = env.AGENT_OFFICE_CLAUDE_HOME ?? join(homedir(), '.claude');
  return {
    home,
    claudeHome,
    agentsDir: join(claudeHome, 'agents'),
    skillsDir: join(claudeHome, 'skills'),
    key: join(home, 'key'),
    id: join(home, 'id'),
    config: join(home, 'config.json'),
    port: join(home, 'port'),
    db: join(home, 'office.db'),
    officeSh: join(home, 'office.sh'),
    sessionsDir: join(home, 'sessions'),
    directorFloors: join(home, 'director-floors.md'),
  };
}

export const STACKS: readonly Stack[] = ['flutter', 'laravel', 'node', 'generic'];

export const ROLE_IDS: readonly RoleId[] = [
  'director',
  'lead',
  'dev',
  'tester',
  'reviewer',
  'redactor',
  'revisor-planes',
  'artesano',
  'revisor-skills',
];

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const DEFAULT_ROLES: Record<RoleId, RoleSettings> = {
  director: { model: 'fable', effort: 'xhigh' },
  lead: { model: 'sonnet', effort: 'medium' },
  dev: { model: 'opus', effort: 'high' },
  tester: { model: 'sonnet', effort: 'medium' },
  reviewer: { model: 'opus', effort: 'high' },
  redactor: { model: 'fable', effort: 'xhigh' },
  'revisor-planes': { model: 'opus', effort: 'medium' },
  artesano: { model: 'sonnet', effort: 'medium' },
  'revisor-skills': { model: 'opus', effort: 'high' },
};

export const TARGET_ROLES: Record<'managed' | 'redaccion' | 'mantenimiento', readonly RoleId[]> = {
  managed: ['lead', 'dev', 'tester'],
  redaccion: ['lead', 'redactor', 'revisor-planes'],
  mantenimiento: ['lead', 'artesano', 'revisor-skills'],
};

export const DEFAULT_BASE_BRANCH = 'develop';

export const CONFIG_VERSION = 2;

export const PERMISSION_MODES: readonly PermissionMode[] = ['auto', 'manual', 'acceptEdits', 'plan', 'dontAsk'];

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'auto';

export const LIMITS = {
  maxRounds: { min: 1, max: 10 },
  maxLessons: { min: 1, max: 200 },
  maxLessonsPerSession: { min: 0, max: 20 },
  maxContextChars: { min: 500, max: 20000 },
  leaveAfterMinutes: { min: 1, max: 60 },
} as const;

export const DEFAULT_CONFIG: OfficeConfig = {
  configVersion: CONFIG_VERSION,
  floors: {},
  roles: DEFAULT_ROLES,
  floorRoles: {},
  docsRepo: '~/Projects/office-docs',
  departments: { redaccion: true, mantenimiento: true },
  review: { maxRounds: 4 },
  memory: { maxLessons: 30, maxLessonsPerSession: 3, maxContextChars: 4000 },
  permissionModes: {},
  blockedAfterMinutes: 5,
  leaveAfterMinutes: 5,
  retentionDays: 14,
  port: 4747,
};

export function defaultConfig(): OfficeConfig {
  return structuredClone(DEFAULT_CONFIG);
}

export function validModel(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,79}$/.test(value);
}

export function validEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value);
}

export function validBranch(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(value) &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.endsWith('/') &&
    !value.endsWith('.lock')
  );
}

export function validPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value);
}

export function permissionModeFor(config: OfficeConfig, slug: string): PermissionMode {
  return config.permissionModes[slug] ?? DEFAULT_PERMISSION_MODE;
}

export function targetRoles(target: string): readonly RoleId[] {
  return target === 'redaccion' || target === 'mantenimiento' ? TARGET_ROLES[target] : TARGET_ROLES.managed;
}

export function roleSettingsFor(config: OfficeConfig, target: string | null | undefined, roleId: RoleId): RoleSettings {
  return (target ? config.floorRoles[target]?.[roleId] : undefined) ?? config.roles[roleId];
}

export function validInt(value: unknown, limit: { min: number; max: number }): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= limit.min && value <= limit.max;
}

export function expandHome(path: string, home = homedir()): string {
  if (path === '~') return home;
  return path.startsWith('~/') ? join(home, path.slice(2)) : path;
}

export function docsRepoPath(config: OfficeConfig): string {
  return resolve(expandHome(config.docsRepo));
}

export function ensureHome(p: Paths): void {
  mkdirSync(p.home, { recursive: true, mode: 0o700 });
}

export function writeAtomic(file: string, content: string, mode = 0o600): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, file);
}

function normalizeRoles(raw: unknown): Record<RoleId, RoleSettings> {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const roles = structuredClone(DEFAULT_ROLES);
  for (const id of ROLE_IDS) {
    const value = src[id];
    if (!value || typeof value !== 'object') continue;
    const r = value as Record<string, unknown>;
    if (validModel(r.model)) roles[id].model = r.model;
    if (validEffort(r.effort)) roles[id].effort = r.effort;
  }
  return roles;
}

function normalizeFloorRoles(raw: unknown): FloorRoles {
  const floorRoles: FloorRoles = {};
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const [target, value] of Object.entries(src)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(target) || !value || typeof value !== 'object') continue;
    const roles: Partial<Record<RoleId, RoleSettings>> = {};
    for (const id of targetRoles(target)) {
      const r = (value as Record<string, unknown>)[id];
      if (!r || typeof r !== 'object') continue;
      const { model, effort } = r as Record<string, unknown>;
      if (validModel(model) && validEffort(effort)) roles[id] = { model, effort };
    }
    if (Object.keys(roles).length > 0) floorRoles[target] = roles;
  }
  return floorRoles;
}

function normalizeFloors(raw: unknown): Record<string, FloorConfig> {
  const floors: Record<string, FloorConfig> = {};
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const [slug, value] of Object.entries(src)) {
    if (!value || typeof value !== 'object') continue;
    const f = value as Record<string, unknown>;
    if (typeof f.path !== 'string' || !f.path) continue;
    floors[slug] = {
      path: f.path,
      stack: STACKS.includes(f.stack as Stack) ? (f.stack as Stack) : 'generic',
      managed: f.managed !== false,
      baseBranch: validBranch(f.baseBranch) ? f.baseBranch : DEFAULT_BASE_BRANCH,
    };
  }
  return floors;
}

export function normalizeConfig(raw: unknown): OfficeConfig {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const obj = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
  const positive = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);
  const int = (v: unknown, limit: { min: number; max: number }, fallback: number) => (validInt(v, limit) ? v : fallback);
  const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const departments = obj(src.departments);
  const review = obj(src.review);
  const memory = obj(src.memory);
  const d = DEFAULT_CONFIG;
  const normalizedDepartments: DepartmentsConfig = {
    redaccion: flag(departments.redaccion, d.departments.redaccion),
    mantenimiento: flag(departments.mantenimiento, d.departments.mantenimiento),
  };
  const normalizedReview: ReviewConfig = { maxRounds: int(review.maxRounds, LIMITS.maxRounds, d.review.maxRounds) };
  const normalizedMemory: MemoryConfig = {
    maxLessons: int(memory.maxLessons, LIMITS.maxLessons, d.memory.maxLessons),
    maxLessonsPerSession: int(memory.maxLessonsPerSession, LIMITS.maxLessonsPerSession, d.memory.maxLessonsPerSession),
    maxContextChars: int(memory.maxContextChars, LIMITS.maxContextChars, d.memory.maxContextChars),
  };
  const permissionModes: Record<string, PermissionMode> = {};
  for (const [slug, mode] of Object.entries(obj(src.permissionModes))) {
    if (/^[a-z0-9][a-z0-9-]*$/.test(slug) && validPermissionMode(mode)) permissionModes[slug] = mode;
  }
  return {
    configVersion: validInt(src.configVersion, { min: 1, max: 1000 }) ? src.configVersion : 1,
    floors: normalizeFloors(src.floors),
    roles: normalizeRoles(src.roles),
    floorRoles: normalizeFloorRoles(src.floorRoles),
    docsRepo: typeof src.docsRepo === 'string' && src.docsRepo.trim() ? src.docsRepo.trim() : d.docsRepo,
    departments: normalizedDepartments,
    review: normalizedReview,
    memory: normalizedMemory,
    permissionModes,
    blockedAfterMinutes: positive(src.blockedAfterMinutes, d.blockedAfterMinutes),
    leaveAfterMinutes: int(src.leaveAfterMinutes, LIMITS.leaveAfterMinutes, d.leaveAfterMinutes),
    retentionDays: positive(src.retentionDays, d.retentionDays),
    port: positive(src.port, d.port),
  };
}

export function migrateConfig(config: OfficeConfig): { config: OfficeConfig; changed: boolean } {
  if (config.configVersion >= CONFIG_VERSION) return { config, changed: false };
  const next = structuredClone(config);
  const reviewer = next.roles['revisor-planes'];
  if (config.configVersion < 2 && reviewer.model === 'sonnet' && reviewer.effort === 'xhigh') {
    next.roles['revisor-planes'] = { ...DEFAULT_ROLES['revisor-planes'] };
  }
  next.configVersion = CONFIG_VERSION;
  return { config: next, changed: true };
}

export function loadConfig(p: Paths): OfficeConfig {
  if (!existsSync(p.config)) return defaultConfig();
  const migrated = migrateConfig(normalizeConfig(JSON.parse(readFileSync(p.config, 'utf8'))));
  if (migrated.changed) saveConfig(p, migrated.config);
  return migrated.config;
}

export function saveConfig(p: Paths, config: OfficeConfig): void {
  ensureHome(p);
  writeAtomic(p.config, `${JSON.stringify(config, null, 2)}\n`);
}

export function readKey(p: Paths): string | null {
  try {
    const key = readFileSync(p.key, 'utf8').trim();
    return key || null;
  } catch {
    return null;
  }
}

export function createKeyIfMissing(p: Paths): { key: string; created: boolean } {
  const existing = readKey(p);
  if (existing) return { key: existing, created: false };
  ensureHome(p);
  const key = randomBytes(32).toString('hex');
  writeAtomic(p.key, `${key}\n`);
  return { key, created: true };
}

export function readId(p: Paths): string | null {
  try {
    const id = readFileSync(p.id, 'utf8').trim();
    return id || null;
  } catch {
    return null;
  }
}

// Not a secret: it only tells this hub's snapshots in redaccion/.fuentes from those of another hub.
export function createIdIfMissing(p: Paths): { id: string; created: boolean } {
  const existing = readId(p);
  if (existing) return { id: existing, created: false };
  ensureHome(p);
  const id = randomBytes(8).toString('hex');
  writeAtomic(p.id, `${id}\n`);
  return { id, created: true };
}

export function rotateKey(p: Paths): string {
  ensureHome(p);
  const key = randomBytes(32).toString('hex');
  writeAtomic(p.key, `${key}\n`);
  return key;
}

export function writePortFile(p: Paths, port: number): void {
  ensureHome(p);
  writeAtomic(p.port, `${port}\n`);
}
