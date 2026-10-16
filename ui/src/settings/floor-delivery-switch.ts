import { el } from '../dom';
import { t } from '../i18n';
import { hubTexts } from '../i18n/hub';
import type { SettingsFloor } from '../types';
import type { DeliveryContext } from './floor-delivery';
import { deliverySwitchBody } from './floor-delivery-model';

// Whether the floor works with a card, a branch and a folder per order. Saved at once: it changes how the agents
// of the floor are told to work, not a field of a form.
export function deliverySwitch(floor: SettingsFloor, ctx: Pick<DeliveryContext, 'store' | 'api'>): HTMLElement {
  const input = el('input');
  input.type = 'checkbox';
  input.checked = floor.delivery;
  input.setAttribute('aria-label', t('settings.delivery.enable'));
  const status = el('span', 'settings-status');
  input.addEventListener('change', () => {
    const wanted = input.checked;
    input.disabled = true;
    status.textContent = t('settings.delivery.enable.saving');
    status.className = 'settings-status';
    void ctx.api.saveSettings(deliverySwitchBody(floor.slug, wanted)).then((result) => {
      input.disabled = false;
      const failure = !result.ok ? result.message : !result.data.ok ? hubTexts(result.data.error) : null;
      if (failure !== null) {
        input.checked = !wanted;
        status.textContent = failure;
        status.className = 'settings-status error';
        return;
      }
      status.textContent = '';
      void ctx.api.settings().then((view) => {
        if (view.ok) ctx.store.apply({ type: 'settings', data: view.data });
      });
    });
  });
  return el(
    'label',
    'delivery-switch',
    input,
    el('span', 'setting-text', el('span', 'setting-label', t('settings.delivery.enable')), el('span', 'setting-hint muted', t('settings.delivery.enable.hint'))),
    status,
  );
}
