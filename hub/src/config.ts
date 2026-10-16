import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  CheckSpec,
  CheckpointsConfig,
  ChecksConfig,
  DepartmentsConfig,
  Effort,
  FloorConfig,
  FloorRoles,
  GateMode,
  LimitsConfig,
  MemoryConfig,
  OfficeConfig,
  PermissionMode,
  ReviewConfig,
  ReviewMode,
  RoleId,
  RoleSettings,
  Stack,
  WorktreesConfig,
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
  headers: string;
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
    headers: join(home, 'headers'),
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
  redactor: { model: 'opus', effort: 'high' },
  'revisor-planes': { model: 'sonnet', effort: 'medium' },
  artesano: { model: 'sonnet', effort: 'medium' },
  'revisor-skills': { model: 'opus', effort: 'high' },
};

export const TARGET_ROLES: Record<'managed' | 'redaccion' | 'mantenimiento', readonly RoleId[]> = {
  managed: ['lead', 'dev', 'tester'],
  redaccion: ['lead', 'redactor', 'revisor-planes'],
  mantenimiento: ['lead', 'artesano', 'revisor-skills'],
};

export const DEFAULT_BASE_BRANCH = 'develop';

export const CONFIG_VERSION = 4;

export const PERMISSION_MODES: readonly PermissionMode[] = ['auto', 'manual', 'acceptEdits', 'plan', 'dontAsk'];

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'auto';

export const LIMITS = {
  maxRounds: { min: 1, max: 10 },
  maxPlanBytes: { min: 0, max: 200000 },
  maxReviewerReads: { min: 0, max: 500 },
  maxLessons: { min: 1, max: 200 },
  maxLessonsPerSession: { min: 0, max: 20 },
  maxContextChars: { min: 500, max: 20000 },
  leaveAfterMinutes: { min: 1, max: 60 },
  maxBriefsPerOrder: { min: 0, max: 20 },
  stalledAfterMinutes: { min: 0, max: 240 },
  checksTimeoutMinutes: { min: 1, max: 120 },
  checksMaxParallel: { min: 1, max: 8 },
  checksTailBytes: { min: 1000, max: 64000 },
  worktreeRetentionDays: { min: 1, max: 90 },
  worktreeMaxActive: { min: 1, max: 20 },
  worktreeWarnGb: { min: 1, max: 1000 },
  checkpointMaxFileKb: { min: 1, max: 102400 },
  reviewLargeLines: { min: 10, max: 5000 },
} as const;

export const GATE_MODES: readonly GateMode[] = ['checks', 'checks+tester', 'tester'];
export const REVIEW_MODES: readonly ReviewMode[] = ['always', 'large', 'off'];
export const MAX_CHECKS = 8;
export const MAX_CHECK_COMMAND = 300;
export const MAX_LINK_DIRS = 8;
export const MAX_CHECK_FILES = 20;
export const DEFAULT_REVIEW_LARGE_LINES = 300;
export const DEFAULT_SKIP_GLOBS: readonly string[] = ['*.log', '*.dump', '*.sqlite', '*.sqlite3', 'Screenshot*', 'Screen Shot*', 'Captura de pantalla*'];

export const DEFAULT_CONFIG: OfficeConfig = {
  configVersion: CONFIG_VERSION,
  floors: {},
  roles: DEFAULT_ROLES,
  floorRoles: {},
  docsRepo: '~/Projects/office-docs',
  departments: { redaccion: true, mantenimiento: true },
  review: { maxRounds: 2, maxPlanBytes: 20000, maxReviewerReads: 30 },
  memory: { maxLessons: 30, maxLessonsPerSession: 3, maxContextChars: 2500 },
  limits: { maxBriefsPerOrder: 3, stalledAfterMinutes: 10 },
  permissionModes: {},
  checksConfig: { timeoutMinutes: 15, maxParallel: 2, tailBytes: 8000 },
  worktrees: { retentionDays: 3, maxActivePerFloor: 4, warnTotalGb: 20 },
  checkpoints: { maxFileKb: 1024, skipGlobs: [...DEFAULT_SKIP_GLOBS] },
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

export function validCheckName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9-]{1,20}$/.test(value);
}

