import type { Database } from 'bun:sqlite';

const DAY_MS = 86_400_000;

export function prune(db: Database, now: number, retentionDays: number): number {
  const cutoff = now - retentionDays * DAY_MS;
  let removed = 0;
  const run = (sql: string) => {
    removed += db.query(sql).run(cutoff).changes;
  };
  run('DELETE FROM events WHERE ts < ?');
  run('DELETE FROM edits WHERE ts < ?');
  run("DELETE FROM verdicts WHERE ts < ? AND kind = 'tests'");
  run('DELETE FROM messages WHERE ts < ?');
  run('DELETE FROM gate_decisions WHERE ts < ?');
  run('DELETE FROM alerts WHERE ts < ?');
  run('DELETE FROM chat_messages WHERE ts < ?');
  run("DELETE FROM questions WHERE created_at < ? AND status != 'pending'");
  run('DELETE FROM tasks WHERE updated_at < ?');
  run('DELETE FROM agents WHERE COALESCE(ended_at, updated_at) < ?');
  run('DELETE FROM sessions WHERE COALESCE(ended_at, updated_at) < ?');
  return removed;
}
