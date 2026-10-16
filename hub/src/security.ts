import { timingSafeEqual } from 'node:crypto';

export const DEV_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];

export function hostAllowed(host: string | null | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function keyMatches(given: string | null | undefined, key: string): boolean {
  if (!given || !key) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function originAllowed(origin: string | null | undefined, port: number, dev: boolean): boolean {
  if (!origin) return false;
  if (origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`) return true;
  return dev && DEV_ORIGINS.includes(origin);
}
