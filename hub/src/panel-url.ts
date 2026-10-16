import { readFileSync } from 'node:fs';
import { defaultConfig, paths, readKey, type Paths } from './config';
import { mintLaunchToken, newNonce } from './panel-auth';

export function panelUrl(port: number, key: string, now: number, nonce: string): string {
  return `http://127.0.0.1:${port}/?t=${mintLaunchToken(key, now, nonce)}`;
}

export function hubPort(p: Paths): number {
  try {
    const port = Number(readFileSync(p.port, 'utf8').trim());
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  } catch {}
  return defaultConfig().port;
}

function main(argv: string[]): void {
  const p = paths();
  const key = readKey(p);
  if (!key) {
    console.error('No hay key de Agent Office. Ejecuta primero: bun run setup');
    process.exit(1);
  }
  const url = panelUrl(hubPort(p), key, Date.now(), newNonce());
  if (argv.includes('--print') || process.platform !== 'darwin') {
    console.log(url);
    return;
  }
  Bun.spawn(['open', url]);
  console.log('Panel abierto en el navegador. El enlace sirve una sola vez durante 10 minutos.');
}

if (import.meta.main) main(process.argv.slice(2));
