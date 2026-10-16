import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { panelSection, readSectionOpen, SECTIONS_KEY, storeSectionOpen } from '../src/panel/section';
import { readJson, writeJson } from '../src/prefs';

class FakeElement extends EventTarget {
  className = '';
  textContent = '';
  title = '';
  hidden = false;
  open = false;
  readonly dataset: Record<string, string> = {};
  children: unknown[] = [];
  readonly classList = {
    add: (name: string): void => this.classList.toggle(name, true),
    contains: (name: string): boolean => this.className.split(' ').includes(name),
    toggle: (name: string, on: boolean): void => {
      const names = this.className.split(' ').filter((item) => item !== '' && item !== name);
      if (on) names.push(name);
      this.className = names.join(' ');
    },
  };

  constructor(readonly tagName: string) {
    super();
  }

  append(...nodes: unknown[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: unknown[]): void {
    this.children = nodes;
  }
}

const storage = new Map<string, string>();
let broken = false;
const fakeStorage = {
  getItem: (key: string): string | null => {
    if (broken) throw new Error('blocked');
    return storage.get(key) ?? null;
  },
  setItem: (key: string, value: string): void => {
    if (broken) throw new Error('blocked');
    storage.set(key, value);
  },
};

const saved = { document: Reflect.get(globalThis, 'document'), localStorage: Reflect.get(globalThis, 'localStorage') };

beforeAll(() => {
  Object.assign(globalThis, { document: { createElement: (tag: string) => new FakeElement(tag) }, localStorage: fakeStorage });
});

afterAll(() => {
  Object.assign(globalThis, saved);
});

beforeEach(() => {
  storage.clear();
  broken = false;
});

function make(defaultOpen = false, host?: FakeElement) {
  const section = panelSection({ id: 'report', title: () => 'Informe', defaultOpen, host: host as unknown as HTMLElement });
  const root = section.root as unknown as FakeElement;
  const summary = root.children[0] as FakeElement;
  return { section, root, summary };
}

function userSets(root: FakeElement, open: boolean): void {
  root.open = open;
  root.dispatchEvent(new Event('toggle'));
}

function stored(): unknown {
  return JSON.parse(storage.get(SECTIONS_KEY) ?? 'null');
}

describe('prefs', () => {
  test('readJson and writeJson round-trip and fall back to null', () => {
    writeJson('k', { a: 1 });
    expect(readJson('k')).toEqual({ a: 1 });
    expect(readJson('missing')).toBeNull();
    storage.set('bad', '{nope');
    expect(readJson('bad')).toBeNull();
  });

  test('blocked storage never throws', () => {
    broken = true;
    expect(() => writeJson('k', 1)).not.toThrow();
    expect(readJson('k')).toBeNull();
  });
});

describe('section state', () => {
  test('a missing or malformed entry gives the default', () => {
    expect(readSectionOpen('memory', true)).toBe(true);
    expect(readSectionOpen('memory', false)).toBe(false);
    storage.set(SECTIONS_KEY, JSON.stringify({ memory: 'yes', report: true }));
    expect(readSectionOpen('memory', false)).toBe(false);
    expect(readSectionOpen('report', false)).toBe(true);
    storage.set(SECTIONS_KEY, '[true]');
    expect(readSectionOpen('report', false)).toBe(false);
  });

  test('storing one section keeps the others and drops junk', () => {
    storage.set(SECTIONS_KEY, JSON.stringify({ floors: false, junk: 3 }));
    storeSectionOpen('timeline', true);
    expect(stored()).toEqual({ floors: false, timeline: true });
  });
});

describe('panelSection', () => {
  test('builds the details once with title, hidden meta and the default state', () => {
    const host = new FakeElement('div');
    const { section, root, summary } = make(true, host);
    expect(host.children).toEqual([root]);
    expect(root.tagName).toBe('details');
    expect(root.dataset.id).toBe('report');
    expect(root.open).toBe(true);
    expect(summary.tagName).toBe('summary');
    expect((summary.children[0] as FakeElement).textContent).toBe('Informe');
    expect((summary.children[1] as FakeElement).hidden).toBe(true);
    expect(root.children[1]).toBe(section.body as unknown as FakeElement);
  });

  test('a user toggle persists and the next section starts from it', () => {
    const { root } = make(false);
    userSets(root, true);
    expect(stored()).toEqual({ report: true });
    expect(make(false).root.open).toBe(true);
    userSets(root, false);
    expect(stored()).toEqual({ report: false });
    expect(make(true).root.open).toBe(false);
  });

  test('a toggle event for a programmatic change is ignored', () => {
    const { section, root } = make(false);
    section.setForced(true);
    root.dispatchEvent(new Event('toggle'));
    section.setForced(false);
    root.dispatchEvent(new Event('toggle'));
    expect(storage.has(SECTIONS_KEY)).toBe(false);
  });

  test('a toggle from a nested details does not count', () => {
    const { section, root } = make(false);
    const inner = new FakeElement('details');
    section.body.append(inner as unknown as Node);
    root.open = true;
    const event = new Event('toggle');
    Object.defineProperty(event, 'target', { value: inner });
    root.dispatchEvent(event);
    expect(storage.has(SECTIONS_KEY)).toBe(false);
  });

  test('setForced opens without persisting, blocks the summary and then restores the choice', () => {
    const { section, root, summary } = make(false);
    section.setForced(true);
    expect(root.open).toBe(true);
    expect(root.classList.contains('panel-section-forced')).toBe(true);
    const click = new Event('click', { cancelable: true });
    summary.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(storage.has(SECTIONS_KEY)).toBe(false);
    section.setForced(false);
    expect(root.open).toBe(false);
    expect(root.classList.contains('panel-section-forced')).toBe(false);
    const free = new Event('click', { cancelable: true });
    summary.dispatchEvent(free);
    expect(free.defaultPrevented).toBe(false);
  });

  test('releasing a section that was never forced leaves it alone', () => {
    const { section, root } = make(true);
    section.setForced(false);
    expect(root.open).toBe(true);
  });

  test('setMeta shows text with a tooltip, a node, or hides on null', () => {
    const { section, summary } = make();
    const meta = summary.children[1] as FakeElement;
    section.setMeta('3 agentes');
    expect(meta.hidden).toBe(false);
    expect(meta.children).toEqual(['3 agentes']);
    expect(meta.title).toBe('3 agentes');
    const chip = new FakeElement('span');
    section.setMeta(chip as unknown as Node);
    expect(meta.children).toEqual([chip]);
    expect(meta.title).toBe('');
    section.setMeta(null);
    expect(meta.hidden).toBe(true);
    expect(meta.children).toEqual([]);
  });

  test('setTitle re-reads the title', () => {
    let title = 'Memoria';
    const section = panelSection({ id: 'memory', title: () => title, defaultOpen: false });
    const heading = ((section.root as unknown as FakeElement).children[0] as FakeElement).children[0] as FakeElement;
    expect(heading.textContent).toBe('Memoria');
    title = 'Memory';
    section.setTitle();
    expect(heading.textContent).toBe('Memory');
  });

  test('blocked storage still builds and toggles the section', () => {
    broken = true;
    const { section, root } = make(true);
    expect(root.open).toBe(true);
    expect(() => userSets(root, false)).not.toThrow();
    section.setForced(true);
    section.setForced(false);
    expect(root.open).toBe(false);
  });
});
