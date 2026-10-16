import type { Log } from './log';
import { MAX_ACTIVITY } from './office-state';
import type { ActivityView, ServerMessage } from './types';

export class OfficeBus {
  private readonly listeners = new Set<(msg: ServerMessage) => void>();
  private readonly activity: ActivityView[] = [];
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly log: Log) {}

  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  subscribe(listener: (msg: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  background(task: Promise<unknown>): void {
    const tracked = task.catch((error: unknown) => {
      this.log(`tarea en segundo plano fallida: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    });
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }

  pushActivity(entry: ActivityView): void {
    this.activity.push(entry);
    if (this.activity.length > MAX_ACTIVITY) this.activity.splice(0, this.activity.length - MAX_ACTIVITY);
    this.emit({ type: 'activity', data: entry });
  }

  recent(): ActivityView[] {
    return this.activity.slice(-MAX_ACTIVITY);
  }

  forget(keys: ReadonlySet<string>): void {
    const kept = this.activity.filter((entry) => !keys.has(entry.agentKey));
    this.activity.splice(0, this.activity.length, ...kept);
  }

  emit(msg: ServerMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(msg);
      } catch (error) {
        this.log(`un oyente falló con ${msg.type}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      }
    }
  }
}
