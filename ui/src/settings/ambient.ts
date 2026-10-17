import { DAY_NIGHT_MODES, ambient, type DayNight } from '../ambient';
import { el } from '../dom';
import { t } from '../i18n';
import { toggleRow } from './settings';

// Stateless: rebuilt with the rest of the settings form; it reads the preferences when built.
export function mountAmbientSection(): HTMLElement {
  const prefs = ambient.get();

  const mode = el('select', 'setting-mode');
  mode.setAttribute('aria-label', t('settings.ambient.dayNight.label'));
  for (const value of DAY_NIGHT_MODES) mode.append(new Option(t(`settings.ambient.dayNight.${value}`), value));
  mode.value = prefs.dayNight;
  mode.addEventListener('change', () => ambient.set({ ...ambient.get(), dayNight: mode.value as DayNight }));
  const modeRow = el(
    'label',
    'setting-row',
    el('span', 'setting-text', el('span', 'setting-label', t('settings.ambient.dayNight.label')), el('span', 'setting-hint muted', t('settings.ambient.dayNight.hint'))),
    mode,
  );

  const coffee = toggleRow(t('settings.ambient.coffee'), t('settings.ambient.coffeeHint'));
  coffee.input.checked = prefs.coffee;
  coffee.input.addEventListener('change', () => ambient.set({ ...ambient.get(), coffee: coffee.input.checked }));

  return el(
    'section',
    'settings-section',
    el('h2', 'settings-title', t('settings.ambient.title')),
    el('p', 'settings-hint muted', t('settings.ambient.hint')),
    modeRow,
    coffee.root,
  );
}
