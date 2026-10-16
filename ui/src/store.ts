import { StateDebouncer } from './debounce';
import { applyLang, currentLang, plural, storeLang, t, type Lang, type MessageKey } from './i18n';
import type {
  ActivityView,
  AgentState,
  AgentView,
  DocumentView,
  FloorKind,
  FloorView,
  GuardAlert,
  MessageView,
  QuestionOutcome,
  QuestionView,
  RoleId,
  ServerMessage,
  SessionView,
  SettingsView,
  Snapshot,
  UsageView,
} from './types';

export type Topic =
  | 'connection'
  | 'mode'
  | 'floors'
  | 'agents'
  | 'sessions'
  | 'questions'
  | 'messages'
  | 'activity'
  | 'selection'
  | 'toasts'
  | 'tick'
  | 'documents'
  | 'alerts'
  | 'memory'
  | 'settings'
  | 'usage'
  | 'lang';

export type ConnectionStatus = 'nokey' | 'connecting' | 'online' | 'offline' | 'denied' | 'replay';
export type ToastKind = 'ok' | 'info' | 'error';
export type Toast = { id: number; text: string; kind: ToastKind };

type Listener = (topics: ReadonlySet<Topic>) => void;

const MESSAGE_LIMIT = 200;
const ACTIVITY_LIMIT = 500;
const ALERT_LIMIT = 50;
const TOAST_MS = 4000;
export const ENDED_VISIBLE_MS = 60_000;

const OUTCOME_KEYS: Record<QuestionOutcome, MessageKey> = {
  answered: 'toast.question.answered',
  released: 'toast.question.released',
  expired: 'toast.question.expired',
};

const FLOOR_KIND_RANK: Record<FloorKind, number> = { direccion: 0, redaccion: 1, managed: 2, observed: 3, mantenimiento: 4 };

export class Store {
  floors: FloorView[] = [];
  readonly agents = new Map<string, AgentView>();
  readonly sessions = new Map<string, SessionView>();
  questions: QuestionView[] = [];
  messages: MessageView[] = [];
  activity: ActivityView[] = [];
  documents: DocumentView[] = [];
  alerts: GuardAlert[] = [];
  settings: SettingsView | null = null;
  usage: UsageView | null = null;
  memoryVersion = new Map<string, number>();
  toasts: Toast[] = [];
  selectedKey: string | null = null;
  connection: ConnectionStatus = 'connecting';
  replay = false;

  private clock: () => number = () => Date.now();
  private readonly listeners = new Set<Listener>();
  private readonly dirty = new Set<Topic>();
  private flushQueued = false;
  private toastSeq = 0;
  private readonly debouncer = new StateDebouncer(() => this.mark('agents'));

  constructor() {
    window.setInterval(() => this.mark('tick'), 1000);
  }

  now(): number {
    return this.clock();
  }

  setClock(clock: () => number): void {
    this.clock = clock;
    this.mark('tick');
  }

  get lang(): Lang {
    return currentLang();
  }

  setLang(lang: Lang): void {
    if (lang === currentLang()) return;
    applyLang(lang);
    storeLang(lang);
    this.mark('lang');
  }

  setReplay(replay: boolean): void {
    this.replay = replay;
    this.mark('mode');
  }