// The checks of a floor as the panel writes them: at most MAX_CHECKS, each with its own name and one command.
export function validChecks(value: unknown): CheckSpec[] | null {
  if (!Array.isArray(value) || value.length > MAX_CHECKS) return null;
  const checks: CheckSpec[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const { name, command } = item as Record<string, unknown>;
    if (!validCheckName(name) || names.has(name)) return null;
    if (typeof command !== 'string' || command.trim() === '' || command.length > MAX_CHECK_COMMAND || /[\0\r\n]/.test(command)) return null;
    names.add(name);
    checks.push({ name, command: command.trim() });
  }
  return checks;
}

export function validSetup(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim() !== '' && value.length <= MAX_CHECK_COMMAND && !/[\0\r\n]/.test(value));
}

export function validLinkDirs(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_LINK_DIRS) return null;
  const dirs: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !/^[A-Za-z0-9._][A-Za-z0-9._/-]{0,99}$/.test(item) || item.split('/').includes('..') || item.endsWith('/')) return null;
    dirs.push(item);
  }
  return dirs;
}

export function validCheckFiles(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_CHECK_FILES) return null;
  const files: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '' || item.length > 120 || item.startsWith('/') || item.includes('..') || /[\0\r\n]/.test(item)) return null;
    files.push(item.trim());
  }
  return files;
}

export function validGlobs(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 40) return null;
  const globs: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '' || item.length > 120 || /[\0\r\n]/.test(item)) return null;
    globs.push(item.trim());
  }
  return globs;
}

export function validGateMode(value: unknown): value is GateMode {
  return typeof value === 'string' && (GATE_MODES as readonly string[]).includes(value);
}

export function validReviewMode(value: unknown): value is ReviewMode {
  return typeof value === 'string' && (REVIEW_MODES as readonly string[]).includes(value);
}

function normalizeFloors(raw: unknown): Record<string, FloorConfig> {
  const floors: Record<string, FloorConfig> = {};
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const [slug, value] of Object.entries(src)) {
    if (!value || typeof value !== 'object') continue;
    const f = value as Record<string, unknown>;
    if (typeof f.path !== 'string' || !f.path) continue;
    const floor: FloorConfig = {
      path: f.path,
      stack: STACKS.includes(f.stack as Stack) ? (f.stack as Stack) : 'generic',
      managed: f.managed !== false,
      baseBranch: validBranch(f.baseBranch) ? f.baseBranch : DEFAULT_BASE_BRANCH,
    };
    const checks = f.checks === undefined ? null : validChecks(f.checks);
    if (checks) floor.checks = checks;
    if (f.setup !== undefined && validSetup(f.setup)) floor.setup = f.setup;
    const linkDirs = f.linkDirs === undefined ? null : validLinkDirs(f.linkDirs);
    if (linkDirs) floor.linkDirs = linkDirs;
    if (f.delivery === true) floor.delivery = true;
    if (validGateMode(f.gateMode)) floor.gateMode = f.gateMode;
    if (validReviewMode(f.review)) floor.review = f.review;
    if (validInt(f.reviewLargeLines, LIMITS.reviewLargeLines)) floor.reviewLargeLines = f.reviewLargeLines;
    const checkFiles = f.checkFiles === undefined ? null : validCheckFiles(f.checkFiles);
    if (checkFiles) floor.checkFiles = checkFiles;
    floors[slug] = floor;
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
  const limits = obj(src.limits);
  const checksConfig = obj(src.checksConfig);
  const worktrees = obj(src.worktrees);
  const checkpoints = obj(src.checkpoints);
  const d = DEFAULT_CONFIG;
  const normalizedDepartments: DepartmentsConfig = {
    redaccion: flag(departments.redaccion, d.departments.redaccion),
    mantenimiento: flag(departments.mantenimiento, d.departments.mantenimiento),
  };
  const normalizedReview: ReviewConfig = {
    maxRounds: int(review.maxRounds, LIMITS.maxRounds, d.review.maxRounds),
    maxPlanBytes: int(review.maxPlanBytes, LIMITS.maxPlanBytes, d.review.maxPlanBytes),
    maxReviewerReads: int(review.maxReviewerReads, LIMITS.maxReviewerReads, d.review.maxReviewerReads),
  };
  const normalizedMemory: MemoryConfig = {
    maxLessons: int(memory.maxLessons, LIMITS.maxLessons, d.memory.maxLessons),
    maxLessonsPerSession: int(memory.maxLessonsPerSession, LIMITS.maxLessonsPerSession, d.memory.maxLessonsPerSession),
    maxContextChars: int(memory.maxContextChars, LIMITS.maxContextChars, d.memory.maxContextChars),
  };
  const normalizedLimits: LimitsConfig = {
    maxBriefsPerOrder: int(limits.maxBriefsPerOrder, LIMITS.maxBriefsPerOrder, d.limits.maxBriefsPerOrder),
    stalledAfterMinutes: int(limits.stalledAfterMinutes, LIMITS.stalledAfterMinutes, d.limits.stalledAfterMinutes),
  };
  const normalizedChecks: ChecksConfig = {
    timeoutMinutes: int(checksConfig.timeoutMinutes, LIMITS.checksTimeoutMinutes, d.checksConfig.timeoutMinutes),
    maxParallel: int(checksConfig.maxParallel, LIMITS.checksMaxParallel, d.checksConfig.maxParallel),
    tailBytes: int(checksConfig.tailBytes, LIMITS.checksTailBytes, d.checksConfig.tailBytes),
  };
  const normalizedWorktrees: WorktreesConfig = {
    retentionDays: int(worktrees.retentionDays, LIMITS.worktreeRetentionDays, d.worktrees.retentionDays),
    maxActivePerFloor: int(worktrees.maxActivePerFloor, LIMITS.worktreeMaxActive, d.worktrees.maxActivePerFloor),
    warnTotalGb: int(worktrees.warnTotalGb, LIMITS.worktreeWarnGb, d.worktrees.warnTotalGb),
  };
  const normalizedCheckpoints: CheckpointsConfig = {
    maxFileKb: int(checkpoints.maxFileKb, LIMITS.checkpointMaxFileKb, d.checkpoints.maxFileKb),
    skipGlobs: validGlobs(checkpoints.skipGlobs) ?? [...d.checkpoints.skipGlobs],
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
    limits: normalizedLimits,
    permissionModes,
    checksConfig: normalizedChecks,
    worktrees: normalizedWorktrees,
    checkpoints: normalizedCheckpoints,
    blockedAfterMinutes: positive(src.blockedAfterMinutes, d.blockedAfterMinutes),
    leaveAfterMinutes: int(src.leaveAfterMinutes, LIMITS.leaveAfterMinutes, d.leaveAfterMinutes),
    retentionDays: positive(src.retentionDays, d.retentionDays),
    port: positive(src.port, d.port),
  };
}

