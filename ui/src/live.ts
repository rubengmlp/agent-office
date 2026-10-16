import type { ClientMessage, ServerMessage } from './types';

export type LiveStatus = 'connecting' | 'online' | 'offline' | 'denied';

export type LiveHandlers = {
  onStatus(status: LiveStatus): void;
  onMessage(message: ServerMessage): void;
  onOpen?(): void;
};

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 10_000;
const DENIED_CODE = 4401;

export class LiveConnection {
  private socket: WebSocket | null = null;
  private delay = BASE_DELAY_MS;
  private timer: number | undefined;
  private stopped = true;

  constructor(
    private readonly token: string,
    private readonly handlers: LiveHandlers,
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.socket?.close();
    this.socket = null;
  }

  send(message: ClientMessage): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private connect(): void {
    this.handlers.onStatus('connecting');
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${location.host}/live`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.send({ type: 'auth', token: this.token });
      this.handlers.onOpen?.();
    });
    socket.addEventListener('message', (event) => {
      if (this.socket === socket) this.receive(event.data);
    });
    socket.addEventListener('close', (event) => {
      if (this.socket === socket) this.closed(event.code);
    });
  }

  private receive(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) return;
    const message = parsed as ServerMessage;
    if (message.type === 'snapshot') {
      this.delay = BASE_DELAY_MS;
      this.handlers.onStatus('online');
    }
    this.handlers.onMessage(message);
  }

  private closed(code: number): void {
    this.socket = null;
    if (this.stopped) return;
    if (code === DENIED_CODE) {
      this.stopped = true;
      this.handlers.onStatus('denied');
      return;
    }
    this.handlers.onStatus('offline');
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      if (!this.stopped) this.connect();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, MAX_DELAY_MS);
  }
}
