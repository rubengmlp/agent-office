import type { OfficeApi } from '../api';
import { button, el } from '../dom';
import { t } from '../i18n';
import { hubTexts } from '../i18n/hub';
import type { Store } from '../store';
import type { GateMode, SettingsFloor } from '../types';
import { MAX_CHECKS, automaticGate, draftOf, problemsOf, updateOf, type FloorDeliveryDraft, type SetupMode } from './floor-delivery-model';

export type DeliveryContext = {
  store: Store;
  api: OfficeApi;
  // What the user is typing survives the list being drawn again when the hub sends new settings.
  drafts: Map<string, FloorDeliveryDraft>;
  open: Set<string>;
};

const GATE_MODES: readonly GateMode[] = ['checks', 'checks+tester', 'tester'];

function field(label: string, hint: string, control: HTMLElement): HTMLElement {
  return el('label', 'delivery-field', el('span', 'setting-label', label), el('span', 'setting-hint muted', hint), control);
}

function textInput(value: string, label: string, placeholder = ''): HTMLInputElement {
  const input = el('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', label);
  return input;
}

function select(options: readonly [string, string][], value: string, label: string): HTMLSelectElement {
  const node = el('select');
  node.setAttribute('aria-label', label);
  for (const [optionValue, text] of options) node.append(new Option(text, optionValue));
  node.value = value;
  return node;
}

