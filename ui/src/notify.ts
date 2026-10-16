import { plural, t } from './i18n';
import { agentName, floorLabel } from './labels';
import { openDocument } from './panel/deliverables';
import type { Store } from './store';
import type { AgentView, DocumentView, GuardAlert, MessageView, QuestionView, ServerMessage } from './types';

export type NotifyEvent = 'permission' | 'question' | 'blocked' | 'done' | 'document' | 'alert' | 'stalled';

export const NOTIFY_EVENTS: readonly NotifyEvent[] = ['permission', 'question', 'blocked', 'done', 'document', 'alert', 'stalled'];

export type NotifyPrefs = { enabled: boolean; events: Record<NotifyEvent, boolean> };

const PREFS_KEY = 'agent-office.notify';
export const SEEN_LIMIT = 500;
// Protocol prefixes, as in the hub state machine (which cannot load in the browser). Not translated.
const BLOCK_PREFIX = /^\s*BLOQUEADO\s*:/i;
const DONE_PREFIX = /^\s*HECHO\s*:/i;

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined';
}

function permissionState(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

function defaultPrefs(): NotifyPrefs {
  return { enabled: false, events: { permission: true, question: true, blocked: true, done: true, document: true, alert: true, stalled: true } };
}

function readPrefs(): NotifyPrefs {
  const prefs = defaultPrefs();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return prefs;
    const record = raw as { enabled?: unknown; events?: unknown };
    if (typeof record.enabled === 'boolean') prefs.enabled = record.enabled;
    const events = typeof record.events === 'object' && record.events !== null ? (record.events as Record<string, unknown>) : {};
    for (const event of NOTIFY_EVENTS) {
      if (typeof events[event] === 'boolean') prefs.events[event] = events[event];
    }
  } catch {
    // Blocked or broken storage: notifications stay off.
  }
  return prefs;
}

export class Notifier {
  private prefs: NotifyPrefs = readPrefs();
  private readonly seen = new Set<string>();
  private readonly shown = new Map<string, Notification>();
  private documents: Map<string, DocumentView['status']> | null = null;
  private readonly stalled = new Map<string, number | null>();

  constructor(private readonly store: Store) {}

  get preferences(): NotifyPrefs {
    return { enabled: this.prefs.enabled, events: { ...this.prefs.events } };
  }