  setConnection(status: ConnectionStatus): void {
    if (this.connection === status) return;
    this.connection = status;
    this.mark('connection');
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  watch(topics: readonly Topic[], run: () => void): () => void {
    const wanted = new Set<Topic>(topics);
    run();
    return this.subscribe((changed) => {
      for (const topic of changed) {
        if (wanted.has(topic)) {
          run();
          return;
        }
      }
    });
  }

  apply(message: ServerMessage): void {
    switch (message.type) {
      case 'snapshot':
        this.applySnapshot(message.data);
        break;
      case 'floors':
        this.floors = message.data;
        this.mark('floors');
        break;
      case 'agent': {
        const agent = withDefaults(message.data);
        this.agents.set(agent.key, agent);
        this.debouncer.observe(agent);
        this.mark('agents');
        break;
      }
      case 'agent-gone':
        if (!this.agents.delete(message.key)) break;
        this.debouncer.forget(message.key);
        this.mark('agents');
        break;
      case 'session':
        this.sessions.set(message.data.sessionId, message.data);
        this.mark('sessions');
        break;
      case 'question':
        this.questions = [...this.questions.filter((q) => q.id !== message.data.id), message.data];
        this.mark('questions');
        break;
      case 'question-closed':
        this.closeQuestion(message.id, message.outcome);
        break;
      case 'message':
        this.messages.push(message.data);
        if (this.messages.length > MESSAGE_LIMIT) this.messages.splice(0, this.messages.length - MESSAGE_LIMIT);
        this.mark('messages');
        break;
      case 'activity':
        this.activity.push(message.data);
        if (this.activity.length > ACTIVITY_LIMIT) this.activity.splice(0, this.activity.length - ACTIVITY_LIMIT);
        this.mark('activity');
        break;
      case 'documents':
        this.documents = message.data;
        this.mark('documents');
        break;
      case 'alert':
        this.alerts = [...this.alerts.filter((a) => a.id !== message.data.id), message.data].slice(-ALERT_LIMIT);
        this.mark('alerts');
        this.toast(
          plural('toast.alert', message.data.files.length, {
            level: t(`toast.alertLevel.${message.data.level}`),
            floor: message.data.floor,
          }),
          message.data.level === 'alerta' ? 'error' : 'info',
        );
        break;
      case 'memory': {
        const key = memoryKey(message.floor, message.role);
        this.memoryVersion.set(key, (this.memoryVersion.get(key) ?? 0) + 1);
        this.mark('memory');
        break;
      }
      case 'settings':
        this.settings = message.data;
        this.mark('settings');
        break;
      case 'usage':
        this.usage = message.data;
        this.mark('usage');
        break;
    }
  }

  reset(): void {
    this.floors = [];
    this.agents.clear();
    this.sessions.clear();
    this.questions = [];
    this.messages = [];
    this.activity = [];
    this.documents = [];
    this.alerts = [];
    this.usage = null;
    this.debouncer.clear();
    this.markAll();
  }

  select(key: string | null): void {
    if (this.selectedKey === key) return;
    this.selectedKey = key;
    this.mark('selection');
  }

  dropQuestion(id: string): void {
    if (!this.questions.some((q) => q.id === id)) return;
    this.questions = this.questions.filter((q) => q.id !== id);
    this.mark('questions');
  }

  toast(text: string, kind: ToastKind = 'info'): void {
    const toast: Toast = { id: ++this.toastSeq, text, kind };
    this.toasts = [...this.toasts, toast];
    this.mark('toasts');
    window.setTimeout(() => this.dismissToast(toast.id), TOAST_MS);
  }

  dismissToast(id: number): void {
    if (!this.toasts.some((t) => t.id === id)) return;
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.mark('toasts');
  }

  shownState(agent: AgentView): AgentState {
    return this.debouncer.shown(agent.key) ?? agent.state;
  }

  isVisible(agent: AgentView): boolean {
    return agent.endedAt === null || this.now() - agent.endedAt <= ENDED_VISIBLE_MS;
  }

  visibleAgents(): AgentView[] {
    return [...this.agents.values()].filter((agent) => this.isVisible(agent));
  }

  officeAgents(): AgentView[] {
    return this.visibleAgents().filter((agent) => !agent.away);
  }

  floorList(): FloorView[] {
    const known = new Map<string, FloorView>(this.floors.map((floor) => [floor.slug, floor]));
    for (const agent of this.agents.values()) {
      if (known.has(agent.floor) || !this.isVisible(agent)) continue;
      known.set(agent.floor, { slug: agent.floor, label: agent.floor, path: null, stack: 'generic', kind: 'observed', building: 'principal' });
    }
    return [...known.values()].sort((a, b) => {
      const byKind = FLOOR_KIND_RANK[a.kind] - FLOOR_KIND_RANK[b.kind];
      return byKind !== 0 ? byKind : a.label.localeCompare(b.label, currentLang());
    });
  }

  floorBySlug(slug: string): FloorView | undefined {
    return this.floorList().find((floor) => floor.slug === slug);
  }

  questionFor(agentKey: string): QuestionView | undefined {
    let oldest: QuestionView | undefined;
    for (const question of this.questions) {
      if (question.agentKey !== agentKey) continue;
      if (!oldest || question.createdAt < oldest.createdAt) oldest = question;
    }
    return oldest;
  }

  oldestQuestion(): QuestionView | undefined {
    let oldest: QuestionView | undefined;
    for (const question of this.questions) {
      if (!oldest || question.createdAt < oldest.createdAt) oldest = question;
    }
    return oldest;
  }

  private applySnapshot(snapshot: Snapshot): void {
    this.floors = snapshot.floors;
    this.agents.clear();
    this.debouncer.clear();
    for (const raw of snapshot.agents) {
      const agent = withDefaults(raw);
      this.agents.set(agent.key, agent);
      this.debouncer.observe(agent);
    }
    this.sessions.clear();
    for (const session of snapshot.sessions) this.sessions.set(session.sessionId, session);
    this.questions = [...snapshot.questions];
    this.messages = snapshot.messages.slice(-MESSAGE_LIMIT);
    this.activity = snapshot.activity.slice(-ACTIVITY_LIMIT);
    this.documents = snapshot.documents ?? [];
    this.alerts = (snapshot.alerts ?? []).slice(-ALERT_LIMIT);
    this.usage = snapshot.usage ?? null;
    this.markAll();
  }

  private closeQuestion(id: string, outcome: QuestionOutcome): void {
    const existed = this.questions.some((q) => q.id === id);
    if (!existed) return;
    this.questions = this.questions.filter((q) => q.id !== id);
    this.mark('questions');
    this.toast(t(OUTCOME_KEYS[outcome]),outcome === 'answered' ? 'ok' : 'info');
  }

  private markAll(): void {
    const all: Topic[] = ['floors', 'agents', 'sessions', 'questions', 'messages', 'activity', 'selection', 'documents', 'alerts', 'memory', 'usage'];
    for (const topic of all) this.mark(topic);
  }

  private mark(topic: Topic): void {
    this.dirty.add(topic);
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => this.flush());
  }

  private flush(): void {
    this.flushQueued = false;
    const changed = new Set(this.dirty);
    this.dirty.clear();
    for (const listener of [...this.listeners]) listener(changed);
  }
}

export function withDefaults(agent: AgentView): AgentView {
  const partial: Partial<Pick<AgentView, 'file' | 'task' | 'away'>> = agent;
  return {
    ...agent,
    file: partial.file ?? null,
    task: partial.task ?? null,
    away: partial.away ?? agent.endedAt !== null,
  };
}

export function memoryKey(floor: string, role: RoleId): string {
  return `${floor}|${role}`;
}
