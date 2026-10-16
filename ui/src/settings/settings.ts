import type { OfficeApi } from '../api';
import { button, el, type Child } from '../dom';
import { plural, t } from '../i18n';
import { hubTexts } from '../i18n/hub';
import { roleHint, stackLabel } from '../labels';
import type { Notifier } from '../notify';
import type { Store } from '../store';
import type { DepartmentsConfig, Effort, PermissionMode, RoleId, SettingsView } from '../types';
import {
  applyUpdate,
  branchProblemKey,
  diffDraft,
  draftFrom,
  isEmptyUpdate,
  managedFloors,
  reconcileDraft,
  roleProblemKey,
  sameDraft,
  validateDraft,
  type Problems,
  type SettingsDraft,
} from './draft';
import {
  DEPARTMENT_ROWS,
  EFFORTS,
  MEMORY_FIELDS,
  MODEL_OPTIONS,
  OTHER_MODEL,
  REVIEW_FIELDS,
  ROLE_ROWS,
  PERMISSION_MODE_OPTIONS,
  permissionTargetHint,
  permissionTargetLabel,
  type NumberField,
  type NumberKey,
} from './options';
import { mountNotifySection } from './notifications';
import { mountProjects } from './projects';

type Outcome = { text: string; kind: 'ok' | 'error' };

type RoleControls = { model: HTMLSelectElement; custom: HTMLInputElement; effort: HTMLSelectElement };

type Controls = {
  root: HTMLElement;
  fieldset: HTMLFieldSetElement;
  roles: Map<RoleId, RoleControls>;
  departments: Map<keyof DepartmentsConfig, HTMLInputElement>;
  numbers: Map<NumberKey, HTMLInputElement>;
  branches: Map<string, HTMLInputElement>;
  modes: Map<string, HTMLSelectElement>;
};

function option(value: string, label: string): HTMLOptionElement {
  const node = el('option', '', label);
  node.value = value;
  return node;
}

function textInput(className: string, label: string, placeholder: string): HTMLInputElement {
  const input = el('input', className);
  input.type = 'text';
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', label);
  return input;
}

function markInvalid(input: HTMLInputElement, invalid: boolean): void {
  input.classList.toggle('invalid', invalid);
  input.setAttribute('aria-invalid', String(invalid));
}

function setValue(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  if (control.value !== value) control.value = value;
}

function section(title: string, hint: string, ...body: Child[]): HTMLElement {
  return el(
    'section',
    'settings-section',
    el('h2', 'settings-title', title),
    el('p', 'settings-hint muted', hint),
    ...body,
  );
}

export function toggleRow(label: string, hint: string): { root: HTMLElement; input: HTMLInputElement } {
  const input = el('input');
  input.type = 'checkbox';
  const root = el(
    'label',
    'switch',
    input,
    el('span', 'switch-track'),
    el('span', 'switch-text', el('span', 'switch-label', label), el('span', 'switch-hint muted', hint)),
  );
  return { root, input };
}

function numberRow(field: NumberField): { root: HTMLElement; input: HTMLInputElement } {
  const input = el('input', 'setting-number');
  input.type = 'number';
  input.min = String(field.min);
  input.max = String(field.max);
  input.step = '1';
  const root = el(
    'label',
    'setting-row',
    el('span', 'setting-text', el('span', 'setting-label', t(field.labelKey)), el('span', 'setting-hint muted', t(field.hintKey))),
    input,
  );
  return { root, input };
}

function readonlyRow(label: string, hint: string, value: string): HTMLElement {
  return el(
    'div',
    'setting-row',
    el('span', 'setting-text', el('span', 'setting-label', label), el('span', 'setting-hint muted', hint)),
    el('code', 'setting-value', value),
  );
}

function outcomeText(note: string, regenerated: number): string {
  const text = note.trim() || t('settings.saved');
  if (regenerated <= 0) return text;
  return `${text} (${plural('settings.regenerated', regenerated)})`;
}

class SettingsPage {
  private baseline: SettingsView | null = null;
  private draft: SettingsDraft | null = null;
  private controls: Controls | null = null;
  private signature = '';
  private loadError = '';
  private loadSeq = 0;
  private saving = false;
  private outcome: Outcome | null = null;

