import type { Database } from 'bun:sqlite';
import { lessonsBy } from './memory';
import { BLOCK_PREFIX, DONE_PREFIX, short } from './state-machine';
import type { ReportView, RoleId, VerdictKind } from './types';

export const MAX_REPORTS_PER_ROLE = 50;
const MAX_LIST = 30;
const MAX_FILES = 200;

export type ReportSubject = {
  key: string;
  name: string | null;
  role: string | null;
  roleId: RoleId | null;
  floor: string;
  startedAt: number;
  endedAt: number | null;
  closing: string | null;
};

type VerdictRow = { ts: number; kind: string; ok: number; command: string | null; path: string | null; round: number | null; score: number | null };
type MessageRow = { ts: number; from_key: string; to_name: string; text: string | null };
type ReportRow = { data: string };

function summarize(sent: MessageRow[], closing: string | null, files: number, tests: number): string {
  const done = [...sent].reverse().find((m) => m.text && DONE_PREFIX.test(m.text));
  if (done?.text) return short(done.text, 160);
  const blocked = [...sent].reverse().find((m) => m.text && BLOCK_PREFIX.test(m.text));
  if (blocked?.text) return short(blocked.text, 160);
  const firstLine = closing?.split('\n').find((line) => line.trim());
  if (firstLine) return short(firstLine, 160);
  if (files === 0 && tests === 0) return 'Sin actividad registrada';
  return `${files} ${files === 1 ? 'fichero cambiado' : 'ficheros cambiados'} · ${tests} ${tests === 1 ? 'ejecución de tests' : 'ejecuciones de tests'}`;
}

export function buildReport(db: Database, s: ReportSubject, nameOf: (key: string) => string): ReportView {
  const files = db
    .query<{ path: string }, [string, number]>(
      "SELECT path FROM edits WHERE agent_key = ? AND path IS NOT NULL AND path != '' GROUP BY path ORDER BY MAX(ts) DESC LIMIT ?",
    )
    .all(s.key, MAX_FILES)
    .map((r) => r.path);
  const verdictRows = db
    .query<VerdictRow, [string]>('SELECT ts, kind, ok, command, path, round, score FROM verdicts WHERE agent_key = ? ORDER BY ts ASC, id ASC')
    .all(s.key);
  const tests = verdictRows
    .filter((v) => v.kind === 'tests')
    .slice(-MAX_LIST)
    .map((v) => ({ ok: v.ok === 1, ts: v.ts, command: v.command ?? '' }));
  const verdicts = verdictRows
    .filter((v) => v.kind !== 'tests')
    .slice(-MAX_LIST)
    .map((v) => ({ kind: v.kind as VerdictKind, ts: v.ts, path: v.path, round: v.round, score: v.score }));
  const sentAll = db
    .query<MessageRow, [string]>('SELECT ts, from_key, to_name, text FROM messages WHERE from_key = ? ORDER BY ts ASC, id ASC')
    .all(s.key);
  const receivedRows = db
    .query<MessageRow, [string, number]>(
      'SELECT ts, from_key, to_name, text FROM messages WHERE to_key = ? ORDER BY ts DESC, id DESC LIMIT ?',
    )
    .all(s.key, MAX_LIST)
    .reverse();
  const questions = db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM questions WHERE agent_key = ?').get(s.key)?.n ?? 0;
  return {
    agentKey: s.key,
    name: s.name,
    role: s.role,
    roleId: s.roleId,
    floor: s.floor,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    live: s.endedAt === null,
    summary: summarize(sentAll, s.closing, files.length, tests.length),
    files,
    tests,
    verdicts,
    sent: sentAll.slice(-MAX_LIST).map((m) => ({ ts: m.ts, to: m.to_name, text: m.text })),
    received: receivedRows.map((m) => ({ ts: m.ts, from: nameOf(m.from_key), text: m.text })),
    questions,
    blocked: sentAll.filter((m) => m.text && BLOCK_PREFIX.test(m.text)).length,
    lessons: lessonsBy(db, s.key),
    closing: s.closing,
  };
}

export function saveReport(db: Database, report: ReportView, now: number): void {
  const data = JSON.stringify({ ...report, live: false });
  db.query(
    `INSERT INTO reports (agent_key, floor, role_id, name, started_at, ended_at, summary, data, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(agent_key) DO UPDATE SET floor = excluded.floor, role_id = excluded.role_id, name = excluded.name,
       started_at = excluded.started_at, ended_at = excluded.ended_at, summary = excluded.summary, data = excluded.data,
       updated_at = excluded.updated_at`,
  ).run(report.agentKey, report.floor, report.roleId, report.name, report.startedAt, report.endedAt, report.summary, data, now);
  if (!report.roleId) return;
  db.query(
    `DELETE FROM reports WHERE floor = ? AND role_id = ? AND agent_key NOT IN (
       SELECT agent_key FROM reports WHERE floor = ? AND role_id = ? ORDER BY updated_at DESC LIMIT ?
     )`,
  ).run(report.floor, report.roleId, report.floor, report.roleId, MAX_REPORTS_PER_ROLE);
}

function parse(row: ReportRow | null | undefined): ReportView | null {
  if (!row) return null;
  try {
    return { ...(JSON.parse(row.data) as ReportView), live: false };
  } catch {
    return null;
  }
}

export function savedReport(db: Database, agentKey: string): ReportView | null {
  return parse(db.query<ReportRow, [string]>('SELECT data FROM reports WHERE agent_key = ?').get(agentKey));
}

export function savedReports(db: Database, floor: string, roleId: RoleId, limit: number, excludeKey: string | null = null): ReportView[] {
  return db
    .query<ReportRow, [string, string, string, number]>(
      'SELECT data FROM reports WHERE floor = ? AND role_id = ? AND agent_key != ? ORDER BY updated_at DESC LIMIT ?',
    )
    .all(floor, roleId, excludeKey ?? '', limit)
    .map((row) => parse(row))
    .filter((r): r is ReportView => r !== null);
}
