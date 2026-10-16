import type { Database } from 'bun:sqlite';
import type { HubText } from './types';

export class FloorInUseError extends Error {
  readonly text: HubText;

  constructor(slug: string, sessions: readonly string[]) {
    super(`Cierra la sesión lead-${slug} (y su equipo) antes de borrar la planta. Sesiones abiertas: ${sessions.join(', ')}.`);
    this.text = { key: 'hub.floors.inUse', params: { slug, sessions: sessions.join(', ') } };
  }
}

export const FLOOR_TABLES = [
  'events',
  'sessions',
  'agents',
  'edits',
  'verdicts',
  'messages',
  'questions',
  'lessons',
  'reports',
  'alerts',
  'floor_sync',
  'sync_worktrees',
  'chat_messages',
  'token_usage',
  'token_cursor',
  'activity_log',
  'check_runs',
  'checks',
] as const;

// Tables keyed by order: they go before the orders of the floor.
const ORDER_TABLES = ['checkpoints', 'order_comments', 'review_findings'] as const;

// tasks and gate_decisions have no floor column: their scope is the team of a session or agent of the floor,
// or session-<8 chars> for a session without a team. It must be read before sessions and agents are deleted.
const FLOOR_SCOPES = `SELECT 'session-' || substr(session_id, 1, 8) FROM sessions WHERE floor = ?1
  UNION SELECT team FROM sessions WHERE floor = ?1 AND team IS NOT NULL
  UNION SELECT team FROM agents WHERE floor = ?1 AND team IS NOT NULL`;

export function purgeFloorData(db: Database, slug: string, realPath: string): number {
  const purge = db.transaction(() => {
    let rows = 0;
    for (const table of ['tasks', 'gate_decisions']) {
      rows += db.query(`DELETE FROM ${table} WHERE scope IN (${FLOOR_SCOPES})`).run(slug).changes;
    }
    for (const table of ORDER_TABLES) rows += db.query(`DELETE FROM ${table} WHERE order_id IN (SELECT id FROM orders WHERE floor = ?)`).run(slug).changes;
    for (const table of FLOOR_TABLES) rows += db.query(`DELETE FROM ${table} WHERE floor = ?`).run(slug).changes;
    rows += db.query('DELETE FROM orders WHERE floor = ?').run(slug).changes;
    rows += db.query('DELETE FROM floors WHERE slug = ? OR path = ?').run(slug, realPath).changes;
    return rows;
  });
  return purge();
}