  private readonly notice = el('p', 'settings-notice');
  private readonly content = el('div', 'settings-content');
  private readonly saveButton = button('', 'primary');
  private readonly status = el('span', 'settings-status');
  private readonly actions = el('div', 'settings-actions', this.saveButton, this.status);
  private readonly projectsHost = el('div', 'settings-projects');

  constructor(
    private readonly host: HTMLElement,
    private readonly store: Store,
    private readonly api: OfficeApi | null,
    private readonly notifier: Notifier | null,
  ) {}

  start(): void {
    this.saveButton.addEventListener('click', () => void this.submit());
    this.host.replaceChildren(el('div', 'settings', this.notice, this.content, this.actions));
    mountProjects(this.projectsHost, this.store, this.api);
    this.store.watch(['settings'], () => {
      if (this.store.settings) this.accept(this.store.settings);
    });
    this.store.watch(['mode'], () => this.render());
    this.store.watch(['lang'], () => {
      this.signature = '';
      this.outcome = null;
      this.render();
    });
    this.store.watch(['connection'], () => {
      if (this.store.connection === 'online') void this.load();
    });
    this.render();
    void this.load();
  }

  private async load(): Promise<void> {
    const { api, store } = this;
    if (!api) return;
    const ticket = ++this.loadSeq;
    const seen = store.settings;
    if (!this.baseline) {
      this.loadError = '';
      this.render();
    }
    const result = await api.settings();
    if (ticket !== this.loadSeq) return;
    if (!result.ok) {
      if (!this.baseline) this.loadError = result.message;
      this.render();
      return;
    }
    if (store.settings !== seen) return;
    store.apply({ type: 'settings', data: result.data });
  }

  private accept(view: SettingsView): void {
    const previous = this.baseline;
    const pristine = previous === null || this.draft === null || sameDraft(draftFrom(previous), this.draft);
    this.baseline = view;
    this.loadError = '';
    this.draft = pristine || this.draft === null ? draftFrom(view) : reconcileDraft(this.draft, view);
    this.render();
  }

  private render(): void {
    const view = this.baseline;
    if (this.api === null) {
      this.notice.textContent = this.store.replay ? t('settings.replay') : t('settings.offline');
    }
    this.notice.hidden = this.api !== null;

    if (view === null) {
      this.controls = null;
      this.signature = '';
      this.actions.hidden = true;
      this.content.replaceChildren(...this.placeholder());
      return;
    }

    this.actions.hidden = false;
    const floors = managedFloors(view).map((floor) => [floor.slug, floor.path, floor.stack]);
    const signature = JSON.stringify([view.docsRepo, view.port, floors, Object.keys(view.permissionModes)]);
    if (this.controls === null || signature !== this.signature) {
      this.signature = signature;
      this.controls = this.buildControls(view);
      this.content.replaceChildren(this.controls.root);
    }
    this.syncControls();
    this.refresh();
  }

  private placeholder(): HTMLElement[] {
    if (this.api === null) return [];
    // Desktop notifications live in the browser: they can be turned off even when the hub settings do not load.
    const notify = this.notifier ? [mountNotifySection(this.notifier)] : [];
    if (!this.loadError) return [el('p', 'placeholder', t('settings.loading')), ...notify];
    const retry = button(t('settings.retry'));
    retry.addEventListener('click', () => void this.load());
    return [
      el('p', 'placeholder', t('settings.loadFailed', { error: this.loadError })),
      el('div', 'settings-retry', retry),
      ...notify,
    ];
  }

