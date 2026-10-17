export type Child = Node | string | null | undefined | false;

export function append(parent: Element | DocumentFragment, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child);
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  append(node, children);
  return node;
}

export function button(label: string, className = '', title = ''): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  if (title) node.title = title;
  return node;
}

export function setStateColor(node: HTMLElement, color: string): void {
  node.style.setProperty('--c', color);
}

// Runs a render that replaces the children of a container and keeps the keyboard focus on the same row,
// the one with the same data-key, when it was inside.
export function keepFocus(container: HTMLElement, render: () => void): void {
  const active = document.activeElement;
  const key = active instanceof HTMLElement && container.contains(active) ? (active.closest<HTMLElement>('[data-key]')?.dataset.key ?? null) : null;
  render();
  if (key === null) return;
  for (const row of container.querySelectorAll<HTMLElement>('[data-key]')) {
    if (row.dataset.key === key && row.tabIndex >= 0) {
      row.focus({ preventScroll: true });
      return;
    }
  }
}