  save(prefs: NotifyPrefs): void {
    this.prefs = { enabled: prefs.enabled, events: { ...prefs.events } };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      // Blocked storage: the choice lasts for this session only.
    }
  }

  test(): void {
    if (permissionState() !== 'granted') return;
    new Notification(t('notify.test'), { tag: 'test' });
  }

  observe(message: ServerMessage): void {
    switch (message.type) {
      case 'snapshot':
        // History does not notify: only pending questions, which may have arrived while the hub restarted.
        for (const question of message.data.questions) this.question(question);
        this.seedDocuments(message.data.documents ?? []);
        this.stalled.clear();
        for (const agent of message.data.agents) this.stalled.set(agent.key, agent.stalledSince ?? null);
        break;
      case 'agent':
        this.agent(message.data);
        break;
      case 'agent-gone':
        this.stalled.delete(message.key);
        break;
      case 'question':
        this.question(message.data);
        break;
      case 'question-closed': {
        const tag = `question:${message.id}`;
        this.shown.get(tag)?.close();
        this.shown.delete(tag);
        break;
      }
      case 'message':
        this.message(message.data);
        break;
      case 'documents':
        this.changedDocuments(message.data);
        break;
      case 'alert':
        this.alert(message.data);
        break;
    }
  }

  private name(key: string): string {
    const agent = this.store.agents.get(key);
    return agent ? agentName(agent) : key.slice(0, 8);
  }

  private select(key: string): () => void {
    return () => {
      if (this.store.agents.has(key)) this.store.select(key);
    };
  }

  // Bodies stay generic on purpose: the command of a permission, the question and the text of a BLOQUEADO or a
  // HECHO may carry secrets or private details, and the Notification Center shows them even on a locked screen.
  // The panel shows them in full.
  private question(question: QuestionView): void {
    const agent = this.name(question.agentKey);
    if (question.kind === 'permission') {
      const title = question.tool ? t('notify.permission.tool', { agent, tool: question.tool }) : t('notify.permission.title', { agent });
      this.show('permission', `question:${question.id}`, title, t('notify.openPanel'), this.select(question.agentKey));
    } else {
      this.show('question', `question:${question.id}`, t('notify.question.title', { agent }), t('notify.openPanel'), this.select(question.agentKey));
    }
  }

  private message(message: MessageView): void {
    if (message.text === null) return;
    const agent = this.name(message.fromKey);
    if (BLOCK_PREFIX.test(message.text)) {
      this.show('blocked', `message:${message.id}`, t('notify.blocked.title', { agent }), t('notify.openPanel'), this.select(message.fromKey));
    } else if (DONE_PREFIX.test(message.text) && this.store.agents.get(message.fromKey)?.roleKind === 'lead') {
      this.show('done', `message:${message.id}`, t('notify.done.title', { agent }), t('notify.openPanel'), this.select(message.fromKey));
    }
  }

  private agent(agent: AgentView): void {
    const before = this.stalled.get(agent.key) ?? null;
    const since = agent.stalledSince ?? null;
    this.stalled.set(agent.key, since);
    if (before !== null || since === null) return;
    this.show('stalled', `stalled:${agent.key}:${since}`, t('notify.stalled.title', { agent: agentName(agent) }), t('notify.openPanel'), this.select(agent.key));
  }

  private seedDocuments(documents: readonly DocumentView[]): void {
    this.documents = new Map(documents.map((doc) => [doc.path, doc.status]));
  }

  private changedDocuments(documents: readonly DocumentView[]): void {
    const before = this.documents;
    this.seedDocuments(documents);
    if (before === null) return;
    for (const doc of documents) {
      if (doc.status === before.get(doc.path)) continue;
      let title: string;
      if (doc.status === 'aprobado') {
        title = t(doc.kind === 'plan' ? 'notify.document.approvedPlan' : 'notify.document.approvedSkill', { title: doc.title });
      } else if (doc.status === 'sin-acuerdo') {
        title = t('notify.document.noAgreement', { title: doc.title });
      } else if (doc.status === 'entregado' && doc.kind === 'plan') {
        title = t('notify.document.deliveredPlan', { title: doc.title });
      } else {
        continue;
      }
      this.show('document', `document:${doc.path}:${doc.status}:${doc.round}`, title, '', () => {
        const current = this.store.documents.find((item) => item.path === doc.path);
        if (current) openDocument(this.store, current);
      });
    }
  }

  private alert(alert: GuardAlert): void {
    if (alert.level !== 'alerta') return;
    const floor = this.store.floorBySlug(alert.floor);
    this.show(
      'alert',
      `alert:${alert.id}`,
      t('notify.alert.title', { floor: floor ? floorLabel(floor) : alert.floor }),
      plural('notify.alert.files', alert.files.length),
      this.select(alert.agentKey),
    );
  }

  private show(event: NotifyEvent, tag: string, title: string, body: string, onClick: () => void): void {
    if (!this.prefs.enabled || !this.prefs.events[event] || permissionState() !== 'granted') return;
    if (this.seen.has(tag)) return;
    this.seen.add(tag);
    if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value as string);
    // The panel in front already shows it.
    if (document.visibilityState === 'visible' && document.hasFocus()) return;
    const notification = new Notification(title, { body, tag });
    this.shown.set(tag, notification);
    if (this.shown.size > SEEN_LIMIT) this.shown.delete(this.shown.keys().next().value as string);
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
    notification.onclose = () => {
      if (this.shown.get(tag) === notification) this.shown.delete(tag);
    };
  }
}
