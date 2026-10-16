import type { OfficeApi } from '../api';
import { button, el, setStateColor } from '../dom';
import { DOCUMENT_STATUS_COLORS, documentKindFor, documentStatusText } from '../labels';
import type { Store } from '../store';
import type { DocumentAhead, DocumentBase, DocumentStatus, DocumentView } from '../types';
import { renderMarkdown } from './markdown';

const SHORT_SHA = 7;
const DATE_FORMAT = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
const CLOSED: ReadonlySet<DocumentStatus> = new Set<DocumentStatus>(['cerrado', 'descartado']);

const openAhead = new Set<string>();

let viewerApi: OfficeApi | null = null;
let openViewer: DocumentViewer | null = null;

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATE_FORMAT.format(date);
}

function baseText(base: DocumentBase): string {
  const label = `${base.floor} ${base.ref} @ ${base.sha.slice(0, SHORT_SHA)}`;
  if (!base.stale) return label;
  return base.date === null ? `${label} · sin actualizar` : `${label} · a fecha de ${shortDate(base.date)}`;
}

function aheadText(ahead: DocumentAhead, bases: readonly DocumentBase[]): string {
  const ref = bases.find((base) => base.floor === ahead.floor)?.ref ?? 'la rama base';
  const prefix = bases.length > 1 ? `${ahead.floor}: ` : '';
  return `${prefix}${ref} va ${ahead.commits} ${ahead.commits === 1 ? 'commit' : 'commits'} por delante`;
}

function aheadBlock(doc: DocumentView, ahead: DocumentAhead): HTMLElement {
  const text = aheadText(ahead, doc.base);
  const files = ahead.files.length;
  if (files === 0) return el('p', 'doc-line doc-ahead', text);
  const id = `${doc.path}|${ahead.floor}`;
  const details = el(
    'details',
    'doc-line doc-ahead',
    el('summary', '', `${text} · ${files} ${files === 1 ? 'fichero' : 'ficheros'}`),
    el('ul', 'doc-files', ...ahead.files.map((file) => el('li', '', el('code', '', file)))),
  );
  details.dataset.ahead = id;
  details.open = openAhead.has(id);
  return details;
}

function metaLines(doc: DocumentView): HTMLElement[] {
  const lines: HTMLElement[] = doc.base.map((base) => el('p', 'doc-line muted', baseText(base)));
  for (const ahead of doc.ahead) {
    if (ahead.commits > 0) lines.push(aheadBlock(doc, ahead));
  }
  if (doc.installedAt.length > 0) {
    const installed = el('p', 'doc-line muted', 'Instalada en: ');
    doc.installedAt.forEach((place, index) => {
      if (index > 0) installed.append(', ');
      installed.append(el('code', '', place));
    });
    lines.push(installed);
  }
  return lines;
}

function canDiscard(doc: DocumentView): boolean {
  return doc.kind === 'plan' && !CLOSED.has(doc.status);
}

function trackAhead(root: HTMLElement): void {
  root.addEventListener(
    'toggle',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLDetailsElement)) return;
      const id = target.dataset.ahead;
      if (!id) return;
      if (target.open) openAhead.add(id);
      else openAhead.delete(id);
    },
    true,
  );
}

export function documentBadge(doc: DocumentView, text: string = documentStatusText(doc)): HTMLSpanElement {
  const badge = el('span', 'badge', el('span', 'badge-dot'), text);
  setStateColor(badge, DOCUMENT_STATUS_COLORS[doc.status]);
  return badge;
}

async function discardDocument(store: Store, doc: DocumentView, control: HTMLButtonElement): Promise<boolean> {
  const api = viewerApi;
  if (api === null || !window.confirm(`¿Descartar el plan «${doc.title}»?`)) return false;
  control.disabled = true;
  const result = await api.discardDocument(doc.path);
  control.disabled = false;
  if (!result.ok) {
    store.toast(result.message, 'error');
    return false;
  }
  store.toast(`Plan descartado: ${doc.title}`, 'ok');
  return true;
}

class DocumentViewer {
  private readonly backdrop: HTMLElement;
  private readonly title = el('h2', 'modal-title');
  private readonly badge = el('span', 'modal-badge');
  private readonly meta = el('div', 'modal-meta');
  private readonly body = el('div', 'modal-body');
  private readonly discard = button('Descartar', 'doc-discard');
  private readonly close = button('Cerrar');
  private readonly previousFocus: Element | null = document.activeElement;
  private stopWatching: () => void = () => {};
  private ticket = 0;

  constructor(
    private readonly store: Store,
    private doc: DocumentView,
  ) {
    this.title.id = 'document-title';
    const dialog = el(
      'div',
      'modal',
      el(
        'header',
        'modal-head',
        el('div', 'modal-heading', this.title, this.badge),
        el('div', 'modal-actions', this.discard, this.close),
      ),
      this.meta,
      this.body,
    );
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', this.title.id);
    this.backdrop = el('div', 'modal-backdrop', dialog);

    trackAhead(this.meta);
    this.discard.addEventListener('click', () => void this.discardCurrent());
    this.close.addEventListener('click', () => this.dispose());
    this.backdrop.addEventListener('click', (event) => {
      if (event.target === this.backdrop) this.dispose();
    });
    document.addEventListener('keydown', this.onKey, true);
    document.body.append(this.backdrop);
    this.close.focus();
    this.stopWatching = store.watch(['documents'], () => this.sync());
    void this.loadContent();
  }

