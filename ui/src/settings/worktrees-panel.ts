import type { OfficeApi } from '../api';
import { button, el } from '../dom';
import { currentLang, plural, t } from '../i18n';
import { relativeTime } from '../time';
import type { Store } from '../store';
import type { WorktreeView } from '../types';
import { groupWorktrees, overWarning, panelVisible, sizeText } from './worktrees-model';

const decimal = (value: number): string => new Intl.NumberFormat(currentLang(), { maximumFractionDigits: 1 }).format(value);

// The folders of the orders of every floor: what each holds, how big, and what to do with the ones left over.
export function mountWorktreesPanel(host: HTMLElement, store: Store, api: OfficeApi): void {
  const title = el('h2', 'settings-title');
  const hint = el('p', 'settings-hint muted');
  const total = el('p', 'worktrees-total');
  const prune = button('');
  const status = el('p', 'settings-status');
  const list = el('div', 'worktrees-list');
  const section = el('section', 'settings-section worktrees', title, hint, el('div', 'worktrees-head', total, prune), status, list);
  host.append(section);

  let views: WorktreeView[] = [];
  let totalKb = 0;
  let warnKb = 0;
  let loaded = false;
  let busy = false;
  let seq = 0;

  const say = (text: string, kind: 'ok' | 'error' | '' = ''): void => {
    status.textContent = text;
    status.className = kind ? `settings-status ${kind}` : 'settings-status';
  };

  const load = async (): Promise<void> => {
    const ticket = ++seq;
    const result = await api.worktrees();
    if (ticket !== seq) return;
    loaded = true;
    if (result.ok) {
      views = result.data.worktrees;
      totalKb = result.data.totalKb;
      warnKb = result.data.warnKb;
    } else say(result.message, 'error');
    paint();
  };

  const act = async (run: () => Promise<{ ok: true } | { ok: false; message: string; key?: string; status: number }>, done: string): Promise<void> => {
    busy = true;
    paint();
    const result = await run();
    busy = false;
    if (!result.ok) say(result.message, 'error');
    else say(done, 'ok');
    await load();
  };

  // Delete: the hub refuses a dirty folder or an unmerged branch until the user insists.
  const remove = async (view: WorktreeView): Promise<void> => {
    const attempt = async (force: boolean): Promise<{ ok: true } | { ok: false; message: string; key?: string; status: number }> => {
      const result = await api.removeWorktree(view.orderId, { branch: true, force });
      if (result.ok) return result;
      if (!force && (result.key === 'hub.api.worktreeDirty' || result.key === 'hub.api.branchUnmerged')) {
        if (window.confirm(t('settings.worktrees.forceAsk', { slug: view.slug, reason: result.message }))) return attempt(true);
      }
      return result;
    };
    if (!window.confirm(t('settings.worktrees.deleteAsk', { slug: view.slug, branch: view.branch }))) return;
    await act(() => attempt(false), t('settings.worktrees.deleted', { slug: view.slug }));
  };

  const row = (view: WorktreeView, now: number): HTMLElement => {
    const del = button(t('settings.worktrees.delete'), 'project-delete');
    del.disabled = busy;
    del.setAttribute('aria-label', t('settings.worktrees.deleteLabel', { slug: view.slug }));
    del.addEventListener('click', () => void remove(view));
    const actions = el('span', 'worktree-actions', del);
    if (view.pending) {
      const keep = button(t('settings.worktrees.keep'));
      keep.disabled = busy;
      keep.addEventListener('click', () => void act(() => api.keepWorktree(view.orderId), t('settings.worktrees.kept', { slug: view.slug })));
      actions.prepend(keep);
    }
    return el(
      'div',
      `setting-row worktree-row${view.pending ? ' worktree-pending' : ''}`,
      el(
        'span',
        'setting-text',
        el(
          'span',
          'setting-label',
          view.slug,
          view.pending ? el('span', 'chip folder-stale', t('settings.worktrees.pending')) : null,
          view.dirty ? el('span', 'chip folder-error', t('settings.worktrees.dirty')) : null,
          view.merged && view.orderStatus === 'hecho' ? el('span', 'chip', t('settings.worktrees.merged')) : null,
          view.kept ? el('span', 'chip', t('settings.worktrees.keptChip')) : null,
          view.state !== 'listo' ? el('span', 'chip folder-busy', t(`board.worktree.${view.state}`)) : null,
        ),
        el('code', 'setting-path muted', `${view.branch} · ${view.base}`),
        el(
          'span',
          'setting-hint muted',
          [
            t('settings.worktrees.ahead', { ahead: view.ahead, behind: view.behind }),
            sizeText(view.sizeKb, decimal),
            view.lastActivity ? relativeTime(view.lastActivity, now) : t('settings.worktrees.noActivity'),
          ].join(' · '),
        ),
      ),
      actions,
    );
  };

  function paint(): void {
    section.hidden = !panelVisible(store.settings?.floors ?? [], views.length);
    title.textContent = t('settings.worktrees.title');
    hint.textContent = t('settings.worktrees.hint');
    prune.textContent = t('settings.worktrees.prune');
    prune.disabled = busy;
    const over = overWarning(totalKb, warnKb);
    total.textContent = t('settings.worktrees.total', { size: sizeText(totalKb, decimal), count: views.length });
    total.className = `worktrees-total${over ? ' over' : ''}`;
    total.title = over ? t('settings.worktrees.overWarning', { size: sizeText(warnKb, decimal) }) : '';
    const now = store.now();
    const groups = groupWorktrees(views);
    list.replaceChildren(
      ...(groups.length > 0
        ? groups.map((group) =>
            el(
              'div',
              'worktrees-group',
              el('h3', 'worktrees-floor', group.floor, ' ', el('span', 'chip', plural('settings.worktrees.count', group.worktrees.length)), group.pending > 0 ? el('span', 'chip folder-stale', plural('settings.worktrees.pendingCount', group.pending)) : null),
              ...group.worktrees.map((view) => row(view, now)),
            ),
          )
        : [el('p', 'muted', t(loaded ? 'settings.worktrees.empty' : 'board.loading'))]),
    );
  }

  prune.addEventListener('click', () =>
    void act(async () => {
      const result = await api.pruneWorktrees();
      return result.ok ? { ok: true } : result;
    }, t('settings.worktrees.pruned')),
  );
  store.watch(['lang', 'settings'], paint);
  let timer: ReturnType<typeof setTimeout> | null = null;
  store.subscribe((topics) => {
    if (!topics.has('worktrees') && !topics.has('orders')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void load(), 400);
  });
  store.watch(['connection'], () => {
    if (store.connection === 'online') void load();
  });
  paint();
  void load();
}