// What a floor runs to check an order, how it prepares a folder and which gate a HECHO goes through.
export function deliveryEditor(floor: SettingsFloor, ctx: DeliveryContext): HTMLElement {
  const draft = ctx.drafts.get(floor.slug) ?? draftOf(floor);
  ctx.drafts.set(floor.slug, draft);
  const defaults = floor.checks.mode === 'default' ? floor.checks.list : [];
  const status = el('p', 'settings-status');
  const save = button(t('settings.delivery.save'), 'primary');
  const reset = button(t('settings.delivery.reset'));
  const body = el('div', 'delivery-body');
  let saving = false;
  let outcome: { text: string; kind: 'ok' | 'error' } | null = null;

  const refresh = (): void => {
    const problems = problemsOf(draft);
    const update = updateOf(floor, draft);
    save.disabled = saving || update === null || problems.size > 0;
    reset.disabled = saving || update === null;
    status.textContent = outcome ? outcome.text : problems.size > 0 ? t(`settings.delivery.problem.${[...problems][0] ?? 'checks'}`) : update ? t('settings.unsaved') : '';
    status.className = outcome ? `settings-status ${outcome.kind}` : problems.size > 0 ? 'settings-status error' : 'settings-status';
  };

  const edited = (): void => {
    outcome = null;
    refresh();
  };

  const checksBlock = (): HTMLElement => {
    const mode = select(
      [
        ['default', t('settings.delivery.checks.default')],
        ['custom', t('settings.delivery.checks.custom')],
      ],
      draft.checksMode,
      t('settings.delivery.checks'),
    );
    const list = el('div', 'delivery-checks');
    const paint = (): void => {
      const rows =
        draft.checksMode === 'default'
          ? floor.checks.mode === 'default'
            ? floor.checks.list
            : []
          : draft.checks;
      const readOnly = draft.checksMode === 'default';
      list.replaceChildren(
        ...rows.map((check, index): Node => {
          const name = textInput(check.name, t('settings.delivery.check.name'), 'test');
          const command = textInput(check.command, t('settings.delivery.check.command'), 'bun run test');
          name.disabled = readOnly;
          command.disabled = readOnly;
          name.addEventListener('input', () => {
            if (draft.checks[index]) draft.checks[index].name = name.value.trim();
            edited();
          });
          command.addEventListener('input', () => {
            if (draft.checks[index]) draft.checks[index].command = command.value;
            edited();
          });
          const remove = button('×', 'delivery-remove');
          remove.setAttribute('aria-label', t('settings.delivery.check.remove', { name: check.name || '…' }));
          remove.hidden = readOnly;
          remove.addEventListener('click', () => {
            draft.checks.splice(index, 1);
            paint();
            edited();
          });
          return el('div', 'delivery-check', name, command, remove);
        }),
        ...(readOnly && rows.length === 0 ? [el('p', 'muted', t('settings.delivery.checks.none'))] : []),
      );
      if (!readOnly) {
        const add = button(t('settings.delivery.check.add'));
        add.disabled = draft.checks.length >= MAX_CHECKS;
        add.addEventListener('click', () => {
          draft.checks.push({ name: '', command: '' });
          paint();
          edited();
        });
        list.append(add);
      }
    };
    mode.addEventListener('change', () => {
      draft.checksMode = mode.value as 'default' | 'custom';
      if (draft.checksMode === 'custom' && draft.checks.length === 0) draft.checks = floor.checks.list.map((check) => ({ ...check }));
      paint();
      gateHint();
      edited();
    });
    paint();
    return field(t('settings.delivery.checks'), t('settings.delivery.checks.hint'), el('div', 'delivery-block', mode, list));
  };

  const setupMode = select(
    [
      ['default', t('settings.delivery.setup.default')],
      ['none', t('settings.delivery.setup.none')],
      ['custom', t('settings.delivery.setup.custom')],
    ],
    draft.setupMode,
    t('settings.delivery.setup'),
  );
  const setupCommand = textInput(draft.setupMode === 'default' ? (floor.setup.command ?? '') : draft.setup, t('settings.delivery.setup'), 'bun install');
  const syncSetup = (): void => {
    setupCommand.disabled = draft.setupMode !== 'custom';
    if (draft.setupMode === 'default') setupCommand.value = floor.setup.mode === 'default' ? (floor.setup.command ?? '') : '';
    else if (draft.setupMode === 'none') setupCommand.value = '';
    else setupCommand.value = draft.setup;
  };
  setupMode.addEventListener('change', () => {
    draft.setupMode = setupMode.value as SetupMode;
    syncSetup();
    edited();
  });
  setupCommand.addEventListener('input', () => {
    draft.setup = setupCommand.value;
    edited();
  });
  syncSetup();

  const gate = select(
    [['', t('settings.delivery.gate.auto')], ...GATE_MODES.map((mode): [string, string] => [mode, t(`settings.delivery.gate.${mode}`)])],
    draft.gateMode,
    t('settings.delivery.gate'),
  );
  const gateNote = el('span', 'setting-hint muted');
  function gateHint(): void {
    gateNote.textContent = draft.gateMode === '' ? t('settings.delivery.gate.autoIs', { mode: t(`settings.delivery.gate.${automaticGate(draft, defaults)}`) }) : t(`settings.delivery.gate.hint.${draft.gateMode}`);
  }
  gate.addEventListener('change', () => {
    draft.gateMode = gate.value as GateMode | '';
    gateHint();
    edited();
  });
  gateHint();

  const linkDirs = textInput(draft.linkDirs, t('settings.delivery.linkDirs'), 'node_modules, vendor');
  linkDirs.addEventListener('input', () => {
    draft.linkDirs = linkDirs.value;
    edited();
  });
  const checkFiles = textInput(draft.checkFiles, t('settings.delivery.checkFiles'), 'build.yaml, Makefile');
  checkFiles.addEventListener('input', () => {
    draft.checkFiles = checkFiles.value;
    edited();
  });

  body.append(
    checksBlock(),
    field(t('settings.delivery.setup'), t('settings.delivery.setup.hint'), el('div', 'delivery-block', setupMode, setupCommand)),
    el('label', 'delivery-field', el('span', 'setting-label', t('settings.delivery.gate')), gateNote, gate),
    field(t('settings.delivery.linkDirs'), t('settings.delivery.linkDirs.hint'), linkDirs),
    field(
      t('settings.delivery.checkFiles'),
      floor.profileCheckFiles.length > 0 ? t('settings.delivery.checkFiles.hint', { files: floor.profileCheckFiles.join(', ') }) : t('settings.delivery.checkFiles.hintNone'),
      checkFiles,
    ),
    el('div', 'delivery-actions', save, reset, status),
  );

  save.addEventListener('click', () => {
    const update = updateOf(floor, draft);
    if (!update || saving) return;
    saving = true;
    outcome = null;
    refresh();
    void ctx.api.saveSettings({ floors: { [floor.slug]: update } }).then((result) => {
      saving = false;
      if (!result.ok) outcome = { text: result.message, kind: 'error' };
      else if (!result.data.ok) outcome = { text: hubTexts(result.data.error), kind: 'error' };
      else {
        ctx.drafts.delete(floor.slug);
        outcome = { text: hubTexts(result.data.note), kind: 'ok' };
        void ctx.api.settings().then((view) => {
          if (view.ok) ctx.store.apply({ type: 'settings', data: view.data });
        });
      }
      refresh();
    });
  });
  reset.addEventListener('click', () => {
    ctx.drafts.set(floor.slug, draftOf(floor));
    const fresh = deliveryEditor(floor, ctx);
    root.replaceWith(fresh);
  });

  const effective = el('span', 'chip', t(`settings.delivery.gate.${floor.effectiveGateMode}`));
  const root = el('details', 'floor-delivery', el('summary', '', t('settings.delivery.title'), ' ', effective), body);
  root.open = ctx.open.has(floor.slug);
  root.addEventListener('toggle', () => {
    if (root.open) ctx.open.add(floor.slug);
    else ctx.open.delete(floor.slug);
  });
  refresh();
  return root;
}
