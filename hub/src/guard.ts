import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { isInside, realPath } from './floors';
import type { GateDecision } from './gate';
import type { GitRunner } from './git';
import { departmentOf } from './scope';
import { text } from './state-machine';
import { SLUG_PATTERN } from './sync';
import type { GuardAlertLevel } from './types';

export const GUARDED_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash']);

export type GuardFloor = { slug: string; path: string };

export type GuardContext = { docsRoot: string; claudeHome: string; floors: GuardFloor[]; home?: string };

export type GuardInput = { tool: string; input: Record<string, unknown>; cwd: string | null; role: string | null; name?: string | null };

// order: the slug of the plan or the name of the skill the zone is narrowed to, or null for the department zone.
export type Zones = { label: string; order: string | null; allowed: string[]; forbidden: string[] };

export type ShellPath = { path: string; write: boolean };

const PASS: GateDecision = { pass: true, reason: 'permitido' };

const WRITE_ALL = new Set(['rm', 'rmdir', 'mkdir', 'touch', 'chmod', 'chown', 'truncate', 'unlink', 'tee', 'shred']);
const WRITE_LAST = new Set(['cp', 'mv', 'rsync', 'install', 'ln', 'scp', 'ditto']);
const INTERPRETERS = new Set(['python', 'python3', 'node', 'bun', 'bash', 'sh', 'zsh', 'ruby', 'deno', 'perl', 'npx', 'bunx', 'uv', 'uvx']);
const GIT_WRITES = new Set([
  'add', 'am', 'apply', 'checkout', 'cherry-pick', 'clean', 'clone', 'commit', 'init', 'merge', 'mv', 'pull',
  'push', 'rebase', 'reset', 'restore', 'revert', 'rm', 'stash', 'switch', 'tag', 'worktree',
]);
const OUTPUT_FLAGS = new Set(['-o', '--output', '--out', '--path', '--dest', '--destination', '--target', '--output-dir', '--outdir']);

// The order of a writer (redactor-<slug>) or a skillwright (artesano-<name>), from the name its lead gave it.
// Anyone else, or a name that does not fit, has none and keeps the department zone.
export function orderOf(role: string | null, name: string | null): string | null {
  const prefix = role === 'office-redactor' ? 'redactor-' : role === 'office-artesano' ? 'artesano-' : null;
  if (!prefix || !name?.startsWith(prefix)) return null;
  const order = name.slice(prefix.length);
  return SLUG_PATTERN.test(order) ? order : null;
}

// Without a name (not known yet, or none) the zone is the department's: the order only ever narrows it.
export function zonesFor(role: string | null, ctx: GuardContext, name: string | null = null): Zones | null {
  const department = departmentOf(role);
  if (!department) return null;
  const order = orderOf(role, name);
  if (order && department === 'redaccion') {
    return {
      label: `redactor-${order}`,
      order,
      allowed: [join(ctx.docsRoot, 'redaccion', 'planes', `${order}.md`), join(ctx.docsRoot, 'redaccion', 'historial', `${order}.md`)],
      forbidden: [join(ctx.docsRoot, 'redaccion', '.fuentes')],
    };
  }
  if (order) return { label: `artesano-${order}`, order, allowed: [join(ctx.docsRoot, 'taller', 'skills', order)], forbidden: [] };
  if (department === 'redaccion') {
    return {
      label: 'Redacción',
      order: null,
      allowed: [join(ctx.docsRoot, 'redaccion')],
      forbidden: [join(ctx.docsRoot, 'redaccion', '.fuentes')],
    };
  }
  const allowed = [join(ctx.docsRoot, 'taller')];
  if (role === 'office-lead-mantenimiento') {
    allowed.push(join(ctx.claudeHome, 'skills'), ...ctx.floors.map((f) => join(f.path, '.claude', 'skills')));
  }
  return { label: 'Mantenimiento', order: null, allowed, forbidden: [] };
}

export function inZone(path: string, zones: Zones): boolean {
  return zones.allowed.some((a) => isInside(path, a)) && !zones.forbidden.some((f) => isInside(path, f));
}

export function resolvePath(raw: string, cwd: string | null, home = homedir()): string {
  let value = raw;
  if (value === '~' || value.startsWith('~/')) value = join(home, value.slice(1));
  else if (value.startsWith('$HOME/') || value === '$HOME') value = join(home, value.slice(5));
  else if (value.startsWith('${HOME}')) value = join(home, value.slice(7));
  const abs = isAbsolute(value) ? value : resolve(cwd ?? home, value);
  return realPath(abs);
}

