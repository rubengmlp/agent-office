import type { OfficeApi } from './api';
import { TODAY_POLL_MS } from './boards';
import type { UsageSummary } from './types';

// The spend of today for the board of the direction, asked every minute and only while the Oficina tab is up.
export class UsageToday {
  private summary: UsageSummary | null = null;
  private timer: number | null = null;
  private fetchedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly api: OfficeApi) {}

  get latest(): UsageSummary | null {
    return this.summary;
  }

  setActive(active: boolean): void {
    if (!active) {
      if (this.timer !== null) window.clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (this.timer !== null) return;
    if (Date.now() - this.fetchedAt >= TODAY_POLL_MS) void this.fetch();
    this.timer = window.setInterval(() => void this.fetch(), TODAY_POLL_MS);
  }

  private async fetch(): Promise<void> {
    this.fetchedAt = Date.now();
    const result = await this.api.usageSummary('today');
    if (result.ok) this.summary = result.data;
  }
}
