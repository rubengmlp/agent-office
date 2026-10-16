import { beforeEach, describe, expect, test } from 'bun:test';
import { t } from '../src/i18n/index';
import { NOTIFY_EVENTS, Notifier, SEEN_LIMIT, type NotifyPrefs } from '../src/notify';
import type { Store } from '../src/store';
import type { AgentView, DocumentView, QuestionView, ServerMessage, Snapshot } from '../src/types';

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static created: FakeNotification[] = [];
  static requestPermission = async (): Promise<NotificationPermission> => FakeNotification.permission;
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(
    readonly title: string,
    readonly options: NotificationOptions = {},
  ) {
    FakeNotification.created.push(this);
  }

  close(): void {
    this.closed = true;
    this.onclose?.();
  }
}

const storage = new Map<string, string>();
const page = { visible: false, focused: false };

Object.assign(globalThis, {
  Notification: FakeNotification,
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
  document: {
    get visibilityState() {
      return page.visible ? 'visible' : 'hidden';
    },
    hasFocus: () => page.focused,
    documentElement: { lang: 'es' },
  },
  window: { focus: () => {} },
});

const LEAD = 'lead-1';
const DEV = 'dev-1';

function fakeStore(selected: string[]): Store {
  const agents = new Map<string, Partial<AgentView>>([
    [LEAD, { key: LEAD, name: 'lead-mobile', role: 'office-lead-mobile', roleKind: 'lead' }],
    [DEV, { key: DEV, name: 'dev-mobile', role: 'office-dev-mobile', roleKind: 'dev' }],
  ]);
  return { agents, documents: [], select: (key: string) => selected.push(key), floorBySlug: () => undefined } as unknown as Store;
}

function allOn(): NotifyPrefs {
  return { enabled: true, events: Object.fromEntries(NOTIFY_EVENTS.map((event) => [event, true])) as NotifyPrefs['events'] };
}

function question(id: string, extra: Partial<QuestionView> = {}): QuestionView {
  return {
    id,
    agentKey: LEAD,
    sessionId: 's-1',
    floor: 'mobile',
    questions: [{ question: '¿Seguimos con la migración de la base de datos?', options: [{ label: 'Sí' }, { label: 'No' }] }],
    createdAt: 1,
    expiresAt: 2,
    ...extra,
  } as QuestionView;
}

function snapshot(extra: Partial<Snapshot> = {}): ServerMessage {
  return {
    type: 'snapshot',
    data: { now: 1, floors: [], agents: [], sessions: [], questions: [], messages: [], activity: [], documents: [], alerts: [], ...extra },
  } as ServerMessage;
}

function plan(status: DocumentView['status'], round: number): DocumentView {
  return { path: 'redaccion/planes/login.md', kind: 'plan', slug: 'login', title: 'Login con Apple', status, round } as DocumentView;
}

