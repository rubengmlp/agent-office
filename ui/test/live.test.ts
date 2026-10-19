import { beforeEach, describe, expect, test } from 'bun:test';
import { LiveConnection, type LiveStatus } from '../src/live';
import type { ClientMessage, ServerMessage } from '../src/types';

type Listener = (event: unknown) => void;

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  closeCalls = 0;
  private listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
  }

  emit(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit('open', {});
  }

  message(data: unknown): void {
    this.emit('message', { data });
  }

  finish(code = 1006): void {
    this.readyState = 3;
    this.emit('close', { code });
  }
}

const timers = new Map<number, { fn: () => void; ms: number }>();
const delays: number[] = [];
let nextTimer = 1;

function flushTimers(): void {
  const pending = [...timers.values()];
  timers.clear();
  for (const timer of pending) timer.fn();
}

Object.assign(globalThis, {
  location: { protocol: 'http:', host: 'hub.local:4747' },
  window: {
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextTimer++;
      delays.push(ms);
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
  },
  WebSocket: FakeSocket,
});

function recorder() {
  const statuses: LiveStatus[] = [];
  const messages: ServerMessage[] = [];
  let opens = 0;
  const handlers = {
    onStatus: (status: LiveStatus) => statuses.push(status),
    onMessage: (message: ServerMessage) => messages.push(message),
    onOpen: () => {
      opens += 1;
    },
  };
  return { statuses, messages, handlers, opens: () => opens };
}

const auth: ClientMessage = { type: 'auth', token: 'tok' };
const snapshot: ServerMessage = { type: 'snapshot', data: {} } as unknown as ServerMessage;

beforeEach(() => {
  FakeSocket.instances = [];
  timers.clear();
  delays.length = 0;
  nextTimer = 1;
});

describe('LiveConnection', () => {
  test('starts, auths on open and reports online with the first snapshot', () => {
    const r = recorder();
    const live = new LiveConnection('tok', r.handlers);
    live.start();

    expect(r.statuses).toEqual(['connecting']);
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe('ws://hub.local:4747/live');

    socket.open();
    expect(r.opens()).toBe(1);
    expect(socket.sent).toEqual([JSON.stringify(auth)]);

    socket.message(JSON.stringify(snapshot));
    expect(r.statuses).toEqual(['connecting', 'online']);
    expect(r.messages).toEqual([snapshot]);
  });

  test('uses wss behind https', () => {
    (globalThis as { location: { protocol: string } }).location.protocol = 'https:';
    try {
      new LiveConnection('tok', recorder().handlers).start();
      expect(FakeSocket.instances[0]!.url).toBe('wss://hub.local:4747/live');
    } finally {
      (globalThis as { location: { protocol: string } }).location.protocol = 'http:';
    }
  });

  test('sends only with an open socket and ignores noise from the server', () => {
    const r = recorder();
    const live = new LiveConnection('tok', r.handlers);
    live.start();
    const socket = FakeSocket.instances[0]!;

    expect(live.send(auth)).toBe(false);
    socket.open();
    expect(live.send(auth)).toBe(true);
    expect(socket.sent).toEqual([JSON.stringify(auth), JSON.stringify(auth)]);

    socket.message('not json');
    socket.message(JSON.stringify(42));
    socket.message(JSON.stringify({ no: 'type' }));
    expect(r.messages).toEqual([]);
    expect(r.statuses).toEqual(['connecting']);
  });

  test('reconnects with backoff and resets it after a snapshot', () => {
    const r = recorder();
    const live = new LiveConnection('tok', r.handlers);
    live.start();

    FakeSocket.instances[0]!.finish();
    expect(r.statuses).toEqual(['connecting', 'offline']);
    flushTimers();
    expect(FakeSocket.instances[1]!.url).toBe('ws://hub.local:4747/live');

    FakeSocket.instances[1]!.finish();
    flushTimers();
    expect(FakeSocket.instances).toHaveLength(3);
    expect(delays).toEqual([1000, 2000]);

    const third = FakeSocket.instances[2]!;
    third.open();
    third.message(JSON.stringify(snapshot));
    third.finish();
    flushTimers();
    expect(delays).toEqual([1000, 2000, 1000]);
  });

  test('a denied close stops for good', () => {
    const r = recorder();
    new LiveConnection('tok', r.handlers).start();

    FakeSocket.instances[0]!.finish(4401);
    expect(r.statuses).toEqual(['connecting', 'denied']);
    flushTimers();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(timers.size).toBe(0);
  });

  test('a stale socket is ignored once a new one exists', () => {
    const r = recorder();
    new LiveConnection('tok', r.handlers).start();
    const first = FakeSocket.instances[0]!;
    first.finish();
    flushTimers();

    first.open();
    expect(r.opens()).toBe(0);
    expect(first.sent).toEqual([]);
  });

  test('stop closes the socket', () => {
    const live = new LiveConnection('tok', recorder().handlers);
    live.start();
    const socket = FakeSocket.instances[0]!;
    live.stop();

    expect(socket.closeCalls).toBe(1);
    expect(live.send(auth)).toBe(false);
  });

  test('stop cancels the pending reconnect', () => {
    const r = recorder();
    const live = new LiveConnection('tok', r.handlers);
    live.start();
    const socket = FakeSocket.instances[0]!;
    socket.finish();
    live.stop();

    expect(timers.size).toBe(0);
    flushTimers();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(r.statuses).toEqual(['connecting', 'offline']);
  });
});
