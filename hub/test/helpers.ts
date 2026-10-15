import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROFILES_DIR, paths, type Paths } from '../src/config';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/db';
import { memoryRegistry } from '../src/floors';
import { Office, type OfficeOptions } from '../src/office';
import { loadProfiles } from '../src/profiles';
import type { HookEvent, OfficeConfig, ServerMessage } from '../src/types';

export function tempDir(prefix = 'agent-office-test-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function fakePaths(root: string): Paths {
  const p = paths({ AGENT_OFFICE_HOME: join(root, 'office-home'), AGENT_OFFICE_CLAUDE_HOME: join(root, 'claude-home') });
  mkdirSync(p.home, { recursive: true });
  mkdirSync(p.claudeHome, { recursive: true });
  return p;
}

export function makeRepo(root: string, name: string, files: Record<string, string> = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content);
  return dir;
}

export function loadFixture(name: string, cwd: string): HookEvent[] {
  const raw = readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8').replaceAll('__CWD__', cwd);
  return JSON.parse(raw) as HookEvent[];
}

export type Harness = {
  office: Office;
  db: Database;
  messages: ServerMessage[];
  clock: { now: number; advance(ms: number): void };
  config: OfficeConfig;
  root: string;
  workspace: string;
  cleanup: () => void;
};

export function harness(overrides: Partial<OfficeOptions> & { floors?: OfficeConfig['floors'] } = {}): Harness {
  const { dir, cleanup } = tempDir();
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const config: OfficeConfig = { floors: overrides.floors ?? {}, blockedAfterMinutes: 5, retentionDays: 14, port: 4747 };
  const clock = {
    now: 1_800_000_000_000,
    advance(ms: number) {
      this.now += ms;
    },
  };
  const db = openDb(':memory:');
  const office = new Office({
    db,
    config,
    profiles: loadProfiles(PROFILES_DIR),
    workspaceDir: workspace,
    claudeHome: join(dir, 'claude-home'),
    registry: memoryRegistry(),
    gitRoot: (cwd) => cwd,
    stackOf: () => 'flutter',
    now: () => clock.now,
    ...overrides,
  });
  const messages: ServerMessage[] = [];
  office.subscribe((msg) => messages.push(msg));
  return { office, db, messages, clock, config, root: dir, workspace, cleanup };
}

export function ev(sessionId: string, cwd: string, hook: string, extra: Partial<HookEvent> = {}): HookEvent {
  return { session_id: sessionId, cwd, hook_event_name: hook, ...extra };
}
