import { existsSync } from 'node:fs';
import {
  DEFAULT_CONFIG,
  PROFILES_DIR,
  REPO_ROOT,
  createKeyIfMissing,
  ensureHome,
  loadConfig,
  paths,
  rotateKey,
  saveConfig,
  writePortFile,
} from './config';
import { askYesNo, expandHome, FloorError, planFloor, writeFloor } from './floor-cli';
import { realPath } from './floors';
import { writeOfficeScripts } from './office-sh';
import { loadProfiles } from './profiles';

const CANDIDATE_FLOORS = ['~/Projects/mobile', '~/Projects/backend'];

function run(cmd: string[]): void {
  console.log(`$ ${cmd.join(' ')}`);
  const result = Bun.spawnSync(cmd, { stdout: 'inherit', stderr: 'inherit' });
  if (result.exitCode !== 0) console.log(`  terminó con código ${result.exitCode}`);
}

async function setup(argv: string[]): Promise<void> {
  const p = paths();
  if (argv.includes('--rotate-key')) {
    rotateKey(p);
    console.log(`Key nueva en ${p.key}.`);
    console.log('Reinicia el hub y recarga la pestaña de la oficina. Los hooks leen la key en cada evento, así que las sesiones abiertas siguen funcionando.');
    return;
  }
  const yes = argv.includes('--yes');
  const confirm = (question: string) => (yes ? Promise.resolve(true) : askYesNo(question));

  ensureHome(p);
  const { created } = createKeyIfMissing(p);
  console.log(created ? `Key creada en ${p.key}` : `Key existente en ${p.key}`);
  if (!existsSync(p.config)) {
    saveConfig(p, structuredClone(DEFAULT_CONFIG));
    console.log(`Configuración creada en ${p.config}`);
  }
  writePortFile(p, loadConfig(p).port);

  console.log('');
  console.log('El plugin "office" se instala a nivel de usuario: sus hooks se ejecutan en todas tus sesiones de Claude Code.');
  console.log('Si el hub no está arrancado, salen al momento sin escribir nada.');
  if (await confirm('¿Registrar el marketplace local e instalar el plugin?')) {
    run(['claude', 'plugin', 'marketplace', 'add', REPO_ROOT]);
    run(['claude', 'plugin', 'install', 'office@agent-office']);
  }

  const profiles = loadProfiles(PROFILES_DIR);
  for (const candidate of CANDIDATE_FLOORS) {
    const dir = expandHome(candidate);
    if (!existsSync(dir)) continue;
    const already = Object.values(loadConfig(p).floors).some((f) => realPath(f.path) === realPath(dir));
    if (already) continue;
    if (!(await confirm(`¿Añadir ${candidate} como planta gestionada?`))) continue;
    try {
      const plan = planFloor(p, profiles, dir);
      if (plan.existing.length > 0 && !(await confirm(`Ya existen agentes de ${plan.slug}. ¿Sobrescribirlos?`))) continue;
      writeFloor(p, profiles, plan);
      console.log(`Planta ${plan.slug} (${plan.profile.label}) gestionada`);
    } catch (error) {
      if (!(error instanceof FloorError)) throw error;
      console.log(error.message);
    }
  }
  writeOfficeScripts(p, loadConfig(p), profiles);

  console.log('');
  console.log('Siguientes pasos:');
  console.log('  bun run build     compila la interfaz');
  console.log('  bun run office    arranca el hub, abre la oficina y las sesiones del director y los jefes de planta');
  console.log('  bun run hub       solo el hub');
  console.log('Las sesiones que abre office.sh activan agent teams y las herramientas de tareas solo para ellas: tu configuración global no cambia.');
}

if (import.meta.main) await setup(process.argv.slice(2));
