import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type {
  DepartmentsConfig,
  Effort,
  FloorConfig,
  MemoryConfig,
  OfficeConfig,
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
  director: { model: 'opus', effort: 'high' },
  lead: { model: 'sonnet', effort: 'medium' },
  dev: { model: 'opus', effort: 'high' },
  tester: { model: 'sonnet', effort: 'medium' },
  reviewer: { model: 'opus', effort: 'high' },
  redactor: { model: 'opus', effort: 'high' },
  'revisor-planes': { model: 'sonnet', effort: 'xhigh' },
  artesano: { model: 'sonnet', effort: 'medium' },
  'revisor-skills': { model: 'opus', effort: 'high' },
};

export const DEFAULT_BASE_BRANCH = 'develop';

export const LIMITS = {
  maxRounds: { min: 1, max: 10 },
  maxLessons: { min: 1, max: 200 },
  maxLessonsPerSession: { min: 0, max: 20 },
  maxContextChars: { min: 500, max: 20000 },
} as const;

export const DEFAULT_CONFIG: OfficeConfig = {
  floors: {},
  roles: DEFAULT_ROLES,
  docsRepo: '~/Projects/office-docs',
  departments: { redaccion: true, mantenimiento: true },
  review: { maxRounds: 4 },
  memory: { maxLessons: 30, maxLessonsPerSession: 3, maxContextChars: 4000 },
  blockedAfterMinutes: 5,
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
  return {
    floors: normalizeFloors(src.floors),
    roles: normalizeRoles(src.roles),
    docsRepo: typeof src.docsRepo === 'string' && src.docsRepo.trim() ? src.docsRepo.trim() : d.docsRepo,
    departments: normalizedDepartments,
    review: normalizedReview,
    memory: normalizedMemory,
    blockedAfterMinutes: positive(src.blockedAfterMinutes, d.blockedAfterMinutes),
    retentionDays: positive(src.retentionDays, d.retentionDays),
    port: positive(src.port, d.port),
  };
}

export function loadConfig(p: Paths): OfficeConfig {
  if (!existsSync(p.config)) return defaultConfig();
  return normalizeConfig(JSON.parse(readFileSync(p.config, 'utf8')));
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
