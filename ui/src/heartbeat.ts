import type { ClientMessage } from './types';

const INTERVAL_MS = 10_000;

export class Heartbeat {
  private timer: number | undefined;

  constructor(private readonly send: (message: ClientMessage) => boolean) {}

  start(): void {
    this.stop();
    this.timer = window.setInterval(() => this.pulse(), INTERVAL_MS);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  pulse(): void {
    if (document.visibilityState !== 'visible') return;
    this.send({ type: 'heartbeat', visible: true });
  }

  private readonly onVisibility = (): void => this.pulse();
}