  private buildControls(view: SettingsView): Controls {
    const roles = new Map<RoleId, RoleControls>();
    const departments = new Map<keyof DepartmentsConfig, HTMLInputElement>();
    const numbers = new Map<NumberKey, HTMLInputElement>();
    const branches = new Map<string, HTMLInputElement>();
    const modes = new Map<string, HTMLSelectElement>();

    const rolesHelp = t('settings.roles.help');
    const modelHead = el('span', 'role-head muted', t('settings.col.model'));
    modelHead.title = rolesHelp;
    const effortHead = el('span', 'role-head muted', t('settings.col.effort'));
    effortHead.title = rolesHelp;
    const roleGrid = el('div', 'role-grid', el('span', 'role-head muted', t('settings.col.role')), modelHead, effortHead);
    for (const { id, kind, labelKey } of ROLE_ROWS) {
      const label = t(labelKey);
      const model = el('select', 'role-model');
      model.setAttribute('aria-label', t('settings.aria.model', { role: label }));
      model.append(...MODEL_OPTIONS.map((entry) => option(entry.value, 'labelKey' in entry ? t(entry.labelKey) : entry.label)));
      const custom = textInput('role-custom', t('settings.aria.customModel', { role: label }), t('settings.customPlaceholder'));
      const effort = el('select', 'role-effort');
      effort.setAttribute('aria-label', t('settings.aria.effort', { role: label }));
      effort.append(...EFFORTS.map((value) => option(value, value)));

      model.addEventListener('change', () => {
        this.edit((draft) => {
          draft.roles[id].choice = model.value;
        });
        if (model.value === OTHER_MODEL) custom.focus();
      });
      custom.addEventListener('input', () => {
        this.edit((draft) => {
          draft.roles[id].custom = custom.value;
        });
      });
      effort.addEventListener('change', () => {
        this.edit((draft) => {
          draft.roles[id].effort = effort.value as Effort;
        });
      });

      roleGrid.append(
        el('div', 'role-name-cell', el('span', 'role-name', label), el('span', 'setting-hint muted', roleHint(kind))),
        el('div', 'role-model-cell', model, custom),
        effort,
      );
      roles.set(id, { model, custom, effort });
    }

    const departmentRows = DEPARTMENT_ROWS.map(({ key, labelKey, hintKey }) => {
      const row = toggleRow(t(labelKey), t(hintKey));
      row.input.addEventListener('change', () => {
        this.edit((draft) => {
          draft.departments[key] = row.input.checked;
        });
      });
      departments.set(key, row.input);
      return row.root;
    });

    const numberRows = (fields: readonly NumberField[]): HTMLElement[] =>
      fields.map((field) => {
        const row = numberRow(field);
        row.input.addEventListener('input', () => {
          this.edit((draft) => {
            draft.numbers[field.key] = row.input.value;
          });
        });
        numbers.set(field.key, row.input);
        return row.root;
      });

    const floorRows = managedFloors(view).map((floor) => {
      const input = textInput('setting-branch', t('settings.aria.branch', { slug: floor.slug }), 'develop');
      input.addEventListener('input', () => {
        this.edit((draft) => {
          draft.branches[floor.slug] = input.value;
        });
      });
      branches.set(floor.slug, input);
      return el(
        'label',
        'setting-row',
        el(
          'span',
          'setting-text',
          el('span', 'setting-label', floor.slug, el('span', 'chip', stackLabel(floor.stack))),
          el('code', 'setting-path muted', floor.path),
          el('span', 'setting-hint muted', t('settings.floor.hint')),
        ),
        input,
      );
    });

    const modeRows = Object.keys(view.permissionModes).map((slug) => {
      const label = permissionTargetLabel(slug);
      const select = el('select', 'setting-mode');
      select.setAttribute('aria-label', t('settings.aria.mode', { target: label }));
      select.append(...PERMISSION_MODE_OPTIONS.map((entry) => option(entry.value, t(entry.labelKey))));
      select.addEventListener('change', () => {
        this.edit((draft) => {
          draft.modes[slug] = select.value as PermissionMode;
        });
      });
      modes.set(slug, select);
      return el(
        'label',
        'setting-row',
        el('span', 'setting-text', el('span', 'setting-label', label), el('span', 'setting-hint muted', permissionTargetHint(slug))),
        select,
      );
    });

    const fieldset = el(
      'fieldset',
      'settings-fieldset',
      section(
        t('settings.section.roles'),
        t('settings.section.hint.roles'),
        roleGrid,
        el('p', 'settings-hint muted', rolesHelp),
      ),
      section(t('settings.section.departments'), t('settings.section.hint.departments'), ...departmentRows),
      section(t('settings.section.permissions'), t('settings.section.hint.permissions'), ...modeRows),
      section(t('settings.section.review'), t('settings.section.hint.review'), ...numberRows(REVIEW_FIELDS)),
      section(t('settings.section.memory'), t('settings.section.hint.memory'), ...numberRows(MEMORY_FIELDS)),
      section(
        t('settings.section.floors'),
        t('settings.section.hint.floors'),
        ...(floorRows.length > 0 ? floorRows : [el('p', 'muted', t('settings.noFloors'))]),
      ),
    );
    const hub = section(
      t('settings.section.hub'),
      t('settings.section.hint.hub'),
      readonlyRow(t('settings.hub.docsRepo'), t('settings.hub.hint.docsRepo'), view.docsRepo),
      readonlyRow(t('settings.hub.port'), t('settings.hub.hint.port'), String(view.port)),
    );

    const notify = this.notifier ? mountNotifySection(this.notifier) : null;
    return { root: el('div', 'settings-form', fieldset, this.projectsHost, hub, notify), fieldset, roles, departments, numbers, branches, modes };
  }

