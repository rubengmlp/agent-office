import type { OfficeApi } from '../api';
import { button, el } from '../dom';
import { currentLang, plural, t, type MessageKey } from '../i18n';
import { hasMaxRounds, scoreText } from '../labels';
import { canDiscard, discardDocument, documentBadge, downloadDocument, openDocument } from '../panel/deliverables';
import type { Store } from '../store';
import type { DocumentStatus, DocumentView, PlanDecision } from '../types';

type Group = { titleKey: MessageKey; statuses: readonly DocumentStatus[]; emptyKey: MessageKey };

const GROUPS: readonly Group[] = [
  { titleKey: 'plans.group.pending', statuses: ['entregado'], emptyKey: 'plans.group.pendingEmpty' },
  { titleKey: 'plans.group.parked', statuses: ['aparcado'], emptyKey: 'plans.group.parkedEmpty' },
  { titleKey: 'plans.group.running', statuses: ['ejecutando'], emptyKey: 'plans.group.runningEmpty' },
  { titleKey: 'plans.group.drafting', statuses: ['borrador', 'revision', 'aprobado', 'sin-acuerdo'], emptyKey: 'plans.group.draftingEmpty' },
  { titleKey: 'plans.group.closed', statuses: ['cerrado', 'descartado'], emptyKey: 'plans.group.closedEmpty' },
];

const DONE_KEYS: Record<PlanDecision, MessageKey> = {
  ejecutar: 'plans.done.ejecutar',
  aparcar: 'plans.done.aparcar',
  cerrar: 'plans.done.cerrar',
};

function dateFormat(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(currentLang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function recency(doc: DocumentView): number {
  return Math.max(doc.updatedAt, doc.deliveredAt ?? 0, doc.decidedAt ?? 0);
}

function floorsText(doc: DocumentView): string {
  const floors = [...new Set(doc.base.map((base) => base.floor))];
  return floors.length > 0 ? t('plans.floors', { floors: floors.join(', ') }) : t('plans.floorsUnknown');
}

export function roundText(doc: DocumentView): string | null {
  if (doc.round === 0) return null;
  const round = hasMaxRounds(doc) ? plural('plans.roundsOfMax', doc.round, { max: doc.maxRounds }) : plural('plans.rounds', doc.round);
  return doc.score === null ? round : `${round} · ${scoreText(doc.score)}`;
}

function confirmText(doc: DocumentView, decision: PlanDecision): string | null {
  if (decision === 'ejecutar') return t('plans.confirm.ejecutar', { title: doc.title });
  if (decision === 'cerrar') return t('plans.confirm.cerrar', { title: doc.title });
  return null;
}

async function decide(api: OfficeApi, store: Store, doc: DocumentView, decision: PlanDecision, control: HTMLButtonElement): Promise<void> {
  const question = confirmText(doc, decision);
  if (question !== null && !window.confirm(question)) return;
  control.disabled = true;
  const result = await api.decidePlan(doc.path, decision);
  control.disabled = false;
  if (!result.ok) {
    store.toast(result.message, 'error');
    return;
  }
  store.toast(t(DONE_KEYS[decision], { title: doc.title }), 'ok');
}

function actions(api: OfficeApi | null, store: Store, doc: DocumentView): HTMLElement {
  const view = button(t('plans.view'), 'plans-action');
  view.addEventListener('click', () => openDocument(store, doc));
  const row = el('div', 'plans-actions', view);
  if (api === null) return row;
  const decision = (label: string, value: PlanDecision, className = 'plans-action'): void => {
    const control = button(label, className);
    control.addEventListener('click', () => void decide(api, store, doc, value, control));
    row.append(control);
  };
  if (doc.status === 'entregado' || doc.status === 'aparcado') decision(t('plans.execute'), 'ejecutar', 'plans-action primary');
  if (doc.status === 'entregado' || doc.status === 'ejecutando') decision(t('plans.park'), 'aparcar');
  if (doc.status === 'ejecutando') decision(t('plans.close'), 'cerrar');
  if (canDiscard(doc)) {
    const discard = button(t('deliverables.discard'), 'plans-action doc-discard');
    discard.addEventListener('click', () => void discardDocument(api, store, doc, discard));
    row.append(discard);
  }
  const download = button(t('deliverables.download'), 'plans-action', t('deliverables.downloadTitle', { file: `${doc.slug}.md` }));
  download.addEventListener('click', () => void downloadDocument(api, store, doc, download));
  row.append(download);
  return row;
}

function planRow(api: OfficeApi | null, store: Store, doc: DocumentView): HTMLElement {
  const meta = [floorsText(doc), roundText(doc), dateFormat().format(new Date(recency(doc)))].filter((part): part is string => part !== null);
  return el(
    'article',
    `plans-row plans-${doc.status}`,
    el('div', 'plans-row-head', el('h3', 'plans-title', doc.title), documentBadge(doc)),
    el('code', 'plans-path muted', doc.path),
    el('p', 'plans-meta muted', meta.join(' · ')),
    actions(api, store, doc),
  );
}

function group(api: OfficeApi | null, store: Store, spec: Group, docs: readonly DocumentView[]): HTMLElement {
  const items = docs.filter((doc) => spec.statuses.includes(doc.status)).sort((a, b) => recency(b) - recency(a));
  return el(
    'section',
    'plans-group',
    el('div', 'plans-group-head', el('h2', 'plans-group-title', t(spec.titleKey)), el('span', 'chip', String(items.length))),
    items.length > 0 ? el('div', 'plans-list', ...items.map((doc) => planRow(api, store, doc))) : el('p', 'muted hint', t(spec.emptyKey)),
  );
}

export function mountPlans(host: HTMLElement, store: Store, api: OfficeApi | null): void {
  const root = el('div', 'plans');
  host.replaceChildren(root);
  let signature = '';

  store.watch(['documents', 'lang'], () => {
    const docs = store.documents.filter((doc) => doc.kind === 'plan');
    const next = JSON.stringify([store.lang, docs]);
    if (next === signature) return;
    signature = next;
    root.replaceChildren(
      el(
        'header',
        'plans-head',
        el('h1', 'plans-heading', t('plans.title')),
        el('p', 'muted hint', t('plans.intro')),
      ),
      ...(docs.length === 0 ? [el('p', 'muted hint', t('table.docs.noPlans'))] : GROUPS.map((spec) => group(api, store, spec, docs))),
    );
  });
}
