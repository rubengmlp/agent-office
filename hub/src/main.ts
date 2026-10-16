import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROFILES_DIR,
  PUBLIC_DIR,
  RAW_FIXTURES_DIR,
  WORKSPACE_DIR,
  loadConfig,
  paths,
  readKey,
  writePortFile,
  type Paths,
} from './config';
import { configTargets, watchTargets } from './config-watch';
import { dbRegistry, openDb } from './db';
import { Office } from './office';
import { loadProfiles } from './profiles';
import { prune } from './prune';
import { startRecording } from './recorder';
import { startServer } from './server';
import { createSettings } from './settings';

const DAY_MS = 86_400_000;
const TICK_MS = 5000;

export function main(argv: string[]): void {
  const p = paths();
  const key = readKey(p);
  if (!key) {
    console.error('No hay key de Agent Office. Ejecuta primero: bun run setup');
    process.exit(1);
  }
  let config = loadConfig(p);
  writePortFile(p, config.port);
  const db = openDb(p.db);
  const office = new Office({
    db,
    config,
    profiles: loadProfiles(PROFILES_DIR),
    workspaceDir: WORKSPACE_DIR,
    claudeHome: p.claudeHome,
    registry: dbRegistry(db),
    rawDir: process.env.AGENT_OFFICE_RAW === '1' ? RAW_FIXTURES_DIR : null,
  });
  const recorder = process.env.AGENT_OFFICE_RECORD ? startRecording(office, process.env.AGENT_OFFICE_RECORD) : null;
  const reload = () => {
    try {
      config = loadConfig(p);
      office.reload(config, loadProfiles(PROFILES_DIR));
      console.log('Configuración recargada');
    } catch (error) {
      console.error(`No se pudo recargar la configuración: ${(error as Error).message}`);
    }
  };
  const settings = createSettings(p, () => loadProfiles(PROFILES_DIR), reload);
  const { stop } = startServer({
    office,
    port: config.port,
    key: () => key,
    publicDir: PUBLIC_DIR,
    dev: process.env.AGENT_OFFICE_DEV === '1',
    settings,
  });
  const stopWatching = watchTargets(configTargets(p.home, PROFILES_DIR), reload);
  office.start();
  const daily = () => {
    prune(db, Date.now(), config.retentionDays);
    office.expireSources().catch((error: unknown) => console.error(`No se pudieron retirar fuentes antiguas: ${(error as Error).message}`));
  };
  daily();
  const pruneTimer = setInterval(daily, DAY_MS);
  const tickTimer = setInterval(() => office.tick(), TICK_MS);

  const url = `http://127.0.0.1:${config.port}`;
  console.log(`Agent Office escuchando en ${url}`);
  if (!existsSync(join(PUBLIC_DIR, 'index.html'))) console.log('La interfaz no está compilada: bun run build');
  if (process.env.AGENT_OFFICE_RECORD) console.log(`Grabando en ${process.env.AGENT_OFFICE_RECORD}`);
  if (argv.includes('--open')) openSessions(p, url);

  process.on('uncaughtException', (error) => {
    console.error(`Agent Office: error no capturado: ${error.stack ?? String(error)}`);
  });
  process.on('unhandledRejection', (reason) => {
    console.error(`Agent Office: promesa rechazada sin capturar: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
  });

  const shutdown = (signal: string) => {
    console.log(`Agent Office: ${signal} recibido, cerrando el hub`);
    clearInterval(pruneTimer);
    clearInterval(tickTimer);
    stopWatching();
    office.stop();
    recorder?.stop();
    stop();
    db.close();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => shutdown(signal));
}

function openSessions(p: Paths, url: string): void {
  if (process.platform === 'darwin') Bun.spawn(['open', url]);
  if (!existsSync(p.officeSh)) {
    console.log('No hay sesiones que abrir: añade una planta con bun run floor add <ruta>');
    return;
  }
  Bun.spawn(['sh', p.officeSh], { stdout: 'inherit', stderr: 'inherit' });
}

if (import.meta.main) main(process.argv.slice(2));