export function migrateConfig(config: OfficeConfig): { config: OfficeConfig; changed: boolean } {
  if (config.configVersion >= CONFIG_VERSION) return { config, changed: false };
  const next = structuredClone(config);
  const isRole = (id: RoleId, model: string, effort: Effort) => next.roles[id].model === model && next.roles[id].effort === effort;
  if (config.configVersion < 2 && isRole('revisor-planes', 'sonnet', 'xhigh')) {
    next.roles['revisor-planes'] = { model: 'opus', effort: 'medium' };
  }
  if (config.configVersion < 3) {
    if (next.review.maxRounds === 4) next.review.maxRounds = DEFAULT_CONFIG.review.maxRounds;
    if (next.memory.maxContextChars === 4000) next.memory.maxContextChars = DEFAULT_CONFIG.memory.maxContextChars;
    if (isRole('revisor-planes', 'opus', 'medium')) next.roles['revisor-planes'] = { ...DEFAULT_ROLES['revisor-planes'] };
    if (isRole('redactor', 'fable', 'xhigh')) next.roles.redactor = { ...DEFAULT_ROLES.redactor };
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

export function writeHeaders(p: Paths, key: string): void {
  ensureHome(p);
  writeAtomic(p.headers, `X-Office-Key: ${key}\n`);
}

export function createKeyIfMissing(p: Paths): { key: string; created: boolean } {
  const existing = readKey(p);
  if (existing) {
    writeHeaders(p, existing);
    return { key: existing, created: false };
  }
  ensureHome(p);
  const key = randomBytes(32).toString('hex');
  writeAtomic(p.key, `${key}\n`);
  writeHeaders(p, key);
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
  writeHeaders(p, key);
  return key;
}

export function writePortFile(p: Paths, port: number): void {
  ensureHome(p);
  writeAtomic(p.port, `${port}\n`);
}