export function tokenize(command: string): string[][] {
  const segments: string[][] = [];
  let words: string[] = [];
  let word = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  const endWord = () => {
    if (started) words.push(word);
    word = '';
    started = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? '';
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      word += command[++i];
      started = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      endWord();
      continue;
    }
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '(' || ch === ')') {
      endSegment();
      continue;
    }
    if (ch === '&') {
      if (command[i + 1] === '>') {
        endWord();
        words.push('>');
        i++;
        if (command[i + 1] === '>') i++;
      } else endSegment();
      continue;
    }
    if (ch === '>' || ch === '<') {
      if (/^\d+$/.test(word)) {
        word = '';
        started = false;
      } else endWord();
      if (ch === '>' && command[i + 1] === '>') i++;
      if (ch === '>' && command[i + 1] === '|') i++;
      if (command[i + 1] === '&') {
        i++;
        while (i + 1 < command.length && /[0-9-]/.test(command[i + 1] ?? '')) i++;
        continue;
      }
      words.push(ch);
      continue;
    }
    word += ch;
    started = true;
  }
  endSegment();
  return segments;
}

function looksLikePath(word: string): boolean {
  return word.includes('/') || word.startsWith('~') || word.startsWith('$HOME') || word.startsWith('${HOME}') || word === '.' || word === '..';
}

export function shellPaths(command: string): ShellPath[] {
  const out: ShellPath[] = [];
  for (const segment of tokenize(command)) {
    const words = [...segment];
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) words.shift();
    if (words.length === 0) continue;
    const cmdWord = words.shift() ?? '';
    const cmd = basename(cmdWord);
    if (looksLikePath(cmdWord)) out.push({ path: cmdWord, write: false });
    const args: string[] = [];
    let nextIsWrite = false;
    let nextIsRead = false;
    let gitDir: string | null = null;
    let sedInPlace = false;
    let tarExtract = false;
    for (let i = 0; i < words.length; i++) {
      const w = words[i] ?? '';
      if (w === '>') {
        nextIsWrite = true;
        continue;
      }
      if (w === '<') {
        nextIsRead = true;
        continue;
      }
      if (nextIsWrite) {
        out.push({ path: w, write: true });
        nextIsWrite = false;
        continue;
      }
      if (nextIsRead) {
        if (looksLikePath(w)) out.push({ path: w, write: false });
        nextIsRead = false;
        continue;
      }
      if (cmd === 'git' && w === '-C' && words[i + 1]) {
        gitDir = words[++i] ?? null;
        continue;
      }
      if (OUTPUT_FLAGS.has(w) && words[i + 1] && words[i + 1] !== '>') {
        out.push({ path: words[++i] ?? '', write: true });
        continue;
      }
      if (w.startsWith('--') && w.includes('=')) {
        const [flag, value] = [w.slice(0, w.indexOf('=')), w.slice(w.indexOf('=') + 1)];
        if (OUTPUT_FLAGS.has(flag)) out.push({ path: value, write: true });
        else if (looksLikePath(value)) out.push({ path: value, write: false });
        continue;
      }
      if (cmd === 'dd' && w.startsWith('of=')) {
        out.push({ path: w.slice(3), write: true });
        continue;
      }
      if ((cmd === 'sed' || cmd === 'perl') && /^-[a-zA-Z]*i/.test(w)) sedInPlace = true;
      if (cmd === 'tar' && /^-?[a-zA-Z]*x/.test(w) && !w.startsWith('--')) tarExtract = true;
      if (w.startsWith('-')) continue;
      args.push(w);
    }
    const gitWrite = cmd === 'git' && args.some((a) => GIT_WRITES.has(a));
    if (gitDir) out.push({ path: gitDir, write: gitWrite });
    args.forEach((arg, index) => {
      if ((cmd === 'sed' || cmd === 'perl') && index === 0) return;
      let write = false;
      if (WRITE_ALL.has(cmd)) write = true;
      else if (WRITE_LAST.has(cmd)) write = index === args.length - 1;
      else if (cmd === 'sed' || cmd === 'perl') write = sedInPlace && index > 0;
      else if (INTERPRETERS.has(cmd)) write = index > 0;
      else if (cmd === 'git') write = gitWrite;
      else if (cmd === 'tar') write = tarExtract;
      if (write || looksLikePath(arg)) out.push({ path: arg, write });
    });
  }
  return out.filter((p) => p.path.length > 0);
}

export type GuardDecision = GateDecision & { target?: string };

function block(reason: string, target: string): GuardDecision {
  return { pass: false, reason: `Guardia de Agent Office: ${reason}`, target };
}

