import type { Actions } from '../actions';
import type { OfficeApi } from '../api';
import { el } from '../dom';
import type { Store } from '../store';
import { mountDeliverables } from './deliverables';
import { mountHeader } from './header';
import { mountMemory } from './memory';
import { mountOrders } from './orders';
import { mountQuestion } from './question-form';
import { mountReport } from './report';
import { mountTimeline } from './timeline';

export function mountPanel(host: HTMLElement, store: Store, actions: Actions, api: OfficeApi | null): void {
  const header = el('div', 'panel-header');
  const question = el('div', 'panel-question');
  const deliverables = el('div', 'panel-deliverables');
  const report = el('div', 'panel-report');
  const memory = el('div', 'panel-memory');
  const timeline = el('div', 'panel-timeline');
  const orders = el('div', 'panel-orders');

  host.replaceChildren(header, el('div', 'panel-scroll', question, deliverables, report, memory, timeline), orders);

  mountHeader(header, store);
  mountQuestion(question, store, actions);
  mountDeliverables(deliverables, store, api);
  mountReport(report, store, api);
  mountMemory(memory, store, api);
  mountTimeline(timeline, store);
  mountOrders(orders, store, actions);
}
