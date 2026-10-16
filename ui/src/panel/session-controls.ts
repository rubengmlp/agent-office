import type { OfficeApi } from '../api';
import { button } from '../dom';
import { t } from '../i18n';
import { agentName } from '../labels';
import type { Store } from '../store';
import { duration } from '../time';
import type { AgentView, SessionView } from '../types';
import { statusAllowed } from './orderable';

export function mainSession(store: Store, agent: AgentView): SessionView | undefined {
  return agent.key === agent.sessionId ? store.sessions.get(agent.sessionId) : undefined;
}

export function canAskStatus(store: Store, agent: AgentView): boolean {
  return statusAllowed(store.sessions.get(agent.sessionId));
}

export function stalledText(since: number, now: number): string {
  return t('floors.stalled', { time: duration(now - since) });
}

export function statusButton(agent: AgentView): HTMLButtonElement {
  const control = button(t('floors.askStatus'), 'session-action', t('floors.askStatusHint'));
  control.dataset.action = 'status';
  control.dataset.session = agent.sessionId;
  return control;
}

export function relaunchButton(session: SessionView): HTMLButtonElement {
  const control = button(t('floors.relaunch'), 'session-action', t(session.canRelaunch ? 'floors.relaunchHint' : 'floors.relaunchBusy'));
  control.dataset.action = 'relaunch';
  control.dataset.session = session.sessionId;
  control.disabled = !session.canRelaunch;
  return control;
}

export async function runSessionAction(api: OfficeApi | null, store: Store, control: HTMLButtonElement): Promise<void> {
  const sessionId = control.dataset.session;
  const agent = sessionId === undefined ? undefined : store.agents.get(sessionId);
  if (api === null || sessionId === undefined || !agent) return;
  const name = agentName(agent);
  if (control.dataset.action === 'relaunch') {
    const resumes = store.sessions.get(sessionId)?.relaunchResumes ?? false;
    const question = `${t('floors.relaunchConfirm', { name })} ${t(resumes ? 'floors.relaunchResumes' : 'floors.relaunchFresh')}`;
    if (!window.confirm(question)) return;
  }
  control.disabled = true;
  const relaunch = control.dataset.action === 'relaunch';
  const result = await (relaunch ? api.relaunch(sessionId) : api.requestStatus(sessionId));
  control.disabled = false;
  if (!result.ok) {
    store.toast(result.message, 'error');
    return;
  }
  store.toast(t(relaunch ? 'toast.relaunched' : 'toast.statusRequested', { name }), 'ok');
}
