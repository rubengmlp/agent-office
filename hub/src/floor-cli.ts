import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { PROFILES_DIR, TEMPLATES_DIR, loadConfig, paths, saveConfig, writeAtomic, type Paths } from './config';
import { DIRECCION, UNKNOWN_FLOOR, realPath, slugify } from './floors';
import { writeOfficeScripts } from './office-sh';
import { detectStack, loadProfiles, profileFor, type CompiledProfile, type Profiles } from './profiles';
import type { Stack } from './types';

export const ROLES = ['lead', 'dev', 'tester'] as const;
export type Role = (typeof ROLES)[number];

export class FloorError extends Error {}

export type FloorPlan = {
  slug: string;
  path: string;
  stack: Stack;
  profile: CompiledProfile;
  files: { role: Role; file: string; content: string }[];
  existing: string[];
};

export function expandHome(path: string): string {
  if (path === '~') return homedir();
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

export function agentFile(p: Paths, role: Role, slug: string): string {
  return join(p.agentsDir, `office-${role}-${slug}.md`);
}

export function skillLine(profile: CompiledProfile): string {
  return profile.skill
    ? `Invoca la skill \`${profile.skill}\` con la herramienta Skill antes de abrir ningún fichero.`
    : 'Este repositorio no tiene una skill propia: lee su CLAUDE.md antes de abrir ningún fichero.';
}

export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new FloorError(`La plantilla usa una variable sin valor: ${name}`);
    return value;
  });
}

export function checkSlug(slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new FloorError(`"${slug}" no vale como nombre de planta: usa minúsculas, números y guiones.`);
  }
  if (slug === DIRECCION || slug === UNKNOWN_FLOOR) throw new FloorError(`"${slug}" es un nombre reservado.`);
  return slug;
}

function resolveDir(target: string): string {
  const abs = resolve(expandHome(target));
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    throw new FloorError(`No existe ${abs}`);
  }
  if (!statSync(real).isDirectory()) throw new FloorError(`${real} no es una carpeta`);
  return real;
}

export function planFloor(
  p: Paths,
  profiles: Profiles,
  target: string,
  slugOverride?: string,
  templatesDir = TEMPLATES_DIR,
): FloorPlan {
  const path = resolveDir(target);
  const slug = checkSlug(slugOverride ?? slugify(basename(path)));
  const config = loadConfig(p);
  const taken = config.floors[slug];
  if (taken && realPath(taken.path) !== path) {
    throw new FloorError(`El nombre "${slug}" ya es la planta de ${taken.path}. Elige otro con --slug.`);
  }
  for (const [other, floor] of Object.entries(config.floors)) {
    if (other !== slug && realPath(floor.path) === path) throw new FloorError(`${path} ya es la planta "${other}".`);
  }
  const stack = detectStack(path);
  const profile = profileFor(profiles, stack);
  const vars = {
    slug,
    path,
    label: profile.label,
    testCommand: profile.testCommand,
    skillLine: skillLine(profile),
  };
  const files = ROLES.map((role) => ({
    role,
    file: agentFile(p, role, slug),
    content: render(readFileSync(join(templatesDir, `${role}.md.tpl`), 'utf8'), vars),
  }));
  return { slug, path, stack, profile, files, existing: files.map((f) => f.file).filter((f) => existsSync(f)) };
}

export function writeFloor(p: Paths, profiles: Profiles, plan: FloorPlan): string {
  mkdirSync(p.agentsDir, { recursive: true });
  for (const f of plan.files) writeAtomic(f.file, f.content, 0o644);
  const config = loadConfig(p);
  config.floors[plan.slug] = { path: plan.path, stack: plan.stack, managed: true };
  saveConfig(p, config);
  writeOfficeScripts(p, config, profiles);
  return `cd ${plan.path} && claude --agent office-lead-${plan.slug} --name lead-${plan.slug}`;
}

