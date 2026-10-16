import { createHmac, randomBytes } from 'node:crypto';
import { keyMatches } from './security';

export const LAUNCH_TTL_MS = 10 * 60_000;
export const PANEL_TTL_MS = 30 * 86_400_000;

const LAUNCH = /^l1\.([0-9a-z]{1,11})\.([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;
const PANEL = /^p1\.([0-9a-z]{1,11})\.([A-Za-z0-9_-]{43})$/;

function mac(key: string, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

function issuedAt(ts36: string, now: number, ttl: number): number | null {
  const ts = Number.parseInt(ts36, 36);
  return Number.isSafeInteger(ts) && ts <= now && now - ts < ttl ? ts : null;
}

export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

export function mintLaunchToken(key: string, now: number, nonce: string): string {
  const ts = now.toString(36);
  return `l1.${ts}.${nonce}.${mac(key, `launch:${ts}:${nonce}`)}`;
}

// Spends the link: true once per nonce while it is fresh. `used` maps a spent nonce to when it stops mattering.
export function claimLaunchToken(key: string, token: unknown, now: number, used: Map<string, number>): boolean {
  for (const [nonce, until] of used) if (until <= now) used.delete(nonce);
  if (!key || typeof token !== 'string') return false;
  const match = LAUNCH.exec(token);
  if (!match) return false;
  const [, ts36, nonce, given] = match as unknown as [string, string, string, string];
  const ts = issuedAt(ts36, now, LAUNCH_TTL_MS);
  if (ts === null || !keyMatches(given, mac(key, `launch:${ts36}:${nonce}`)) || used.has(nonce)) return false;
  used.set(nonce, ts + LAUNCH_TTL_MS);
  return true;
}

export function mintPanelToken(key: string, now: number): string {
  const ts = now.toString(36);
  return `p1.${ts}.${mac(key, `panel:${ts}`)}`;
}

export function verifyPanelToken(key: string, token: unknown, now: number): boolean {
  if (!key || typeof token !== 'string') return false;
  const match = PANEL.exec(token);
  if (!match) return false;
  const [, ts36, given] = match as unknown as [string, string, string];
  return issuedAt(ts36, now, PANEL_TTL_MS) !== null && keyMatches(given, mac(key, `panel:${ts36}`));
}
