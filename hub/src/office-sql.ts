import { relative } from 'node:path';
import { realPath } from './floors';
import type { OfficeConfig } from './types';
import type { Database } from 'bun:sqlite';

const LISTED_EDITS = 20;
const GIT_ROOT_LABEL = '. (git)';

export type SessionRow = {
  session_id: string;
  cwd: string | null;
  role: string | null;
  name: string | null;
  socket: string | null;
  token: string | null;
  team: string | null;
  started_at: number;
  updated_at: number;
  rules_hash: string | null;
  launch_hash: string | null;
  task_open_since: number | null;
};

export type TaskRow = { owner: string | null; status: string | null };

export type AlertRow = { id: number; ts: number; level: string; floor: string; agent_key: string; files: string };

export function prepare(db: Database) {
  return {
    insertEvent: db.query(
      'INSERT INTO events (ts, session_id, agent_key, floor, event, tool, state, path, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    upsertSession: db.query(
      `INSERT INTO sessions (session_id, cwd, floor, role, name, socket, token, team, started_at, updated_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET cwd = excluded.cwd, floor = excluded.floor, role = excluded.role,
         name = excluded.name, socket = excluded.socket, token = excluded.token, team = excluded.team,
         updated_at = excluded.updated_at, ended_at = excluded.ended_at`,
    ),
    upsertAgent: db.query(
      `INSERT INTO agents (agent_key, session_id, parent_key, name, role, floor, team, started_at, updated_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_key) DO UPDATE SET session_id = excluded.session_id, parent_key = excluded.parent_key,
         name = excluded.name, role = excluded.role, floor = excluded.floor, team = excluded.team,
         updated_at = excluded.updated_at, ended_at = excluded.ended_at`,
    ),
    openSessions: db.query<SessionRow, [number]>(
      'SELECT session_id, cwd, role, name, socket, token, team, started_at, updated_at, rules_hash, launch_hash, task_open_since FROM sessions WHERE ended_at IS NULL AND updated_at > ?',
    ),
    updateHashes: db.query('UPDATE sessions SET rules_hash = ?, launch_hash = ? WHERE session_id = ?'),
    updateTaskOpen: db.query('UPDATE sessions SET task_open_since = ? WHERE session_id = ?'),
    countBriefs: db.query<{ n: number }, [string, number]>(
      "SELECT COUNT(*) AS n FROM gate_decisions WHERE scope = ? AND decision = 'pass' AND ts > ?",
    ),
    recentPrompts: db.query<{ ts: number; prompt: string | null }, [string]>(
      "SELECT ts, json_extract(payload, '$.prompt') AS prompt FROM events WHERE agent_key = ? AND event = 'UserPromptSubmit' ORDER BY ts DESC LIMIT 50",
    ),
    lastAsk: db.query<{ ts: number | null }, [string]>(
      "SELECT MAX(ts) AS ts FROM events WHERE agent_key = ? AND event = 'PostToolUse' AND tool = 'AskUserQuestion'",
    ),
    endSession: db.query('UPDATE sessions SET ended_at = ? WHERE session_id = ?'),
    insertEdit: db.query('INSERT INTO edits (ts, agent_key, floor, path) VALUES (?, ?, ?, ?)'),
    editsBetween: db.query<{ path: string | null; ts: number }, [string, number, number]>('SELECT path, ts FROM edits WHERE floor = ? AND ts BETWEEN ? AND ?'),
    floorActive: db.query<{ one: number }, [string, number, number]>('SELECT 1 AS one FROM events WHERE floor = ? AND ts BETWEEN ? AND ? LIMIT 1'),
    insertVerdict: db.query(
      'INSERT INTO verdicts (ts, agent_key, role, floor, kind, ok, command, path, round, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    agentVerdict: db.query<{ id: number }, [string, string]>(
      "SELECT id FROM verdicts WHERE agent_key = ? AND path = ? AND kind IN ('approved', 'improve', 'no-agreement') LIMIT 1",
    ),
    countReads: db.query<{ n: number }, [string]>(
      "SELECT COUNT(*) AS n FROM events WHERE agent_key = ? AND event = 'PostToolUse' AND tool IN ('Read', 'Grep', 'Glob', 'Bash')",
    ),
    firstVerdictOf: db.query<{ ts: number | null }, [string]>(
      "SELECT MIN(ts) AS ts FROM verdicts WHERE agent_key = ? AND kind IN ('approved', 'improve', 'no-agreement')",
    ),
    lastTesterGreen: db.query<{ ts: number | null }, [string]>(
      "SELECT MAX(ts) AS ts FROM verdicts WHERE floor = ? AND kind = 'tests' AND ok = 1 AND role LIKE 'office-tester-%'",
    ),
    lastApproved: db.query<{ ts: number | null }, [string]>("SELECT MAX(ts) AS ts FROM verdicts WHERE path = ? AND kind = 'approved'"),
    insertMessage: db.query('INSERT INTO messages (ts, from_key, to_name, to_key, text, floor) VALUES (?, ?, ?, ?, ?, ?)'),
    upsertTask: db.query(
      `INSERT INTO tasks (scope, task_id, subject, owner, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope, task_id) DO UPDATE SET subject = COALESCE(excluded.subject, tasks.subject),
         owner = COALESCE(excluded.owner, tasks.owner), status = COALESCE(excluded.status, tasks.status),
         updated_at = excluded.updated_at`,
    ),
    getTask: db.query<TaskRow, [string, string]>('SELECT owner, status FROM tasks WHERE scope = ? AND task_id = ?'),
    insertGate: db.query('INSERT INTO gate_decisions (ts, scope, task_id, decision, reason) VALUES (?, ?, ?, ?, ?)'),
    insertQuestion: db.query(
      'INSERT OR REPLACE INTO questions (id, session_id, agent_key, floor, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    closeQuestion: db.query('UPDATE questions SET status = ?, resolved_at = ? WHERE id = ?'),
    releaseStalePending: db.query("UPDATE questions SET status = 'released', resolved_at = ? WHERE status = 'pending'"),
    insertAlert: db.query('INSERT INTO alerts (ts, level, floor, agent_key, files) VALUES (?, ?, ?, ?, ?)'),
    recentAlerts: db.query<AlertRow, [number]>("SELECT id, ts, level, floor, agent_key, files FROM alerts WHERE level IN ('alerta', 'posible') ORDER BY ts DESC, id DESC LIMIT ?"),
  };
}

export type Sql = ReturnType<typeof prepare>;

// last: the latest change of the owners; files and total: what they changed since the last green of a tester.
export function ownerEdits(
  db: Database,
  floors: OfficeConfig['floors'],
  floor: string,
  keys: string[],
  since: number | null,
): { last: number | null; files: string[]; total: number } {
  if (keys.length === 0) return { last: null, files: [], total: 0 };
  const marks = keys.map(() => '?').join(', ');
  const where = `floor = ? AND agent_key IN (${marks})`;
  const last = db.query<{ ts: number | null }, string[]>(`SELECT MAX(ts) AS ts FROM edits WHERE ${where}`).get(floor, ...keys)?.ts ?? null;
  const recent = `${where} AND ts >= ? AND path != ''`;
  const args: (string | number)[] = [floor, ...keys, since ?? 0];
  const rows = db
    .query<{ path: string }, (string | number)[]>(`SELECT path, MAX(ts) AS ts FROM edits WHERE ${recent} GROUP BY path ORDER BY ts DESC LIMIT ${LISTED_EDITS}`)
    .all(...args);
  const total = db.query<{ n: number }, (string | number)[]>(`SELECT COUNT(DISTINCT path) AS n FROM edits WHERE ${recent}`).get(...args)?.n ?? 0;
  const floorPath = floors[floor]?.path;
  const root = floorPath ? realPath(floorPath) : null;
  const files = [...new Set(rows.map((row) => editLabel(row.path, root)))];
  return { last, files, total };
}

function editLabel(path: string, root: string | null): string {
  if (!root) return path;
  const rel = relative(root, realPath(path));
  if (rel === '') return GIT_ROOT_LABEL;
  return rel.startsWith('..') ? path : rel;
}
