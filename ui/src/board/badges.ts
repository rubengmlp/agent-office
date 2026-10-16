import { el } from '../dom';
import { t } from '../i18n';
import type { OrderView } from '../types';
import { checksBadge, folderBusy } from './columns';

// ✓ / ✗ / spinner with passed/total, or null when the floor runs no checks.
export function checksBadgeNode(order: OrderView): HTMLElement | null {
  const badge = checksBadge(order);
  if (!badge) return null;
  const icon = badge.kind === 'passed' ? '✓' : badge.kind === 'failed' ? '✗' : badge.kind === 'running' ? '' : '·';
  const mark = el('span', badge.kind === 'running' ? 'spinner' : 'checks-mark', icon);
  const node = el('span', `checks-badge checks-${badge.kind}`, mark, el('span', 'checks-count', t('board.checks.count', { passed: badge.passed, total: badge.total })));
  node.title = t(`board.checks.${badge.kind}`);
  node.setAttribute('aria-label', `${t(`board.checks.${badge.kind}`)} ${badge.passed}/${badge.total}`);
  return node;
}

// What the folder of the card is doing, only when it is not simply ready.
export function folderBadgeNode(order: OrderView): HTMLElement | null {
  const folder = order.worktree;
  if (!folder || (folder.state === 'listo' && !folder.stale)) return null;
  if (folderBusy(order)) return el('span', 'chip folder-busy', t(`board.folder.${folder.state === 'creando' ? 'creating' : 'preparing'}`));
  if (folder.state === 'error') {
    const chip = el('span', 'chip folder-error', t('board.folder.error'));
    chip.title = folder.error ?? '';
    return chip;
  }
  if (folder.stale) {
    const chip = el('span', 'chip folder-stale', t('board.folder.stale'));
    chip.title = t('board.folder.staleHint');
    return chip;
  }
  return null;
}
