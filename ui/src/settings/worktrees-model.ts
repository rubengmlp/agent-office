import type { WorktreeView } from '../types';

export type WorktreeGroup = { floor: string; worktrees: WorktreeView[]; pending: number; sizeKb: number };

// The folders grouped by floor, the ones waiting for a decision first, then the most recently active.
export function groupWorktrees(worktrees: readonly WorktreeView[]): WorktreeGroup[] {
  const byFloor = new Map<string, WorktreeView[]>();
  for (const view of worktrees) byFloor.set(view.floor, [...(byFloor.get(view.floor) ?? []), view]);
  return [...byFloor.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([floor, list]) => ({
      floor,
      worktrees: [...list].sort((a, b) => Number(b.pending) - Number(a.pending) || (b.lastActivity ?? 0) - (a.lastActivity ?? 0) || a.slug.localeCompare(b.slug)),
      pending: list.filter((view) => view.pending).length,
      sizeKb: list.reduce((sum, view) => sum + (view.sizeKb ?? 0), 0),
    }));
}

export function sizeText(kb: number | null, decimal: (value: number) => string): string {
  if (kb === null) return '—';
  if (kb < 1024) return `${decimal(kb)} KB`;
  if (kb < 1024 * 1024) return `${decimal(kb / 1024)} MB`;
  return `${decimal(kb / 1024 / 1024)} GB`;
}

// Whether the folders together pass the warning of the settings.
export function overWarning(totalKb: number, warnKb: number): boolean {
  return warnKb > 0 && totalKb > warnKb;
}

// The panel has nothing to say when no floor works with folders per order and none is left over.
export function panelVisible(floors: readonly { delivery: boolean }[], worktrees: number): boolean {
  return worktrees > 0 || floors.some((floor) => floor.delivery);
}
