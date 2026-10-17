import type { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from './db';
import type { deliver } from './courier';
import { isInside, memoryRegistry, realPath, type FloorRegistry, type GitRootFn } from './floors';
import type { GitRunner } from './git';
import { Office } from './office';
import type { TmuxFn } from './office-state';
import type { Profiles } from './profiles';
import type { HookEvent, HookMeta, OfficeConfig, Recording, ServerMessage, Stack } from './types';

// More events than this are not replayed: the recording would be too large to hold and to send.
export const MAX_REPLAY_EVENTS = 20_000;
// The simulated office ticks like the live one (main.ts TICK_MS).
export const REPLAY_TICK_MS = 5000;
// With compress, a silence longer than GAP_MS between two messages lasts SKIP_MS in the recording.
export const GAP_MS = 60_000;
export const SKIP_MS = 5000;
const YIELD_EVERY = 500;

export type ReplayDeps = {
  config: OfficeConfig;
  profiles: Profiles;
  workspaceDir: string;
  hubId: string;
  // The floors the hub already knows; read, never written.
  registry?: FloorRegistry;
  // Doubles for what a replay must never do: tests pass spies, the hub passes nothing.
  git?: GitRunner;
  gitRoot?: GitRootFn;
  deliverFn?: typeof deliver;
  tmux?: TmuxFn;
  stackOf?: (dir: string) => Stack;
};

export type BuildOptions = { compress?: boolean };

export type BuildResult = { ok: true; recording: Recording; events: number } | { ok: false; reason: 'no-events' | 'too-large' };

type EventRow = { ts: number; agent_key: string; event: string; tool: string | null; path: string | null; payload: string | null };
type SessionRow = { cwd: string | null; role: string | null; name: string | null };

const noGit: GitRunner = async () => ({ code: 1, stdout: '', stderr: 'replay: sin git' });
const noDeliver: typeof deliver = async () => {};
const noTmux: TmuxFn = async () => ({ code: 1, stdout: '' });

// A hook event from a stored row. Observed floors store no payload: it is rebuilt from the columns that remain
// (event, agent, tool, path), enough to move the character and name what it touches.
export function eventOf(row: EventRow, sessionId: string, cwd: string | null): HookEvent {
  if (row.payload) {
    try {
      const parsed = JSON.parse(row.payload) as HookEvent;
      if (parsed && typeof parsed === 'object') return { ...parsed, session_id: sessionId, hook_event_name: row.event, ...(cwd && !parsed.cwd ? { cwd } : {}) };
    } catch {}
  }
  const event: HookEvent = { hook_event_name: row.event, session_id: sessionId };
  if (cwd) event.cwd = cwd;
  if (row.agent_key !== sessionId) event.agent_id = row.agent_key;
  if (row.tool) event.tool_name = row.tool;
  if (row.path) event.tool_input = { file_path: row.path };
  return event;
}

// Pure: the messages with every silence longer than GAP_MS shortened to SKIP_MS.
export function compressed(messages: Recording['messages']): Recording['messages'] {
  const out: Recording['messages'] = [];
  let previous = 0;
  let shifted = 0;
  for (const entry of messages) {
    const gap = entry.t - previous;
    if (gap > GAP_MS) shifted += gap - SKIP_MS;
    previous = entry.t;
    out.push({ t: entry.t - shifted, msg: entry.msg });
  }
  return out;
}

// Rebuilds a session from the events the hub stored, with an Office that lives in memory and whose clock is the
// ts of each event. It answers the same states as the live one, and touches nothing outside the process.
export async function buildRecording(db: Database, sessionId: string, deps: ReplayDeps, opts: BuildOptions = {}): Promise<BuildResult> {
  const count = db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM events WHERE session_id = ?').get(sessionId)?.n ?? 0;
  if (count === 0) return { ok: false, reason: 'no-events' };
  if (count > MAX_REPLAY_EVENTS) return { ok: false, reason: 'too-large' };
  const rows = db
    .query<EventRow, [string]>('SELECT ts, agent_key, event, tool, path, payload FROM events WHERE session_id = ? ORDER BY ts, id')
    .all(sessionId);
  const session = db.query<SessionRow, [string]>('SELECT cwd, role, name FROM sessions WHERE session_id = ?').get(sessionId);
  const meta: HookMeta = { socket: null, token: null, role: session?.role ?? null, name: session?.name ?? null };

  const known = deps.registry?.all() ?? [];
  const roots = [...Object.values(deps.config.floors).map((floor) => realPath(floor.path)), ...known.map((record) => record.path)];
  // No git in a replay: the root of a folder is the floor that holds it, or the folder itself.
  const gitRoot: GitRootFn = deps.gitRoot ?? ((cwd) => roots.filter((root) => isInside(realPath(cwd), root)).sort((a, b) => b.length - a.length)[0] ?? cwd);

  const startedAt = rows[0].ts;
  let clock = startedAt;
  const memory = openDb(':memory:');
  const office = new Office({
    db: memory,
    config: deps.config,
    profiles: deps.profiles,
    workspaceDir: deps.workspaceDir,
    // A folder that does not exist: nothing of the real ~/.claude is read.
    claudeHome: join(tmpdir(), 'agent-office-replay-void'),
    registry: memoryRegistry(known.map((record) => ({ ...record }))),
    gitRoot,
    stackOf: deps.stackOf,
    git: deps.git ?? noGit,
    deliverFn: deps.deliverFn ?? noDeliver,
    tmux: deps.tmux ?? noTmux,
    hubId: deps.hubId,
    log: () => {},
    now: () => clock,
    sideEffects: false,
  });
  const messages: Recording['messages'] = [{ t: 0, msg: { type: 'snapshot', data: office.snapshot() } }];
  const unsubscribe = office.subscribe((msg: ServerMessage) => messages.push({ t: clock - startedAt, msg }));
  try {
    let nextTick = startedAt + REPLAY_TICK_MS;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      while (nextTick <= row.ts) {
        clock = nextTick;
        office.tick();
        nextTick += REPLAY_TICK_MS;
      }
      clock = row.ts;
      office.ingest(eventOf(row, sessionId, session?.cwd ?? null), meta);
      if (i % YIELD_EVERY === YIELD_EVERY - 1) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    // The floors a session touched are known only once it has run: the player starts with all of them.
    const first = messages[0].msg;
    if (first.type === 'snapshot') first.data.floors = office.snapshot().floors;
  } finally {
    await office.idle();
    unsubscribe();
    office.stop();
    memory.close();
  }
  const body = opts.compress ? compressed(messages) : messages;
  return { ok: true, recording: { version: 1, startedAt, messages: body }, events: rows.length };
}
