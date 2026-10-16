import type { Database } from 'bun:sqlite';
import type { Office } from './office';

export const SHUTDOWN_MS = 5000;

export type ShutdownResult = { timedOut: boolean };

// Stop taking requests, let the commits and git calls still running finish (up to timeoutMs) and only then close the database.
export async function shutdownSequence(opts: {
  stopServer: () => void;
  office: Pick<Office, 'stop' | 'idle'>;
  db: Pick<Database, 'close'>;
  timeoutMs?: number;
}): Promise<ShutdownResult> {
  opts.stopServer();
  opts.office.stop();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), opts.timeoutMs ?? SHUTDOWN_MS);
  });
  try {
    const outcome = await Promise.race([opts.office.idle().then(() => 'idle' as const), timeout]);
    return { timedOut: outcome === 'timeout' };
  } finally {
    clearTimeout(timer);
    opts.db.close();
  }
}
