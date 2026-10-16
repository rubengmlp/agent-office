import type { ChatClaimView, ChatMessageView } from '../types';

// The same rule as ChatDesk.openClaims in the hub, over the messages the panel holds.
export const CLAIM_TTL_MS = 4 * 3_600_000;

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes('/') && b.includes('/')) return false;
  return baseName(a) === baseName(b);
}

// Files someone announced with toca and has not released with listo yet, from the last four hours.
export function openClaims(messages: readonly ChatMessageView[], now: number): ChatClaimView[] {
  const recent = messages
    .filter((message) => (message.kind === 'toca' || message.kind === 'listo') && message.ts >= now - CLAIM_TTL_MS)
    .sort((a, b) => a.id - b.id);
  let open: ChatClaimView[] = [];
  for (const message of recent) {
    open = open.filter((claim) => claim.authorKey !== message.authorKey || !message.files.some((file) => samePath(file, claim.file)));
    if (message.kind !== 'toca') continue;
    for (const file of message.files) open.push({ file, authorKey: message.authorKey, authorName: message.authorName, ts: message.ts, id: message.id });
  }
  return open;
}
