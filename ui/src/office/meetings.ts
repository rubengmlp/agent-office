import type { MessageView } from '../types';

export const MEETING_WINDOW_MS = 120_000;

export type MeetingPair = { a: string; b: string };

export function findMeetingPairs(messages: readonly MessageView[], now: number): MeetingPair[] {
  const sent = new Set<string>();
  for (const message of messages) {
    if (message.toKey === null || message.toKey === message.fromKey) continue;
    if (now - message.ts > MEETING_WINDOW_MS) continue;
    sent.add(`${message.fromKey}\u0000${message.toKey}`);
  }
  const pairs: MeetingPair[] = [];
  for (const entry of sent) {
    const [from, to] = entry.split('\u0000');
    if (from < to && sent.has(`${to}\u0000${from}`)) pairs.push({ a: from, b: to });
  }
  return pairs.sort((x, y) => `${x.a}${x.b}`.localeCompare(`${y.a}${y.b}`));
}
