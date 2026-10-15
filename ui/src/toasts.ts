import { el } from './dom';
import type { Store } from './store';

export function mountToasts(host: HTMLElement, store: Store): void {
  const nodes = new Map<number, HTMLElement>();

  store.watch(['toasts'], () => {
    const live = new Set(store.toasts.map((toast) => toast.id));
    for (const [id, node] of nodes) {
      if (live.has(id)) continue;
      node.remove();
      nodes.delete(id);
    }
    for (const toast of store.toasts) {
      if (nodes.has(toast.id)) continue;
      const node = el('div', `toast toast-${toast.kind}`, toast.text);
      node.addEventListener('click', () => store.dismissToast(toast.id));
      nodes.set(toast.id, node);
      host.append(node);
    }
  });
}