describe('desktop notifier', () => {
  let selected: string[];
  let notifier: Notifier;

  beforeEach(() => {
    storage.clear();
    FakeNotification.permission = 'granted';
    FakeNotification.created = [];
    page.visible = false;
    page.focused = false;
    selected = [];
    notifier = new Notifier(fakeStore(selected));
    notifier.save(allOn());
  });

  test('is off by default', () => {
    storage.clear();
    const fresh = new Notifier(fakeStore([]));
    expect(fresh.preferences.enabled).toBe(false);
    fresh.observe({ type: 'question', data: question('q0') });
    expect(FakeNotification.created).toHaveLength(0);
  });

  test('each tag notifies once, also when the snapshot repeats a pending question', () => {
    notifier.observe({ type: 'question', data: question('q1') });
    notifier.observe({ type: 'question', data: question('q1') });
    notifier.observe(snapshot({ questions: [question('q1')] }));
    expect(FakeNotification.created).toHaveLength(1);
    expect(FakeNotification.created[0]?.options.tag).toBe('question:q1');
  });

  test('messages in the snapshot are history and do not notify', () => {
    const blocked = { id: 7, ts: 1, fromKey: DEV, toName: 'lead', toKey: LEAD, text: 'BLOQUEADO: falta la key — necesito la key de backend', floor: 'mobile' };
    notifier.observe(snapshot({ messages: [blocked] }));
    expect(FakeNotification.created).toHaveLength(0);
    notifier.observe({ type: 'message', data: { ...blocked, id: 8 } });
    expect(FakeNotification.created).toHaveLength(1);
    expect(FakeNotification.created[0]?.title).toBe(t('notify.blocked.title', { agent: 'dev-mobile' }));
  });

  test('the first list of documents only seeds; a later approval notifies once per status and round', () => {
    notifier.observe({ type: 'documents', data: [plan('aprobado', 2)] });
    expect(FakeNotification.created).toHaveLength(0);
    notifier.observe({ type: 'documents', data: [plan('revision', 3)] });
    notifier.observe({ type: 'documents', data: [plan('aprobado', 3)] });
    notifier.observe({ type: 'documents', data: [plan('aprobado', 3)] });
    expect(FakeNotification.created.map((n) => n.options.tag)).toEqual(['document:redaccion/planes/login.md:aprobado:3']);
  });

  test('a plan delivered for a decision notifies with its title only, once', () => {
    notifier.observe({ type: 'documents', data: [plan('aprobado', 3)] });
    notifier.observe({ type: 'documents', data: [plan('entregado', 3)] });
    notifier.observe({ type: 'documents', data: [plan('entregado', 3)] });
    notifier.observe({ type: 'documents', data: [plan('aparcado', 3)] });
    expect(FakeNotification.created.map((n) => [n.title, n.options.tag, n.options.body])).toEqual([
      ['Plan pendiente de decisión: Login con Apple', 'document:redaccion/planes/login.md:entregado:3', ''],
    ]);
  });

  test('nothing is notified while the panel is in front and focused', () => {
    page.visible = true;
    page.focused = true;
    notifier.observe({ type: 'question', data: question('q2') });
    expect(FakeNotification.created).toHaveLength(0);
    page.focused = false;
    notifier.observe({ type: 'question', data: question('q3') });
    expect(FakeNotification.created).toHaveLength(1);
  });

  test('bodies never carry the command, the question or the message text', () => {
    notifier.observe({ type: 'question', data: question('p1', { kind: 'permission', detail: 'curl -H "Authorization: Bearer secreto"', tool: 'Bash' }) });
    notifier.observe({ type: 'question', data: question('q4') });
    notifier.observe({ type: 'message', data: { id: 9, ts: 1, fromKey: LEAD, toName: 'director', toKey: null, text: 'HECHO: login — TOKEN=abc', floor: 'mobile' } });
    const [permission, ask, done] = FakeNotification.created;
    expect(permission?.title).toBe(t('notify.permission.tool', { agent: 'lead-mobile', tool: 'Bash' }));
    for (const n of [permission, ask, done]) {
      expect(n?.options.body).toBe(t('notify.openPanel'));
      expect(`${n?.title} ${n?.options.body}`).not.toMatch(/secreto|migraci|TOKEN/);
    }
  });

  test('a click selects the agent and a closed question closes and forgets its notification', () => {
    notifier.observe({ type: 'question', data: question('q5') });
    FakeNotification.created[0]?.onclick?.();
    expect(selected).toEqual([LEAD]);

    notifier.observe({ type: 'question', data: question('q6') });
    notifier.observe({ type: 'question-closed', id: 'q6', outcome: 'answered' });
    expect(FakeNotification.created[1]?.closed).toBe(true);
    expect((notifier as unknown as { shown: Map<string, unknown> }).shown.has('question:q6')).toBe(false);
  });

  test('seen tags and open notifications are capped', () => {
    for (let index = 0; index <= SEEN_LIMIT; index += 1) notifier.observe({ type: 'question', data: question(`b${index}`) });
    const internals = notifier as unknown as { seen: Set<string>; shown: Map<string, unknown> };
    expect(internals.seen.size).toBe(SEEN_LIMIT);
    expect(internals.shown.size).toBe(SEEN_LIMIT);
    expect(internals.seen.has('question:b0')).toBe(false);
    expect(internals.shown.has('question:b0')).toBe(false);
    expect(internals.shown.has(`question:b${SEEN_LIMIT}`)).toBe(true);
  });
});
