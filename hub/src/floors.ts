import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { detectStack } from './profiles';
import type { FloorKind, FloorView, OfficeConfig, Stack } from './types';

export const DIRECCION = 'direccion';
export const UNKNOWN_FLOOR = 'desconocida';

export type GitRootFn = (cwd: string) => string | null;

export type FloorRecord = { slug: string; path: string; stack: Stack };

export type FloorRegistry = {
  byPath(path: string): FloorRecord | null;
  add(record: FloorRecord): void;
  all(): FloorRecord[];
};

export type ResolvedFloor = { slug: string; kind: FloorKind; path: string | null; stack: Stack };

export const gitMainRoot: GitRootFn = (cwd) => {
  const run = (args: string[]): string => {
    try {
      const r = Bun.spawnSync(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'ignore' });
      return r.exitCode === 0 ? r.stdout.toString().trim() : '';
    } catch {
      return '';
    }
  };
  const common = run(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) return null;
  if (basename(common) === '.git') return dirname(common);
  return run(['rev-parse', '--show-toplevel']) || null;
};

export function memoryRegistry(initial: FloorRecord[] = []): FloorRegistry {
  const rows = [...initial];
  return {
    byPath: (path) => rows.find((r) => r.path === path) ?? null,
    add: (record) => {
      rows.push(record);
    },
    all: () => [...rows],
  };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function realPath(path: string): string {
  const abs = resolve(path);
  try {
    return realpathSync(abs);
  } catch {
    const parent = dirname(abs);
    return parent === abs ? abs : join(realPath(parent), basename(abs));
  }
}

export class FloorResolver {
  private readonly roots = new Map<string, string>();
  private readonly workspace: string;

  constructor(
    private readonly config: () => OfficeConfig,
    workspaceDir: string,
    private readonly registry: FloorRegistry,
    private readonly gitRoot: GitRootFn = gitMainRoot,
    private readonly stackOf: (dir: string) => Stack = detectStack,
  ) {
    this.workspace = realPath(workspaceDir);
  }

  resolve(cwd: string | null | undefined): ResolvedFloor {
    if (!cwd) return { slug: UNKNOWN_FLOOR, kind: 'observed', path: null, stack: 'generic' };
    const abs = realPath(cwd);
    if (isInside(abs, this.workspace)) {
      return { slug: DIRECCION, kind: 'direccion', path: this.workspace, stack: 'generic' };
    }
    const root = this.rootOf(abs);
    const configured = this.configuredByPath(root);
    if (configured) return configured;
    const known = this.registry.byPath(root);
    if (known) return { ...known, kind: 'observed' };
    const record: FloorRecord = {
      slug: this.freeSlug(slugify(basename(root)) || 'repo'),
      path: root,
      stack: this.stackOf(root),
    };
    this.registry.add(record);
    return { ...record, kind: 'observed' };
  }

  rootOf(abs: string): string {
    const cached = this.roots.get(abs);
    if (cached) return cached;
    const found = this.gitRoot(abs);
    const root = found ? realPath(found) : abs;
    this.roots.set(abs, root);
    return root;
  }

  views(): FloorView[] {
    const out: FloorView[] = [
      { slug: DIRECCION, label: 'Dirección', path: this.workspace, stack: 'generic', kind: 'direccion' },
    ];
    const floors = this.config().floors;
    const configuredPaths = new Set<string>();
    for (const [slug, f] of Object.entries(floors)) {
      out.push({ slug, label: slug, path: f.path, stack: f.stack, kind: f.managed ? 'managed' : 'observed' });
      configuredPaths.add(realPath(f.path));
    }
    for (const r of this.registry.all()) {
      if (configuredPaths.has(r.path) || floors[r.slug]) continue;
      out.push({ slug: r.slug, label: r.slug, path: r.path, stack: r.stack, kind: 'observed' });
    }
    return out;
  }

  private configuredByPath(root: string): ResolvedFloor | null {
    for (const [slug, f] of Object.entries(this.config().floors)) {
      if (realPath(f.path) === root) {
        return { slug, kind: f.managed ? 'managed' : 'observed', path: root, stack: f.stack };
      }
    }
    return null;
  }

  private freeSlug(base: string): string {
    const taken = new Set<string>([
      DIRECCION,
      UNKNOWN_FLOOR,
      ...Object.keys(this.config().floors),
      ...this.registry.all().map((r) => r.slug),
    ]);
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}
