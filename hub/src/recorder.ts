import { writeAtomic } from './config';
import type { Office } from './office';
import type { Recording } from './types';

export type RunningRecorder = { flush: () => void; stop: () => void };

export function startRecording(office: Office, file: string, now: () => number = Date.now): RunningRecorder {
  const startedAt = now();
  const messages: Recording['messages'] = [{ t: 0, msg: { type: 'snapshot', data: office.snapshot() } }];
  const unsubscribe = office.subscribe((msg) => {
    messages.push({ t: now() - startedAt, msg });
  });
  const flush = () => {
    const recording: Recording = { version: 1, startedAt, messages };
    writeAtomic(file, JSON.stringify(recording), 0o600);
  };
  const timer = setInterval(flush, 5000);
  return {
    flush,
    stop: () => {
      clearInterval(timer);
      unsubscribe();
      flush();
    },
  };
}
