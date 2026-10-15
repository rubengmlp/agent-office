import type { AgentState, AgentView } from './types';

const SWAPPABLE: ReadonlySet<AgentState> = new Set<AgentState>(['reading', 'working']);

type Entry = {
  shown: AgentState;
  pending: AgentState | null;
  timer: number | undefined;
};

export class StateDebouncer {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly onSettle: () => void,
    private readonly delayMs = 400,
  ) {}

  observe(agent: AgentView): void {
    const entry = this.entries.get(agent.key);
    if (!entry) {
      this.entries.set(agent.key, { shown: agent.state, pending: null, timer: undefined });
      return;
    }
    if (agent.state === entry.shown) {
      this.cancel(entry);
      return;
    }
    if (SWAPPABLE.has(entry.shown) && SWAPPABLE.has(agent.state)) {
      if (entry.pending === agent.state) return;
      this.cancel(entry);
      entry.pending = agent.state;
      entry.timer = window.setTimeout(() => {
        if (entry.pending === null) return;
        entry.shown = entry.pending;
        entry.pending = null;
        entry.timer = undefined;
        this.onSettle();
      }, this.delayMs);
      return;
    }
    this.cancel(entry);
    entry.shown = agent.state;
  }

  shown(key: string): AgentState | undefined {
    return this.entries.get(key)?.shown;
  }

  forget(key: string): void {
    const entry = this.entries.get(key);
    if (entry) this.cancel(entry);
    this.entries.delete(key);
  }

  clear(): void {
    for (const entry of this.entries.values()) this.cancel(entry);
    this.entries.clear();
  }

  private cancel(entry: Entry): void {
    if (entry.timer !== undefined) window.clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.pending = null;
  }
}
