import type { Actions } from '../actions';
import type { ApiResult } from '../api';
import { button, el } from '../dom';
import { t } from '../i18n';
import { hubText } from '../i18n/hub';
import type { Store } from '../store';
import { countdown } from '../time';
import type { AskQuestion, QuestionView } from '../types';
import { panelSection } from './section';

const OTHER = '__other__';
// Protocol values the hub expects, whatever the panel language: only the button text is translated.
const PERMISSION_ALLOW = 'Permitir';
const PERMISSION_DENY = 'Denegar';

type Draft = {
  choice: string | null;
  picked: Set<string>;
  otherOn: boolean;
  other: string;
};

function answerFor(ask: AskQuestion, draft: Draft): string | null {
  const other = draft.other.trim();
  if (ask.multiSelect) {
    const parts = ask.options.map((option) => option.label).filter((label) => draft.picked.has(label));
    if (draft.otherOn && other) parts.push(other);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  if (draft.choice === OTHER) return other || null;
  return draft.choice;
}

class QuestionForm {
  readonly root: HTMLElement;
  private readonly drafts: Draft[];
  private readonly respond = button('', 'primary');
  private readonly release = button('');
  private readonly status = el('p', 'question-status');
  readonly countdownLabel = el('span', 'countdown');
  private readonly permissionHint = el('p', 'muted permission-hint');
  private readonly prompt = el('p', 'ask-text');
  private readonly otherTexts: HTMLInputElement[] = [];
  private lastNow: number | null = null;
  private busy = false;

  private readonly allow = button('', 'primary');
  private readonly deny = button('');

  constructor(
    readonly question: QuestionView,
    private readonly actions: Actions,
  ) {
    this.drafts = question.questions.map(() => ({ choice: null, picked: new Set<string>(), otherOn: false, other: '' }));
    this.respond.addEventListener('click', () => void this.submit());
    this.release.addEventListener('click', () => void this.giveBack());
    this.allow.addEventListener('click', () => void this.decide(PERMISSION_ALLOW));
    this.deny.addEventListener('click', () => void this.decide(PERMISSION_DENY));
    const permission = question.kind === 'permission';
    const ask = question.questions[0];
    this.root = permission
      ? el(
          'section',
          'question-card permission-card',
          ask ? this.prompt : null,
          question.detail ? el('pre', 'permission-detail', question.detail) : null,
          el('div', 'question-actions', this.allow, this.deny, this.release),
          this.permissionHint,
          this.status,
        )
      : el(
          'section',
          'question-card',
          ...question.questions.map((item, index) => this.block(item, index)),
          el('div', 'question-actions', this.respond, this.release),
          this.status,
        );
    this.relabel();
  }

  relabel(): void {
    this.permissionHint.textContent = t('question.permissionHint');
    const ask = this.question.questions[0];
    this.prompt.textContent = this.question.prompt ? hubText(this.question.prompt) : (ask?.question ?? '');
    this.release.textContent = t('question.release');
    this.allow.textContent = t('question.allow');
    this.deny.textContent = t('question.deny');
    for (const input of this.otherTexts) input.placeholder = t('question.other');
    this.refresh();
    if (this.lastNow !== null) this.updateCountdown(this.lastNow);
  }

  private async decide(choice: string): Promise<void> {
    const ask = this.question.questions[0];
    if (this.busy || !ask) return;
    await this.run(() => this.actions.answer(this.question, { [ask.question]: choice }));
  }

  updateCountdown(now: number): void {
    this.lastNow = now;
    const remaining = this.question.expiresAt - now;
    this.countdownLabel.textContent =
      remaining > 0 ? t('question.expiresIn', { time: countdown(remaining) }) : t('question.expired');
  }

  private block(ask: AskQuestion, index: number): HTMLElement {
    const draft = this.drafts[index];
    const group = `question-${this.question.id}-${index}`;
    const type = ask.multiSelect ? 'checkbox' : 'radio';
    const options = el('div', 'options');

    for (const option of ask.options) {
      const input = el('input');
      input.type = type;
      input.name = group;
      input.value = option.label;
      input.addEventListener('change', () => {
        if (ask.multiSelect) {
          if (input.checked) draft.picked.add(option.label);
          else draft.picked.delete(option.label);
        } else {
          draft.choice = option.label;
        }
        this.refresh();
      });
      options.append(
        el(
          'label',
          'option',
          input,
          el(
            'span',
            'option-text',
            el('span', 'option-label', option.label),
            option.description ? el('span', 'option-desc muted', option.description) : null,
          ),
        ),
      );
    }

    const otherInput = el('input');
    otherInput.type = type;
    otherInput.name = group;
    otherInput.value = OTHER;
    const otherText = el('input', 'other-text');
    otherText.type = 'text';
    this.otherTexts.push(otherText);

    const chooseOther = (): void => {
      if (ask.multiSelect) draft.otherOn = otherInput.checked;
      else draft.choice = OTHER;
    };
    otherInput.addEventListener('change', () => {
      chooseOther();
      if (otherInput.checked) otherText.focus();
      this.refresh();
    });
    otherText.addEventListener('input', () => {
      draft.other = otherText.value;
      if (!otherInput.checked) {
        otherInput.checked = true;
        chooseOther();
      }
      this.refresh();
    });
    options.append(el('label', 'option option-other', otherInput, otherText));

    return el(
      'div',
      'ask-block',
      ask.header ? el('span', 'chip ask-header', ask.header) : null,
      el('p', 'ask-text', ask.question),
      options,
    );
  }

  private complete(): boolean {
    return this.question.questions.every((ask, index) => answerFor(ask, this.drafts[index]) !== null);
  }

  private refresh(): void {
    this.respond.disabled = this.busy || !this.complete();
    this.release.disabled = this.busy;
    this.allow.disabled = this.busy;
    this.deny.disabled = this.busy;
    this.respond.textContent = this.busy ? t('panel.sending') : t('question.respond');
  }

  private async submit(): Promise<void> {
    if (this.busy || !this.complete()) return;
    const answers: Record<string, string> = {};
    this.question.questions.forEach((ask, index) => {
      const value = answerFor(ask, this.drafts[index]);
      if (value !== null) answers[ask.question] = value;
    });
    await this.run(() => this.actions.answer(this.question, answers));
  }

  private async giveBack(): Promise<void> {
    if (this.busy) return;
    await this.run(() => this.actions.release(this.question));
  }

  private async run(action: () => Promise<ApiResult>): Promise<void> {
    this.busy = true;
    this.status.textContent = '';
    this.refresh();
    const result = await action();
    this.busy = false;
    if (!result.ok) this.status.textContent = result.message;
    this.refresh();
  }
}

function reveal(node: HTMLElement): void {
  const scroller = node.closest<HTMLElement>('.panel-scroll');
  if (!scroller) return;
  const box = node.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  if (box.top < view.top) scroller.scrollTop += box.top - view.top;
  else if (box.bottom > view.bottom) scroller.scrollTop += Math.min(box.top - view.top, box.bottom - view.bottom);
}

export function mountQuestion(host: HTMLElement, store: Store, actions: Actions): void {
  let form: QuestionForm | null = null;
  const section = panelSection({
    id: 'question',
    title: () => (form?.question.kind === 'permission' ? t('question.permissionTitle') : t('question.title')),
    defaultOpen: true,
    host,
  });
  section.root.classList.add('question-section');
  host.hidden = true;
  store.watch(['lang'], () => {
    section.setTitle();
    form?.relabel();
  });
  store.watch(['selection', 'questions', 'tick'], () => {
    const key = store.selectedKey;
    const question = key === null ? undefined : store.questionFor(key);
    if (!question) {
      if (form) {
        form = null;
        section.body.replaceChildren();
        section.setMeta(null);
      }
      section.setForced(false);
      host.hidden = true;
      return;
    }
    if (!form || form.question.id !== question.id) {
      form = new QuestionForm(question, actions);
      section.body.replaceChildren(form.root);
      section.setMeta(form.countdownLabel);
      section.setTitle();
      section.root.classList.toggle('permission-section', question.kind === 'permission');
      requestAnimationFrame(() => reveal(section.root));
    }
    host.hidden = false;
    section.setForced(true);
    form.updateCountdown(store.now());
  });
}