  dispose(): void {
    this.stopWatching();
    document.removeEventListener('keydown', this.onKey, true);
    this.backdrop.remove();
    if (openViewer === this) openViewer = null;
    if (this.previousFocus instanceof HTMLElement) this.previousFocus.focus();
  }

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    this.dispose();
  };

  private sync(): void {
    const next = this.store.documents.find((item) => item.path === this.doc.path);
    if (next) {
      const changed = next.updatedAt !== this.doc.updatedAt;
      this.doc = next;
      if (changed) void this.loadContent();
    }
    this.renderHead();
  }

  private renderHead(): void {
    const { doc } = this;
    this.title.textContent = doc.title;
    this.badge.replaceChildren(documentBadge(doc));
    this.meta.replaceChildren(el('code', 'doc-path muted', doc.path), ...metaLines(doc));
    this.discard.hidden = viewerApi === null || !canDiscard(doc);
  }

  private async loadContent(): Promise<void> {
    const api = viewerApi;
    const mine = ++this.ticket;
    if (api === null) {
      this.body.replaceChildren(
        el('p', 'muted hint', 'El contenido solo está disponible con la oficina conectada al hub.'),
      );
      return;
    }
    if (this.body.childElementCount === 0) this.body.replaceChildren(el('p', 'muted hint', 'Cargando…'));
    const result = await api.documentContent(this.doc.path);
    if (mine !== this.ticket) return;
    const scroll = this.body.scrollTop;
    const content = result.ok ? renderMarkdown(result.data.markdown) : el('p', 'doc-error hint', result.message);
    this.body.replaceChildren(content);
    this.body.scrollTop = scroll;
  }

  private async discardCurrent(): Promise<void> {
    if (await discardDocument(this.store, this.doc, this.discard)) this.dispose();
  }
}

export function openDocument(store: Store, doc: DocumentView): void {
  openViewer?.dispose();
  openViewer = new DocumentViewer(store, doc);
}

function card(store: Store, doc: DocumentView): HTMLElement {
  const root = el(
    'article',
    `doc doc-${doc.status}`,
    el('div', 'doc-head', button(doc.title, 'doc-title'), documentBadge(doc)),
    ...metaLines(doc),
  );
  root.dataset.path = doc.path;
  root.title = doc.path;
  if (canDiscard(doc)) {
    const discard = button('Descartar', 'doc-discard');
    discard.addEventListener('click', () => void discardDocument(store, doc, discard));
    root.append(el('div', 'doc-actions', discard));
  }
  return root;
}

function watchApprovals(store: Store): void {
  const known = new Map<string, DocumentStatus>();
  const announced = new Set<string>();
  store.watch(['documents'], () => {
    for (const doc of store.documents) {
      const before = known.get(doc.path);
      const becameApproved = doc.status === 'aprobado' && before !== undefined && before !== 'aprobado';
      if (!becameApproved || announced.has(doc.path)) continue;
      announced.add(doc.path);
      store.toast(`${doc.kind === 'plan' ? 'Plan aprobado' : 'Skill aprobada'}: ${doc.title}`, 'ok');
    }
    known.clear();
    for (const doc of store.documents) known.set(doc.path, doc.status);
    for (const path of announced) {
      if (!known.has(path)) announced.delete(path);
    }
  });
}

export function mountDeliverables(host: HTMLElement, store: Store, api: OfficeApi | null): void {
  viewerApi = api;
  host.replaceChildren();
  host.hidden = true;
  trackAhead(host);
  watchApprovals(store);

  let signature = '';

  host.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('.doc-discard, summary, .doc-files')) return;
    const path = target.closest<HTMLElement>('.doc')?.dataset.path;
    const doc = path === undefined ? undefined : store.documents.find((item) => item.path === path);
    if (doc) openDocument(store, doc);
  });

  store.watch(['selection', 'agents', 'floors', 'documents'], () => {
    const key = store.selectedKey;
    const agent = key === null ? undefined : store.agents.get(key);
    const floor = agent ? store.floorBySlug(agent.floor) : undefined;
    const kind = floor ? documentKindFor(floor.kind) : null;
    if (kind === null) {
      signature = '';
      host.hidden = true;
      host.replaceChildren();
      return;
    }

    host.hidden = false;
    const documents = store.documents.filter((doc) => doc.kind === kind).sort((a, b) => b.updatedAt - a.updatedAt);
    const next = JSON.stringify([kind, documents]);
    if (next === signature) return;
    signature = next;

    const empty = kind === 'plan' ? 'Sin planes todavía.' : 'Sin skills todavía.';
    host.replaceChildren(
      el(
        'section',
        'panel-card deliverables',
        el(
          'div',
          'panel-summary',
          el('span', 'section-title', kind === 'plan' ? 'Entregables · Planes' : 'Entregables · Skills'),
          el('span', 'chip', String(documents.length)),
        ),
        el(
          'div',
          'panel-card-body',
          documents.length > 0
            ? el('div', 'doc-list', ...documents.map((doc) => card(store, doc)))
            : el('p', 'muted hint', empty),
        ),
      ),
    );
  });
}
