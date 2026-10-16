import { button, el } from './dom';
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
      const node = el('div', `toast toast-${toast.kind}`, el('span', 'toast-text', toast.text));
      node.addEventListener('click', () => store.dismissToast(toast.id));
      const { action } = toast;
      if (action) {
        const undo = button(action.label, 'toast-action');
        undo.addEventListener('click', () => {
          store.dismissToast(toast.id);
          action.run();
        });
        node.append(undo);
      }
      nodes.set(toast.id, node);
      host.append(node);
    }
  });
}