  private syncControls(): void {
    const { controls, draft } = this;
    if (!controls || !draft) return;
    for (const [id, row] of controls.roles) {
      const role = draft.roles[id];
      setValue(row.model, role.choice);
      setValue(row.custom, role.custom);
      setValue(row.effort, role.effort);
    }
    for (const [key, input] of controls.departments) input.checked = draft.departments[key];
    for (const [key, input] of controls.numbers) setValue(input, draft.numbers[key]);
    for (const [slug, input] of controls.branches) setValue(input, draft.branches[slug] ?? '');
    for (const [slug, select] of controls.modes) setValue(select, draft.modes[slug] ?? 'auto');
  }

  private edit(change: (draft: SettingsDraft) => void): void {
    if (!this.draft) return;
    change(this.draft);
    this.outcome = null;
    this.refresh();
  }

  private refresh(): void {
    const { controls, baseline, draft } = this;
    if (!controls || !baseline || !draft) return;
    const editable = this.api !== null;
    const problems = validateDraft(draft);
    const changes = !isEmptyUpdate(diffDraft(baseline, draft));

    controls.fieldset.disabled = !editable || this.saving;
    for (const [id, row] of controls.roles) {
      row.custom.hidden = draft.roles[id].choice !== OTHER_MODEL;
      markInvalid(row.custom, problems.has(roleProblemKey(id)));
    }
    for (const [key, input] of controls.numbers) markInvalid(input, problems.has(key));
    for (const [slug, input] of controls.branches) markInvalid(input, problems.has(branchProblemKey(slug)));

    this.saveButton.disabled = !editable || this.saving || !changes || problems.size > 0;
    this.saveButton.textContent = this.saving ? t('settings.saving') : t('settings.save');
    this.showStatus(problems, changes);
  }

  private showStatus(problems: Problems, changes: boolean): void {
    let text = '';
    let kind = '';
    if (this.saving) {
      text = t('settings.saving');
    } else if (this.outcome) {
      ({ text, kind } = this.outcome);
    } else if (problems.size > 0) {
      text = problems.values().next().value ?? '';
      kind = 'error';
    } else if (changes) {
      text = t('settings.unsaved');
    }
    this.status.textContent = text;
    this.status.className = kind ? `settings-status ${kind}` : 'settings-status';
  }

  private async submit(): Promise<void> {
    const { api, baseline, draft } = this;
    if (!api || !baseline || !draft || this.saving) return;
    if (validateDraft(draft).size > 0) return;
    const update = diffDraft(baseline, draft);
    if (isEmptyUpdate(update)) return;

    this.saving = true;
    this.outcome = null;
    this.refresh();
    const response = await api.saveSettings(update);
    this.saving = false;

    if (!response.ok) {
      this.outcome = { text: response.message, kind: 'error' };
    } else if (!response.data.ok) {
      this.outcome = { text: hubTexts(response.data.error), kind: 'error' };
    } else {
      this.outcome = { text: outcomeText(hubTexts(response.data.note), response.data.regenerated), kind: 'ok' };
      this.baseline = applyUpdate(this.baseline ?? baseline, update);
      this.draft = draftFrom(this.baseline);
      void this.load();
    }
    this.render();
  }
}

export function mountSettings(host: HTMLElement, store: Store, api: OfficeApi | null, notifier: Notifier | null = null): void {
  const page = new SettingsPage(host, store, api, notifier);
  page.start();
}
