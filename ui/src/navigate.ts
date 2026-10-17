import type { BoardHandle } from './board/board';
import { t } from './i18n';
import { needsOf, needToast, type Need, type NeedCursor, type NeedKind } from './needs';
import type { OfficeHandle } from './office/office';
import { openDocument } from './panel/deliverables';
import { openSection, type SectionId } from './panel/section';
import type { Store } from './store';
import type { Tab } from './topbar';

export type Nav = {
  store: Store;
  tab(): Tab;
  showTab(tab: Tab): void;
  office(): OfficeHandle | null;
  board(): BoardHandle;
};

const SECTION_OF: Record<NeedKind, SectionId | null> = {
  permission: 'question',
  question: 'question',
  blocked: 'orders',
  stalled: 'floors',
  plan: null,
  checks: null,
};

// Selects the agent, opens the section of the panel that matters and brings the camera to it. The tabs that
// do not show the office are left for the Oficina one.
export function goToAgent(nav: Nav, key: string, section: SectionId | null = null): void {
  const tab = nav.tab();
  if (tab !== 'office' && tab !== 'table') nav.showTab('office');
  nav.store.select(key);
  if (section) openSection(section);
  nav.office()?.focusAgent(key);
}

export function goToNeed(nav: Nav, need: Need): void {
  if (need.agentKey !== null) {
    goToAgent(nav, need.agentKey, SECTION_OF[need.kind]);
    return;
  }
  if (need.docPath !== null) {
    const doc = nav.store.documents.find((item) => item.path === need.docPath);
    nav.showTab('plans');
    if (doc) openDocument(nav.store, doc);
    return;
  }
  if (need.orderSlug !== null) {
    nav.showTab('board');
    nav.board().show(need.floor, need.orderSlug);
  }
}

// N and Shift+N: the next or the previous thing that waits for the user, with a toast that says which.
export function stepNeed(nav: Nav, cursor: NeedCursor, direction: 1 | -1): void {
  const step = cursor.step(needsOf(nav.store), direction);
  if (!step) {
    nav.store.toast(t('needs.none'), 'info');
    return;
  }
  goToNeed(nav, step.need);
  nav.store.toast(needToast(step.position, step.total, step.need), 'info', { ttlMs: 2500 });
}
