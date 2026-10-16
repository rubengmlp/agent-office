import type { ClientMessage } from './types';

const INTERVAL_MS = 10_000;

export class Heartbeat {
  private timer: number | undefined;

  // notify: whether this panel will raise desktop notifications while hidden, so the hub keeps holding questions.
  constructor(
    private readonly send: (message: ClientMessage) => boolean,
    private readonly notify: () => boolean = () => false,
  ) {}

  start(): void {
    this.stop();
    this.timer = window.setInterval(() => this.pulse(), INTERVAL_MS);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('freeze', this.onFreeze);
    document.addEventListener('resume', this.onVisibility);
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('freeze', this.onFreeze);
    document.removeEventListener('resume', this.onVisibility);
  }

  pulse(): void {
    this.send({ type: 'heartbeat', visible: document.visibilityState === 'visible', notify: this.notify() });
  }

  private readonly onVisibility = (): void => this.pulse();

  // A frozen tab (Chrome Page Lifecycle) runs no code, so it cannot notify.
  private readonly onFreeze = (): void => {
    this.send({ type: 'heartbeat', visible: false, notify: false });
  };
}
