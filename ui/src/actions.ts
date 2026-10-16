import type { ApiResult, OfficeApi } from './api';
import { t } from './i18n';
import type { Store } from './store';
import type { OrderRequest, QuestionOutcome, QuestionView } from './types';

export type Actions = {
  readonly ordersEnabled: boolean;
  answer(question: QuestionView, answers: Record<string, string>): Promise<ApiResult>;
  release(question: QuestionView): Promise<ApiResult>;
  order(request: OrderRequest): Promise<ApiResult>;
};

const ALREADY_RELEASED = 409;

export function liveActions(store: Store, api: OfficeApi): Actions {
  function settle(question: QuestionView, result: ApiResult, outcome: QuestionOutcome): ApiResult {
    if (result.ok) {
      store.apply({ type: 'question-closed', id: question.id, outcome });
    } else if (result.status === ALREADY_RELEASED) {
      store.toast(result.message, 'info');
      store.dropQuestion(question.id);
    }
    return result;
  }

  return {
    ordersEnabled: true,
    answer: async (question, answers) => settle(question, await api.answer(question.id, { answers }), 'answered'),
    release: async (question) => settle(question, await api.answer(question.id, { release: true }), 'released'),
    order: async (request) => {
      const result = await api.order(request);
      if (result.ok) store.toast(t('toast.orderSent'), 'ok');
      return result;
    },
  };
}

export function replayActions(store: Store): Actions {
  const close = async (question: QuestionView, outcome: QuestionOutcome): Promise<ApiResult> => {
    store.apply({ type: 'question-closed', id: question.id, outcome });
    return { ok: true };
  };

  return {
    ordersEnabled: false,
    answer: (question) => close(question, 'answered'),
    release: (question) => close(question, 'released'),
    order: async () => ({ ok: false, status: 0, message: t('replay.ordersDisabled') }),
  };
}
