import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FloorConfig, OfficeConfig, Stack } from './types';

export const REPO_ROOT = resolve(import.meta.dir, '..', '..');
export const PLUGIN_DIR = join(REPO_ROOT, 'plugin');
export const PROFILES_DIR = join(PLUGIN_DIR, 'profiles');
export const TEMPLATES_DIR = join(PLUGIN_DIR, 'templates');
export const WORKSPACE_DIR = join(REPO_ROOT, 'workspace');
export const PUBLIC_DIR = join(REPO_ROOT, 'hub', 'public');
export const RAW_FIXTURES_DIR = join(REPO_ROOT, 'hub', 'test', 'fixtures', 'raw');

export type Paths = {
  home: string;
  claudeHome: string;
  agentsDir: string;
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
    key: join(home, 'key'),
    config: join(home, 'config.json'),
    port: join(home, 'port'),
    db: join(home, 'office.db'),
    officeSh: join(home, 'office.sh'),
    sessionsDir: join(home, 'sessions'),
    directorFloors: join(home, 'director-floors.md'),
  };
}

export const DEFAULT_CONFIG: OfficeConfig = {
  floors: {},
  blockedAfterMinutes: 5,
  retentionDays: 14,
  port: 4747,
};

const STACKS: readonly Stack[] = ['flutter', 'laravel', 'node', 'generic'];

export function ensureHome(p: Paths): void {
  mkdirSync(p.home, { recursive: true, mode: 0o700 });
}

export function writeAtomic(file: string, content: string, mode = 0o600): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, file);
}

export function normalizeConfig(raw: unknown): OfficeConfig {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const floors: Record<string, FloorConfig> = {};
  const rawFloors = src.floors && typeof src.floors === 'object' ? (src.floors as Record<string, unknown>) : {};
  for (const [slug, value] of Object.entries(rawFloors)) {
    if (!value || typeof value !== 'object') continue;
    const f = value as Record<string, unknown>;
    if (typeof f.path !== 'string' || !f.path) continue;
    const stack = STACKS.includes(f.stack as Stack) ? (f.stack as Stack) : 'generic';
    floors[slug] = { path: f.path, stack, managed: f.managed !== false };
  }
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
  return {
    floors,
    blockedAfterMinutes: num(src.blockedAfterMinutes, DEFAULT_CONFIG.blockedAfterMinutes),
    retentionDays: num(src.retentionDays, DEFAULT_CONFIG.retentionDays),
    port: num(src.port, DEFAULT_CONFIG.port),
  };
}

export function loadConfig(p: Paths): OfficeConfig {
  if (!existsSync(p.config)) return structuredClone(DEFAULT_CONFIG);
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
