import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CheckpointDesk, type CheckpointDeskOpts } from '../src/checkpoints';
import { ChecksDesk, type ChecksDeskOpts } from '../src/checks';
import { PROFILES_DIR, defaultConfig } from '../src/config';
import { openDb } from '../src/db';
import { runGit } from '../src/git';
import { OfficeBus } from '../src/office-bus';
import { OrderStore, type OrderRow } from '../src/order-store';
import { loadProfiles } from '../src/profiles';
import type { ActivityView, OfficeConfig, ServerMessage } from '../src/types';
import { git, originAndClone, tempDir, useGitIdentity } from './helpers';

useGitIdentity();

export type DeskRig = {
  root: string;
  repo: string;
  config: OfficeConfig;
  store: OrderStore;
  checkpoints: CheckpointDesk;
  checks: ChecksDesk;
  order: OrderRow;
  path: string;
  clock: { now: number };
  activity: ActivityView[];
  messages: ServerMessage[];
  notified: { slug: string; text: string }[];
  cleanup: () => void;
  second: () => OrderRow;
};

export function deskRig(options: { checks?: ChecksDeskOpts['shell']; configure?: (config: OfficeConfig) => void; listoDelayMs?: number; checkpoints?: Partial<CheckpointDeskOpts> } = {}): DeskRig {
  const { dir, cleanup } = tempDir();
  const { repo } = originAndClone(dir);
  const config = defaultConfig();
  config.floors.mobile = { path: repo, stack: 'generic', managed: true, baseBranch: 'develop', checks: [{ name: 'test', command: 'true' }] };
  options.configure?.(config);
  const db = openDb(':memory:');
  const store = new OrderStore(db);
  const bus = new OfficeBus(() => {});
  const activity: ActivityView[] = [];
  const messages: ServerMessage[] = [];
  bus.subscribe((msg) => {
    messages.push(msg);
    if (msg.type === 'activity') activity.push(msg.data);
  });
  const clock = { now: 1_800_000_000_000 };
  const notified: { slug: string; text: string }[] = [];
  const checkpoints = new CheckpointDesk({ db, store, git: runGit, now: () => clock.now, bus, config: () => config, ...options.checkpoints });
  const checks = new ChecksDesk({
    db,
    store,
    git: runGit,
    now: () => clock.now,
    bus,
    config: () => config,
    profiles: () => loadProfiles(PROFILES_DIR),
    checkpoints,
    shell: options.checks,
    notify: (order, text) => notified.push({ slug: order.slug, text }),
    changed: () => {},
    listoDelayMs: options.listoDelayMs ?? 0,
  });
  const make = (slug: string): OrderRow => {
    const path = join(repo, '.claude', 'worktrees', `office-${slug}`);
    mkdirSync(join(repo, '.claude', 'worktrees'), { recursive: true });
    const base = git(repo, 'rev-parse', 'origin/develop');
    git(repo, 'worktree', 'add', '-q', '-b', `encargo/${slug}`, path, base);
    const row = store.insert({ slug, floor: 'mobile', title: 'Login', source: 'director', now: clock.now });
    return store.update(row.id, {
      status: 'en-curso',
      branch: `encargo/${slug}`,
      base_ref: 'origin/develop',
      base_sha: base,
      worktree_path: path,
      worktree_state: 'listo',
    }) as OrderRow;
  };
  const order = make('login-a1b2');
  return {
    root: dir,
    repo,
    config,
    store,
    checkpoints,
    checks,
    order,
    path: order.worktree_path as string,
    clock,
    activity,
    messages,
    notified,
    cleanup: () => {
      checks.stop();
      cleanup();
    },
    second: () => make('otro-c3d4'),
  };
}
