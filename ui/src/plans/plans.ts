import type { OfficeApi } from '../api';
import { button, el } from '../dom';
import { scoreText } from '../labels';
import { canDiscard, discardDocument, documentBadge, downloadDocument, openDocument } from '../panel/deliverables';
import type { Store } from '../store';
import type { DocumentStatus, DocumentView, PlanDecision } from '../types';

type Group = { title: string; statuses: readonly DocumentStatus[]; empty: string };

const GROUPS: readonly Group[] = [
  { title: 'Pendientes de decisión', statuses: ['entregado'], empty: 'Ningún plan espera tu decisión.' },
  { title: 'Aparcados', statuses: ['aparcado'], empty: 'Ningún plan aparcado.' },
  { title: 'En ejecución', statuses: ['ejecutando'], empty: 'Ningún plan en ejecución.' },
  { title: 'En redacción', statuses: ['borrador', 'revision', 'aprobado', 'sin-acuerdo'], empty: 'Redacción no está escribiendo ningún plan.' },
  { title: 'Cerrados y descartados', statuses: ['cerrado', 'descartado'], empty: 'Todavía no hay planes cerrados ni descartados.' },
];

const DATE_FORMAT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const DONE_TEXT: Record<PlanDecision, string> = {
  ejecutar: 'Plan enviado al director',
  aparcar: 'Plan aparcado',
  cerrar: 'Plan cerrado',
};

function recency(doc: DocumentView): number {
  return Math.max(doc.updatedAt, doc.deliveredAt ?? 0, doc.decidedAt ?? 0);
}

function floorsText(doc: DocumentView): string {
  const floors = [...new Set(doc.base.map((base) => base.floor))];
  return floors.length > 0 ? `Plantas: ${floors.join(', ')}` : 'Plantas: las que indique el plan';
}

function roundText(doc: DocumentView): string | null {
  if (doc.round === 0) return null;
  const round = `${doc.round} ${doc.round === 1 ? 'ronda' : 'rondas'}`;
  return doc.score === null ? round : `${round} · ${scoreText(doc.score)}`;
}

function confirmText(doc: DocumentView, decision: PlanDecision): string | null {
  if (decision === 'ejecutar') return `¿Enviar el plan «${doc.title}» al director para que lo reparta entre las plantas?`;
  if (decision === 'cerrar') return `¿Cerrar el plan «${doc.title}»? Hazlo cuando el director confirme que todas las plantas terminaron.`;
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
  store.toast(`${DONE_TEXT[decision]}: ${doc.title}`, 'ok');
}

function actions(api: OfficeApi | null, store: Store, doc: DocumentView): HTMLElement {
  const view = button('Ver', 'plans-action');
  view.addEventListener('click', () => openDocument(store, doc));
  const row = el('div', 'plans-actions', view);
  if (api === null) return row;
  const decision = (label: string, value: PlanDecision, className = 'plans-action'): void => {
    const control = button(label, className);
    control.addEventListener('click', () => void decide(api, store, doc, value, control));
    row.append(control);
  };
  if (doc.status === 'entregado' || doc.status === 'aparcado') decision('Ejecutar', 'ejecutar', 'plans-action primary');
  if (doc.status === 'entregado' || doc.status === 'ejecutando') decision('Aparcar', 'aparcar');
  if (doc.status === 'ejecutando') decision('Cerrar', 'cerrar');
  if (canDiscard(doc)) {
    const discard = button('Descartar', 'plans-action doc-discard');
    discard.addEventListener('click', () => void discardDocument(api, store, doc, discard));
    row.append(discard);
  }
  const download = button('Descargar', 'plans-action', `Descargar ${doc.slug}.md`);
  download.addEventListener('click', () => void downloadDocument(api, store, doc, download));
  row.append(download);
  return row;
}

function planRow(api: OfficeApi | null, store: Store, doc: DocumentView): HTMLElement {
  const meta = [floorsText(doc), roundText(doc), DATE_FORMAT.format(new Date(recency(doc)))].filter((part): part is string => part !== null);
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
    el('div', 'plans-group-head', el('h2', 'plans-group-title', spec.title), el('span', 'chip', String(items.length))),
    items.length > 0 ? el('div', 'plans-list', ...items.map((doc) => planRow(api, store, doc))) : el('p', 'muted hint', spec.empty),
  );
}

export function mountPlans(host: HTMLElement, store: Store, api: OfficeApi | null): void {
  const root = el('div', 'plans');
  host.replaceChildren(root);
  let signature = '';

  store.watch(['documents'], () => {
    const docs = store.documents.filter((doc) => doc.kind === 'plan');
    const next = JSON.stringify(docs);
    if (next === signature) return;
    signature = next;
    root.replaceChildren(
      el(
        'header',
        'plans-head',
        el('h1', 'plans-heading', 'Planes'),
        el(
          'p',
          'muted hint',
          'Redacción deja aquí cada plan aprobado. Ejecutar lo manda al director, que lo reparte entre las plantas; Cerrar, cuando te confirme que terminaron.',
        ),
      ),
      ...(docs.length === 0 ? [el('p', 'muted hint', 'Sin planes todavía.')] : GROUPS.map((spec) => group(api, store, spec, docs))),
    );
  });
}
