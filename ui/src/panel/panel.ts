import type { Actions } from '../actions';
import type { OfficeApi } from '../api';
import { el } from '../dom';
import type { Store } from '../store';
import { mountDeliverables } from './deliverables';
import { mountFloors } from './floors';
import { mountHeader } from './header';
import { mountMemory } from './memory';
import { mountNow } from './now';
import { mountOrders } from './orders';
import { mountQuestion } from './question-form';
import { mountReport } from './report';
import { mountTimeline } from './timeline';

export function mountPanel(host: HTMLElement, store: Store, actions: Actions, api: OfficeApi | null): void {
  const floors = el('div', 'panel-floors');
  const header = el('div', 'panel-header');
  const now = el('div', 'panel-now');
  const question = el('div', 'panel-question');
  const deliverables = el('div', 'panel-deliverables');
  const report = el('div', 'panel-report');
  const memory = el('div', 'panel-memory');
  const timeline = el('div', 'panel-timeline');
  const orders = el('div', 'panel-orders');

  host.replaceChildren(floors, header, el('div', 'panel-scroll', now, question, deliverables, report, memory, timeline), orders);

  mountFloors(floors, store);
  mountHeader(header, store);
  mountNow(now, store);
  mountQuestion(question, store, actions);
  mountDeliverables(deliverables, store, api);
  mountReport(report, store, api);
  mountMemory(memory, store, api);
  mountTimeline(timeline, store);
  mountOrders(orders, store, actions);
}
