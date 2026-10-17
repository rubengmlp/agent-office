import { el } from '../dom';
import { readJson, writeJson } from '../prefs';

export const OPEN_SECTION_KEY = 'agent-office.panel.open';

export type SectionId = 'floors' | 'now' | 'question' | 'deliverables' | 'report' | 'memory' | 'timeline' | 'orders';

export const DEFAULT_SECTION: SectionId = 'now';

const SECTION_IDS: ReadonlySet<string> = new Set<SectionId>(['floors', 'now', 'question', 'deliverables', 'report', 'memory', 'timeline', 'orders']);

export type PanelSection = {
  root: HTMLDetailsElement;
  body: HTMLDivElement;
  setTitle(): void;
  setMeta(meta: Node | string | null): void;
  setForced(open: boolean): void;
};

export type SectionOptions = {
  id: SectionId;
  title: () => string;
  host?: HTMLElement;
};

type LiveSection = { id: SectionId; root: HTMLElement; choose(open: boolean): void };

const live = new Set<LiveSection>();

export function readOpenSection(): SectionId | null {
  const raw = readJson(OPEN_SECTION_KEY);
  if (raw === null) return DEFAULT_SECTION;
  if (raw === '') return null;
  return typeof raw === 'string' && SECTION_IDS.has(raw) ? (raw as SectionId) : DEFAULT_SECTION;
}

export function storeOpenSection(id: SectionId | null): void {
  writeJson(OPEN_SECTION_KEY, id ?? '');
}

// Opens one section of the panel, closing the others, and brings it into view.
export function openSection(id: SectionId): void {
  let target: LiveSection | undefined;
  for (const section of live) {
    section.choose(section.id === id);
    if (section.id === id) target = section;
  }
  if (target) {
    storeOpenSection(id);
    target.root.scrollIntoView?.({ block: 'nearest' });
  }
}

export function panelSection({ id, title, host }: SectionOptions): PanelSection {
  const heading = el('span', 'section-title');
  const meta = el('span', 'panel-section-meta');
  meta.hidden = true;
  const summary = el('summary', 'panel-summary', heading, meta);
  const body = el('div', 'panel-card-body');
  const root = el('details', 'panel-card panel-section', summary, body);
  root.dataset.id = id;

  let chosen = readOpenSection() === id;
  let forced = false;

  const show = (open: boolean): void => {
    root.dataset.shown = open ? '1' : '0';
    root.open = open;
  };
  show(chosen);
  live.add({
    id,
    root,
    choose(open: boolean): void {
      chosen = open;
      show(forced || open);
    },
  });

  summary.addEventListener('click', (event) => {
    if (forced) event.preventDefault();
  });

  root.addEventListener(
    'toggle',
    (event) => {
      if (event.target !== root || root.open === (root.dataset.shown === '1')) return;
      root.dataset.shown = root.open ? '1' : '0';
      if (forced) return;
      chosen = root.open;
      storeOpenSection(chosen ? id : null);
      if (!chosen) return;
      for (const other of live) if (other.id !== id) other.choose(false);
    },
    true,
  );

  const setTitle = (): void => {
    heading.textContent = title();
  };
  setTitle();
  host?.append(root);

  return {
    root,
    body,
    setTitle,
    setMeta(next: Node | string | null): void {
      if (next === null || next === '') {
        meta.hidden = true;
        meta.title = '';
        meta.replaceChildren();
        return;
      }
      meta.hidden = false;
      meta.title = typeof next === 'string' ? next : '';
      meta.replaceChildren(next);
    },
    setForced(open: boolean): void {
      if (open === forced) return;
      forced = open;
      root.classList.toggle('panel-section-forced', open);
      show(open || chosen);
    },
  };
}