export function regenerateAll(p: Paths, profiles: Profiles, templatesDir = TEMPLATES_DIR): { slug: string; error?: string }[] {
  const results: { slug: string; error?: string }[] = [];
  for (const [slug, floor] of Object.entries(loadConfig(p).floors)) {
    if (!floor.managed) continue;
    try {
      writeFloor(p, profiles, planFloor(p, profiles, floor.path, slug, templatesDir));
      results.push({ slug });
    } catch (error) {
      results.push({ slug, error: (error as Error).message });
    }
  }
  writeOfficeScripts(p, loadConfig(p), profiles);
  return results;
}

export function removeFloor(p: Paths, profiles: Profiles, slug: string): string[] {
  const config = loadConfig(p);
  const floor = config.floors[slug];
  if (!floor) throw new FloorError(`No hay ninguna planta "${slug}".`);
  const removed: string[] = [];
  for (const role of ROLES) {
    const file = agentFile(p, role, slug);
    if (existsSync(file)) {
      rmSync(file);
      removed.push(file);
    }
  }
  config.floors[slug] = { ...floor, managed: false };
  saveConfig(p, config);
  writeOfficeScripts(p, config, profiles);
  return removed;
}

export function listFloors(p: Paths, profiles: Profiles): string {
  const rows = Object.entries(loadConfig(p).floors).sort(([a], [b]) => a.localeCompare(b));
  if (rows.length === 0) return 'No hay plantas configuradas. Añade una con: bun run floor add <ruta>';
  const lines = rows.map(([slug, floor]) => {
    const label = profileFor(profiles, floor.stack).label;
    return `${slug.padEnd(16)} ${(floor.managed ? 'gestionada' : 'observada').padEnd(11)} ${label.padEnd(9)} ${floor.path}`;
  });
  return [`${'PLANTA'.padEnd(16)} ${'TIPO'.padEnd(11)} ${'STACK'.padEnd(9)} RUTA`, ...lines].join('\n');
}

export async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [s/N] `);
    return /^(s|si|sí|y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

const USAGE = `Uso:
  bun run floor add <ruta> [--slug <nombre>] [--yes]
  bun run floor add --all
  bun run floor remove <nombre>
  bun run floor list`;

async function cli(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const p = paths();
  const profiles = loadProfiles(PROFILES_DIR);
  const flag = (name: string) => rest.includes(name);
  const option = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const positional = rest.filter((arg, i) => !arg.startsWith('--') && rest[i - 1] !== '--slug');

  if (command === 'add' && flag('--all')) {
    for (const r of regenerateAll(p, profiles)) {
      console.log(r.error ? `${r.slug}: ${r.error}` : `${r.slug}: agentes regenerados`);
    }
    return;
  }
  if (command === 'add' && positional[0]) {
    const plan = planFloor(p, profiles, positional[0], option('--slug'));
    if (plan.existing.length > 0 && !flag('--yes')) {
      const ok = await askYesNo(`Ya existen ${plan.existing.length} agentes de la planta ${plan.slug}. ¿Sobrescribirlos?`);
      if (!ok) throw new FloorError('Cancelado: no se ha tocado nada. Usa --yes para sobrescribir sin preguntar.');
    }
    const startCommand = writeFloor(p, profiles, plan);
    console.log(`Planta ${plan.slug} (${plan.profile.label}) gestionada en ${plan.path}`);
    for (const f of plan.files) console.log(`  ${f.file}`);
    console.log(`Arranca su jefe de planta con bun run office, o a mano:\n  ${startCommand}`);
    return;
  }
  if (command === 'remove' && positional[0]) {
    const removed = removeFloor(p, profiles, positional[0]);
    console.log(`Planta ${positional[0]} pasa a observada. Agentes borrados: ${removed.length}`);
    return;
  }
  if (command === 'list') {
    console.log(listFloors(p, profiles));
    return;
  }
  console.log(USAGE);
  process.exitCode = 1;
}

if (import.meta.main) {
  cli(process.argv.slice(2)).catch((error: unknown) => {
    if (error instanceof FloorError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  });
}
