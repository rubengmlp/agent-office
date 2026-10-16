import { appendFileSync, chmodSync, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type Log = (text: string) => void;

export const LOG_MAX_BYTES = 1_000_000;

// hub.log in the home folder, mode 600 (also when it already existed with another mode). Past maxBytes the file moves to hub.log.1 (the previous one is overwritten).
export function createLog(home: string, opts: { maxBytes?: number } = {}): Log {
  const file = join(home, 'hub.log');
  const maxBytes = opts.maxBytes ?? LOG_MAX_BYTES;
  try {
    if (existsSync(file)) chmodSync(file, 0o600);
  } catch {}
  return (text) => {
    try {
      const line = `${new Date().toISOString()} ${text}\n`;
      let size = 0;
      try {
        size = statSync(file).size;
      } catch {}
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) renameSync(file, `${file}.1`);
      appendFileSync(file, line, { mode: 0o600 });
    } catch {}
  };
}

export const noLog: Log = () => {};
