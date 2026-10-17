import { button, el } from '../dom';
import { t } from '../i18n';
import { SOUND_EVENTS, clampVolume, type SoundDesk } from '../sound';
import { toggleRow } from './settings';

// Stateless: rebuilt with the rest of the settings form; it reads the desk when built.
export function mountSoundSection(desk: SoundDesk): HTMLElement {
  const general = toggleRow(t('settings.sound.enable'), t('settings.sound.enableHint'));
  general.input.checked = desk.preferences.enabled;
  const events = SOUND_EVENTS.map((event) => {
    const row = toggleRow(t(`settings.sound.event.${event}`), '');
    row.input.checked = desk.preferences.events[event];
    row.input.addEventListener('change', () => {
      const prefs = desk.preferences;
      prefs.events[event] = row.input.checked;
      desk.save(prefs);
    });
    return row;
  });
  const volume = el('input', 'setting-range');
  const sync = (): void => {
    const on = desk.preferences.enabled;
    for (const row of events) row.input.disabled = !on;
  };
  general.input.addEventListener('change', () => {
    desk.save({ ...desk.preferences, enabled: general.input.checked });
    sync();
  });

  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  volume.value = String(desk.preferences.volume);
  volume.setAttribute('aria-label', t('settings.sound.volume'));
  volume.addEventListener('change', () => {
    desk.save({ ...desk.preferences, volume: clampVolume(Number(volume.value)) });
  });
  const volumeRow = el('label', 'setting-row', el('span', 'setting-text', el('span', 'setting-label', t('settings.sound.volume'))), volume);

  const test = button(t('settings.sound.test'));
  test.addEventListener('click', () => desk.test());

  sync();
  return el(
    'section',
    'settings-section',
    el('h2', 'settings-title', t('settings.sound.title')),
    el('p', 'settings-hint muted', t('settings.sound.hint')),
    general.root,
    volumeRow,
    el('div', 'notify-events', ...events.map((row) => row.root)),
    el('div', 'notify-actions', test),
  );
}
