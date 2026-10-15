import type { Actions } from '../actions';
import { el } from '../dom';
import type { Store } from '../store';
import { mountHeader } from './header';
import { mountOrders } from './orders';
import { mountQuestion } from './question-form';
import { mountTimeline } from './timeline';

export function mountPanel(host: HTMLElement, store: Store, actions: Actions): void {
  const header = el('div', 'panel-header');
  const question = el('div', 'panel-question');
  const timeline = el('div', 'panel-timeline');
  const orders = el('div', 'panel-orders');

  host.replaceChildren(header, el('div', 'panel-scroll', question, timeline), orders);

  mountHeader(header, store);
  mountQuestion(question, store, actions);
  mountTimeline(timeline, store);
  mountOrders(orders, store, actions);
}
