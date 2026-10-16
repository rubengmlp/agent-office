import type { Database } from 'bun:sqlite';
import type { OrderSource, OrderStatus, WorktreeState } from './types';

export type OrderRow = {
  id: number;
  slug: string;
  floor: string;
  title: string;
  description: string;
  status: OrderStatus;
  source: OrderSource;
  plan_slug: string | null;
  parent_id: number | null;
  lead_session: string | null;
  branch: string | null;
  base_ref: string | null;
  base_sha: string | null;
  base_stale: number;
  worktree_path: string | null;
  worktree_state: WorktreeState | null;
  setup_error: string | null;
  review_state: string;
  cycle: number;
  skipped_files: string | null;
  checks_forced_sha: string | null;
  pr_url: string | null;
  pr_state: string | null;
  merged_at: number | null;
  kept_at: number | null;
  created_at: number;
  updated_at: number;
  last_activity: number | null;
  removed_at: number | null;
};

export type NewOrder = {
  slug: string;
  floor: string;
  title: string;
  description?: string;
  status?: OrderStatus;
  source: OrderSource;
  planSlug?: string | null;
  parentId?: number | null;
  leadSession?: string | null;
  baseRef?: string | null;
  now: number;
};

export type OrderPatch = Partial<Omit<OrderRow, 'id' | 'slug' | 'floor' | 'created_at'>>;

const COLUMNS = new Set([
  'title', 'description', 'status', 'source', 'plan_slug', 'parent_id', 'lead_session', 'branch', 'base_ref', 'base_sha', 'base_stale',
  'worktree_path', 'worktree_state', 'setup_error', 'review_state', 'cycle', 'skipped_files', 'checks_forced_sha', 'pr_url', 'pr_state',
  'merged_at', 'kept_at', 'updated_at', 'last_activity', 'removed_at',
]);

// The orders table, shared by the desks of the board: each owns its columns and writes them through update.
export class OrderStore {
  constructor(private readonly db: Database) {}

  insert(order: NewOrder): OrderRow {
    const id = Number(
      this.db
        .query(
          `INSERT INTO orders (slug, floor, title, description, status, source, plan_slug, parent_id, lead_session, base_ref, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          order.slug,
          order.floor,
          order.title,
          order.description ?? '',
          order.status ?? 'pendiente',
          order.source,
          order.planSlug ?? null,
          order.parentId ?? null,
          order.leadSession ?? null,
          order.baseRef ?? null,
          order.now,
          order.now,
        ).lastInsertRowid,
    );
    return this.get(id) as OrderRow;
  }

  get(id: number): OrderRow | null {
    return this.db.query<OrderRow, [number]>('SELECT * FROM orders WHERE id = ? AND removed_at IS NULL').get(id);
  }

  bySlug(slug: string): OrderRow | null {
    return this.db.query<OrderRow, [string]>('SELECT * FROM orders WHERE slug = ? AND removed_at IS NULL').get(slug);
  }

  all(): OrderRow[] {
    return this.db.query<OrderRow, []>('SELECT * FROM orders WHERE removed_at IS NULL ORDER BY id').all();
  }

  inFloor(floor: string, statuses?: readonly OrderStatus[]): OrderRow[] {
    const rows = this.db.query<OrderRow, [string]>('SELECT * FROM orders WHERE floor = ? AND removed_at IS NULL ORDER BY id').all(floor);
    return statuses ? rows.filter((row) => statuses.includes(row.status)) : rows;
  }

  byPlan(planSlug: string): OrderRow[] {
    return this.db.query<OrderRow, [string]>('SELECT * FROM orders WHERE plan_slug = ? AND removed_at IS NULL ORDER BY id').all(planSlug);
  }

  withWorktree(): OrderRow[] {
    return this.db
      .query<OrderRow, []>("SELECT * FROM orders WHERE worktree_path IS NOT NULL AND worktree_state != 'retirado' AND removed_at IS NULL ORDER BY id")
      .all();
  }

  slugTaken(slug: string): boolean {
    return this.db.query<{ one: number }, [string]>('SELECT 1 AS one FROM orders WHERE slug = ?').get(slug) !== null;
  }

  update(id: number, patch: OrderPatch): OrderRow | null {
    const entries = Object.entries(patch).filter(([name, value]) => COLUMNS.has(name) && value !== undefined);
    if (entries.length > 0) {
      const sets = entries.map(([name]) => `${name} = ?`).join(', ');
      this.db.query(`UPDATE orders SET ${sets} WHERE id = ?`).run(...entries.map(([, value]) => value as string | number | null), id);
    }
    return this.get(id);
  }
}
