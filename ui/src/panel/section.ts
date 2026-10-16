import { el } from '../dom';
import { readJson, writeJson } from '../prefs';

export const SECTIONS_KEY = 'agent-office.panel.sections';

export type SectionId = 'floors' | 'now' | 'question' | 'deliverables' | 'report' | 'memory' | 'timeline' | 'orders';

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
  defaultOpen: boolean;
  host?: HTMLElement;
};

function storedSections(): Record<string, boolean> {
  const raw = readJson(SECTIONS_KEY);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const sections: Record<string, boolean> = {};
  for (const [id, open] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof open === 'boolean') sections[id] = open;
  }
  return sections;
}

export function readSectionOpen(id: SectionId, defaultOpen: boolean): boolean {
  return storedSections()[id] ?? defaultOpen;
}

export function storeSectionOpen(id: SectionId, open: boolean): void {
  writeJson(SECTIONS_KEY, { ...storedSections(), [id]: open });
}

export function panelSection({ id, title, defaultOpen, host }: SectionOptions): PanelSection {
  const heading = el('span', 'section-title');
  const meta = el('span', 'panel-section-meta');
  meta.hidden = true;
  const summary = el('summary', 'panel-summary', heading, meta);
  const body = el('div', 'panel-card-body');
  const root = el('details', 'panel-card panel-section', summary, body);
  root.dataset.id = id;

  let chosen = readSectionOpen(id, defaultOpen);
  let forced = false;

  const show = (open: boolean): void => {
    root.dataset.shown = open ? '1' : '0';
    root.open = open;
  };
  show(chosen);

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
      storeSectionOpen(id, chosen);
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