export function guardDecision(g: GuardInput, ctx: GuardContext): GuardDecision {
  if (!GUARDED_TOOLS.has(g.tool)) return PASS;
  // Bash keeps the department zone: its path detection is partial, and the skill-creator scripts of a
  // skillwright write next to its skill folder.
  const zones = zonesFor(g.role, ctx);
  if (!zones) return PASS;
  const home = ctx.home ?? homedir();
  const where = zones.allowed.join(' o ');
  const fuentesNote = zones.forbidden.length > 0 ? ` (salvo ${zones.forbidden.join(', ')}, que es solo de lectura)` : '';
  if (g.tool !== 'Bash') {
    const raw = text(g.input.file_path) ?? text(g.input.notebook_path);
    if (!raw) return PASS;
    const target = resolvePath(raw, g.cwd, home);
    const own = zonesFor(g.role, ctx, g.name ?? null) ?? zones;
    if (inZone(target, own)) return PASS;
    if (own.order) {
      return block(
        `${own.label} solo escribe los ficheros de su encargo: ${own.allowed.join(' y ')}. ${target} es de otro encargo o queda fuera; si de verdad hace falta tocarlo, pídeselo a tu jefe.`,
        target,
      );
    }
    return block(`${zones.label} solo escribe dentro de ${where}${fuentesNote}. ${target} queda fuera; escribe en tu carpeta.`, target);
  }
  const command = text(g.input.command) ?? '';
  for (const ref of shellPaths(command)) {
    const target = resolvePath(ref.path, g.cwd, home);
    if (inZone(target, zones)) continue;
    if (zones.forbidden.some((f) => isInside(target, f))) {
      if (ref.write) return block(`${target} es una foto de solo lectura de una planta; no se escribe en ella.`, target);
      continue;
    }
    const floor = ctx.floors.find((f) => isInside(target, f.path));
    if (floor) {
      return block(
        `${zones.label} no usa rutas de la planta ${floor.slug} desde Bash (${target}). Lee el código en la foto de redaccion/.fuentes o con las herramientas de lectura.`,
        target,
      );
    }
    if (isInside(target, ctx.claudeHome)) {
      const readable = [join(ctx.claudeHome, 'skills'), join(ctx.claudeHome, 'plugins')].some((d) => isInside(target, d));
      if (ref.write || !readable) return block(`${zones.label} no toca ${target} desde Bash. Solo el jefe de Mantenimiento instala skills aprobadas.`, target);
      continue;
    }
    if (ref.write && isInside(target, ctx.docsRoot)) return block(`${zones.label} solo escribe dentro de ${where}. ${target} queda fuera.`, target);
  }
  return PASS;
}

export type Snapshot = Map<string, string>;

function fingerprint(abs: string): string {
  try {
    const st = statSync(abs);
    return `${Math.round(st.mtimeMs)}:${st.size}`;
  } catch {
    return 'borrado';
  }
}

export async function snapshotRepo(git: GitRunner, repo: string, limit = 5000): Promise<Snapshot | null> {
  const r = await git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 30_000);
  if (r.code !== 0) return null;
  const entries = r.stdout.split('\0');
  const out: Snapshot = new Map();
  for (let i = 0; i < entries.length && out.size < limit; i++) {
    const entry = entries[i] ?? '';
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const abs = join(repo, entry.slice(3));
    if (status.startsWith('R') || status.startsWith('C')) i++;
    out.set(abs, fingerprint(abs));
  }
  return out;
}

export function changedFiles(before: Snapshot, after: Snapshot): string[] {
  const out: string[] = [];
  for (const [path, fp] of after) if (before.get(path) !== fp) out.push(path);
  return out.sort();
}

type Baseline = { startedAt: number; floors: Map<string, Snapshot> };

export type GuardFinding = { ts: number; level: GuardAlertLevel; floor: string; agentKey: string; files: string[] };

export type WatchDeps = {
  git: GitRunner;
  floors: () => GuardFloor[];
  now: () => number;
  attributed: (floor: string, from: number, to: number) => Set<string>;
  active: (floor: string, from: number, to: number) => boolean;
  exempt: (agentKey: string) => string[];
  report: (finding: GuardFinding) => void;
};

export class GuardWatch {
  private readonly baselines = new Map<string, Promise<Baseline>>();

  constructor(private readonly deps: WatchDeps) {}

  watching(agentKey: string): boolean {
    return this.baselines.has(agentKey);
  }

  start(agentKey: string): void {
    if (this.baselines.has(agentKey)) return;
    this.baselines.set(agentKey, this.capture());
  }

  async ready(agentKey: string): Promise<void> {
    await this.baselines.get(agentKey);
  }

  async finish(agentKey: string): Promise<GuardFinding[]> {
    const pending = this.baselines.get(agentKey);
    if (!pending) return [];
    this.baselines.delete(agentKey);
    const before = await pending;
    const after = await this.capture();
    const exempt = this.deps.exempt(agentKey);
    const findings: GuardFinding[] = [];
    for (const [floor, snapshot] of after.floors) {
      const previous = before.floors.get(floor);
      if (!previous) continue;
      const attributed = this.deps.attributed(floor, before.startedAt, after.startedAt);
      const files = changedFiles(previous, snapshot).filter(
        (file) => !attributed.has(realPath(file)) && !exempt.some((dir) => isInside(realPath(file), dir)),
      );
      if (files.length === 0) continue;
      const level: GuardAlertLevel = this.deps.active(floor, before.startedAt, after.startedAt) ? 'posible' : 'alerta';
      const finding = { ts: after.startedAt, level, floor, agentKey, files };
      findings.push(finding);
      this.deps.report(finding);
    }
    return findings;
  }

  private async capture(): Promise<Baseline> {
    const startedAt = this.deps.now();
    const floors = new Map<string, Snapshot>();
    for (const floor of this.deps.floors()) {
      const snapshot = await snapshotRepo(this.deps.git, floor.path);
      if (snapshot) floors.set(floor.slug, snapshot);
    }
    return { startedAt, floors };
  }
}
