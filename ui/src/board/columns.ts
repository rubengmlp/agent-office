import type { OrderStatus, OrderView } from '../types';

// The four columns of the Tablero, in order; a discarded card has no column.
export const COLUMNS: readonly OrderStatus[] = ['pendiente', 'en-curso', 'revision', 'hecho'];

export type Column = { status: OrderStatus; orders: OrderView[] };

// The cards of the Tablero grouped by column: the most recently touched first, and only the floor chosen when
// there is one.
export function columnsOf(orders: readonly OrderView[], floor: string | null): Column[] {
  return COLUMNS.map((status) => ({
    status,
    orders: orders
      .filter((order) => order.status === status && (floor === null || order.floor === floor))
      .sort((a, b) => Math.max(b.lastActivity ?? 0, b.updatedAt) - Math.max(a.lastActivity ?? 0, a.updatedAt) || b.id - a.id),
  }));
}

// Where the arrows of a card take it: the neighbour column on each side. From hecho the hub reopens it as
// en-curso whatever the target is, so the arrow says so.
export function neighbours(status: OrderStatus): { back: OrderStatus | null; next: OrderStatus | null } {
  const at = COLUMNS.indexOf(status);
  if (at < 0) return { back: null, next: null };
  return { back: COLUMNS[at - 1] ?? null, next: COLUMNS[at + 1] ?? null };
}

export type ChecksBadge = { kind: 'none' | 'running' | 'passed' | 'failed'; passed: number; total: number } | null;

// The checks badge of a card: ✓/✗/spinner with passed/total, or nothing when the floor runs none.
export function checksBadge(order: OrderView): ChecksBadge {
  const checks = order.checks;
  if (!checks || checks.total === 0) return null;
  return { kind: checks.status, passed: checks.passed, total: checks.total };
}

// The card a floor is working on now, for the badge of the floors panel and the table: an open one, the last
// touched first.
export function activeOrder(orders: readonly OrderView[], floor: string): OrderView | null {
  const open = orders.filter((order) => order.floor === floor && (order.status === 'en-curso' || order.status === 'pendiente' || order.status === 'revision'));
  open.sort((a, b) => Math.max(b.lastActivity ?? 0, b.updatedAt) - Math.max(a.lastActivity ?? 0, a.updatedAt));
  return open.find((order) => order.checks !== null) ?? open[0] ?? null;
}

// The floors the Tablero lists: the ones the hub manages, whether or not they still take new orders.
export function orderFloors(floors: readonly { slug: string; kind: string }[]): string[] {
  return floors.filter((floor) => floor.kind === 'managed').map((floor) => floor.slug);
}

// The floors that can take a new order: the managed ones that work with a folder per order.
export function deliveryFloors(floors: readonly { slug: string; kind: string; delivery?: boolean }[]): string[] {
  return floors.filter((floor) => floor.kind === 'managed' && floor.delivery === true).map((floor) => floor.slug);
}

export function folderBusy(order: OrderView): boolean {
  return order.worktree?.state === 'creando' || order.worktree?.state === 'preparando';
}
