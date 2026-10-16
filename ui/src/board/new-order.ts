import type { OfficeApi } from '../api';
import { button, el } from '../dom';
import { t } from '../i18n';
import type { Store } from '../store';
import type { OrderView } from '../types';
import { deliveryFloors } from './columns';

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 2000;

// The form of a new order: the floor, what it is, where to branch from, and whether the lead is briefed
// straight or through the director.
export function openNewOrder(host: HTMLElement, store: Store, api: OfficeApi, preset: string | null, onCreated: (order: OrderView) => void): void {
  const floors = deliveryFloors(store.floorList());
  const floor = el('select', 'new-order-floor');
  floor.setAttribute('aria-label', t('board.form.floor'));
  for (const slug of floors) floor.append(new Option(slug, slug));
  floor.value = preset !== null && floors.includes(preset) ? preset : (floors[0] ?? '');
  const title = el('input', 'new-order-title');
  title.type = 'text';
  title.maxLength = MAX_TITLE;
  title.placeholder = t('board.form.titlePlaceholder');
  title.setAttribute('aria-label', t('board.form.title'));
  const description = el('textarea', 'new-order-description');
  description.rows = 4;
  description.maxLength = MAX_DESCRIPTION;
  description.placeholder = t('board.form.descriptionPlaceholder');
  description.setAttribute('aria-label', t('board.form.description'));
  const base = el('input', 'new-order-base');
  base.type = 'text';
  base.placeholder = t('board.form.basePlaceholder');
  base.spellcheck = false;
  base.setAttribute('aria-label', t('board.form.base'));
  const via = (value: 'lead' | 'director', checked: boolean): { input: HTMLInputElement; label: HTMLElement } => {
    const input = el('input');
    input.type = 'radio';
    input.name = 'new-order-via';
    input.value = value;
    input.checked = checked;
    return { input, label: el('label', 'new-order-via', input, el('span', '', el('b', '', t(`board.form.via.${value}`)), el('span', 'muted', ` ${t(`board.form.via.${value}.hint`)}`))) };
  };
  const lead = via('lead', true);
  const director = via('director', false);
  const status = el('p', 'new-order-status');
  const create = button(t('board.form.create'), 'primary');
  const cancel = button(t('board.form.cancel'));
  const form = el(
    'form',
    'new-order',
    el('h3', 'new-order-heading', t('board.form.heading')),
    el('label', 'new-order-field', el('span', '', t('board.form.floor')), floor),
    el('label', 'new-order-field', el('span', '', t('board.form.title')), title),
    el('label', 'new-order-field', el('span', '', t('board.form.description')), description),
    el('label', 'new-order-field', el('span', '', t('board.form.base')), base),
    el('div', 'new-order-vias', lead.label, director.label),
    status,
    el('div', 'new-order-actions', cancel, create),
  );
  const backdrop = el('div', 'dialog-backdrop', form);
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', t('board.form.heading'));

  const close = (): void => backdrop.remove();
  const refresh = (): void => {
    create.disabled = floor.value === '' || title.value.trim() === '';
  };
  let busy = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy || create.disabled) return;
    busy = true;
    create.disabled = true;
    status.textContent = t('board.form.creating');
    status.className = 'new-order-status';
    void api
      .createOrder({
        floor: floor.value,
        title: title.value.trim(),
        ...(description.value.trim() ? { description: description.value.trim() } : {}),
        ...(base.value.trim() ? { base: base.value.trim() } : {}),
        via: director.input.checked ? 'director' : 'lead',
      })
      .then((result) => {
        busy = false;
        if (!result.ok) {
          status.textContent = result.message;
          status.className = 'new-order-status error';
          refresh();
          return;
        }
        close();
        store.toast(t('board.form.created', { title: result.data.order.title }), 'ok');
        onCreated(result.data.order);
      });
  });
  cancel.addEventListener('click', close);
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  title.addEventListener('input', refresh);
  floor.addEventListener('change', refresh);
  refresh();
  host.append(backdrop);
  title.focus();
}
