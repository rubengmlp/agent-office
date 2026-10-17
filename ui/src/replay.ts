import { button, el } from './dom';
import { t } from './i18n';
import { errorText } from './i18n/hub';
import type { Store } from './store';
import type { Recording } from './types';

export const REPLAY_SPEEDS = [1, 4, 16] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

const MAX_FRAME_MS = 250;

function isRecording(value: unknown): value is Recording {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && typeof record.startedAt === 'number' && Array.isArray(record.messages);
}

async function failure(response: Response): Promise<Error> {
  try {
    const body: unknown = await response.json();
    const text = typeof body === 'object' && body !== null ? errorText(t, (body as { error?: unknown }).error) : null;
    if (text) return new Error(text);
  } catch {}
  return new Error(`HTTP ${response.status}`);
}

// Pure: the URL to fetch for ?replay=<url>. For a recording the hub builds, compress=1 of the page goes with it.
export function replayFetchUrl(url: string, search: URLSearchParams): string {
  if (!url.startsWith('/api/') || search.get('compress') !== '1' || /[?&]compress=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}compress=1`;
}

// token: the panel credential, sent only to the hub's own /api/ routes (a recording on disk gets none).
export async function loadRecording(url: string, token: string | null = null): Promise<Recording> {
  const response = await fetch(url, token && url.startsWith('/api/') ? { headers: { 'X-Office-Panel': token } } : undefined);
  if (response.status === 401) throw new Error(t('auth.expired'));
  if (!response.ok) throw await failure(response);
  const data: unknown = await response.json();
  if (!isRecording(data)) throw new Error(t('replay.badFormat'));
  return { ...data, messages: [...data.messages].sort((a, b) => a.t - b.t) };
}

export class ReplayPlayer {
  speed: ReplaySpeed = 1;
  playing = false;
  elapsed = 0;

  private index = 0;
  private lastFrame = 0;
  private frame = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly recording: Recording,
    private readonly store: Store,
  ) {
    store.setReplay(true);
    store.setConnection('replay');
    store.setClock(() => this.recording.startedAt + this.elapsed);
  }

  get duration(): number {
    const last = this.recording.messages[this.recording.messages.length - 1];
    return last ? last.t : 0;
  }

  get finished(): boolean {
    return this.index >= this.recording.messages.length;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    this.deliver();
    this.play();
  }

  play(): void {
    if (this.playing) return;
    if (this.finished && this.elapsed > 0) this.rewind();
    this.playing = true;
    this.lastFrame = performance.now();
    this.frame = requestAnimationFrame(this.step);
    this.emit();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: ReplaySpeed): void {
    this.speed = speed;
    this.emit();
  }

  restart(): void {
    const wasPlaying = this.playing;
    this.pause();
    this.rewind();
    this.deliver();
    if (wasPlaying) this.play();
    else this.emit();
  }

  private rewind(): void {
    this.store.reset();
    this.elapsed = 0;
    this.index = 0;
  }

  private readonly step = (time: number): void => {
    const delta = Math.min(time - this.lastFrame, MAX_FRAME_MS);
    this.lastFrame = time;
    this.elapsed += delta * this.speed;
    this.deliver();
    if (this.finished) {
      this.elapsed = Math.min(this.elapsed, this.duration);
      this.playing = false;
    } else {
      this.frame = requestAnimationFrame(this.step);
    }
    this.emit();
  };

  private deliver(): void {
    const { messages } = this.recording;
    while (this.index < messages.length && messages[this.index].t <= this.elapsed) {
      this.store.apply(messages[this.index].msg);
      this.index += 1;
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function mountReplayControls(host: HTMLElement, player: ReplayPlayer, store: Store): void {
  const label = el('span', 'replay-label');
  const restart = button('↺', 'icon-button');
  const toggle = button('', 'icon-button primary');
  const speeds = REPLAY_SPEEDS.map((speed) => {
    const speedButton = button(`${speed}x`, 'speed-button');
    speedButton.addEventListener('click', () => player.setSpeed(speed));
    return speedButton;
  });
  const fill = el('div', 'replay-progress-fill');
  const bar = el('div', 'replay-progress', fill);
  const time = el('span', 'replay-time');

  restart.addEventListener('click', () => player.restart());
  toggle.addEventListener('click', () => player.toggle());

  host.replaceChildren(label, restart, toggle, ...speeds, bar, time);

  const render = (): void => {
    label.textContent = t('replay.label');
    restart.title = t('replay.restart');
    toggle.textContent = player.playing ? '❚❚' : '▶';
    toggle.title = player.playing ? t('replay.pause') : t('replay.play');
    speeds.forEach((speedButton, index) => {
      speedButton.title = t('replay.speed', { n: REPLAY_SPEEDS[index] });
      speedButton.classList.toggle('active', REPLAY_SPEEDS[index] === player.speed);
    });
    const duration = player.duration;
    fill.style.width = duration > 0 ? `${Math.min(100, (player.elapsed / duration) * 100)}%` : '0%';
    time.textContent = `${mmss(player.elapsed)} / ${mmss(duration)}`;
  };

  player.onChange(render);
  store.watch(['lang'], render);
}
