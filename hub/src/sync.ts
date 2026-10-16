import type { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validBranch } from './config';
import { isInside, realPath } from './floors';
import { GitQueue, type GitRunner } from './git';
import { record, text } from './state-machine';
import type { DocumentAhead, DocumentBase, FloorConfig } from './types';

export const FUENTES_DIR = join('redaccion', '.fuentes');
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const MAX_LOG = 30;
const MAX_AHEAD_FILES = 50;
const FETCH_TIMEOUT_MS = 120_000;
const WORKTREE_TIMEOUT_MS = 300_000;

export type SyncFloorOk = {
  floor: string;
  ref: string;
  sha: string;
  date: string | null;
  stale: boolean;
  fetchedAt: string | null;
  path: string;
  reused: boolean;
  since: string | null;
  newCommits: string[];
  stat: string | null;
};

export type SyncFloorError = { floor: string; error: string };

export type SyncFloorResult = SyncFloorOk | SyncFloorError;

export type SyncResult =
  | { ok: true; slug: string; floors: SyncFloorResult[]; text: string }
  | { ok: false; status: number; error: string };

type WorktreeRow = {
  slug: string;
  floor: string;
  repo: string;
  path: string;
  ref: string;
  sha: string;
  date: string | null;
  stale: number;
  ahead_commits: number | null;
  ahead_files: string | null;
  created_at: number;
};

export type SyncOptions = {
  db: Database;
  git: GitRunner;
  root: () => string;
  floors: () => Record<string, FloorConfig>;
  now: () => number;
  onChange: () => void;
};

export function isSyncError(r: SyncFloorResult): r is SyncFloorError {
  return 'error' in r;
}

function firstLine(value: string): string {
  return value.split('\n').find((line) => line.trim())?.trim() ?? 'sin detalle';
}

function lines(value: string): string[] {
  return value.split('\n').map((l) => l.trim()).filter(Boolean);
}

export function syncText(slug: string, folder: string, results: SyncFloorResult[]): string {
  const out = [`Fuentes del plan ${slug} en ${folder}:`];
  for (const r of results) {
    if (isSyncError(r)) {
      out.push(`- ${r.floor}: ERROR: ${r.error}`);
      continue;
    }
    const base = `${r.floor} ${r.ref} @ ${r.sha.slice(0, 7)}`;
    out.push(`- ${base} (${r.date ?? 'fecha desconocida'}). Carpeta: ${r.path}`);
    if (r.reused) out.push('  Foto ya preparada para este plan: se mantiene fija durante todas las rondas.');
    if (r.stale) out.push(`  Sin actualizar: no se pudo hacer fetch y es la última copia local de origin/${r.ref}, a fecha de ${r.fetchedAt ?? r.date ?? 'fecha desconocida'}.`);
    if (r.reused) continue;
    if (!r.since) {
      out.push(`  Primer plan sobre ${r.floor} con ${r.ref}: no hay un plan anterior con el que comparar.`);
    } else if (r.newCommits.length === 0) {
      out.push(`  Sin cambios desde el último plan sobre ${r.floor} (${r.since.slice(0, 7)}).`);
    } else {
      out.push(`  Cambios desde el último plan sobre ${r.floor} (${r.since.slice(0, 7)}..${r.sha.slice(0, 7)}): ${r.stat ?? `${r.newCommits.length} commits`}`);
      for (const c of r.newCommits) out.push(`    ${c}`);
    }
  }
  return out.join('\n');
}

export function parseSyncRequest(raw: unknown): { slug: string; floors: string[]; ref: string | null } | string {
  const body = record(raw);
  const slug = text(body.slug);
  if (!slug || !SLUG_PATTERN.test(slug)) return 'slug obligatorio: minúsculas, números y guiones';
  const floors = Array.isArray(body.floors) ? body.floors.filter((f): f is string => typeof f === 'string' && f.length > 0) : [];
  if (floors.length === 0) return 'floors obligatorio: al menos una planta';
  const ref = text(body.ref);
  if (ref !== null && !validBranch(ref)) return `"${ref}" no vale como nombre de rama`;
  return { slug, floors: [...new Set(floors)], ref };
}

export class SyncDesk {
  private readonly queue = new GitQueue();

  constructor(private readonly opts: SyncOptions) {}

  fuentes(): string {
    return join(this.opts.root(), FUENTES_DIR);
  }

  base(slug: string): DocumentBase[] {
    return this.rows(slug).map((r) => ({ floor: r.floor, ref: r.ref, sha: r.sha, date: r.date, stale: r.stale === 1 }));
  }

  ahead(slug: string): DocumentAhead[] {
    return this.rows(slug)
      .filter((r) => (r.ahead_commits ?? 0) > 0)
      .map((r) => ({ floor: r.floor, commits: r.ahead_commits ?? 0, files: parseFiles(r.ahead_files) }));
  }

  slugs(): string[] {
    return this.opts.db
      .query<{ slug: string }, []>('SELECT DISTINCT slug FROM sync_worktrees ORDER BY slug')
      .all()
      .map((r) => r.slug);
  }

  async sync(raw: unknown): Promise<SyncResult> {
    const req = parseSyncRequest(raw);
    if (typeof req === 'string') return { ok: false, status: 400, error: req };
    if (!existsSync(join(this.opts.root(), '.git'))) {
      return { ok: false, status: 409, error: `No existe el repositorio de documentos ${this.opts.root()}. Ejecuta bun run setup.` };
    }
    const configured = this.opts.floors();
    const results: SyncFloorResult[] = [];
    for (const slug of req.floors) {
      const floor = configured[slug];
      if (!floor) {
        results.push({ floor: slug, error: `No hay ninguna planta "${slug}". Plantas: ${Object.keys(configured).join(', ') || 'ninguna'}.` });
        continue;
      }
      const repo = realPath(floor.path);
      const ref = req.ref ?? floor.baseBranch;
      results.push(await this.queue.run(repo, () => this.syncFloor(req.slug, slug, repo, ref)));
    }
    if (results.every(isSyncError)) {
      return { ok: false, status: 422, error: results.map((r) => `${r.floor}: ${(r as SyncFloorError).error}`).join('\n') };
    }
    this.opts.onChange();
    return { ok: true, slug: req.slug, floors: results, text: syncText(req.slug, join(this.fuentes(), req.slug), results) };
  }

  async remove(slug: string): Promise<void> {
    for (const row of this.rows(slug)) {
      await this.queue.run(row.repo, async () => {
        if (existsSync(row.path)) await this.opts.git(row.repo, ['worktree', 'remove', '--force', row.path]);
        await this.opts.git(row.repo, ['worktree', 'prune']);
        this.removeDir(row.path);
      });
      this.opts.db.query('DELETE FROM sync_worktrees WHERE slug = ? AND floor = ?').run(row.slug, row.floor);
    }
    this.removeDir(join(this.fuentes(), slug), true);
    this.opts.onChange();
  }

  async checkAhead(slug: string): Promise<void> {
    let changed = false;
    for (const row of this.rows(slug)) {
      await this.queue.run(row.repo, async () => {
        const remoteRef = `refs/remotes/origin/${row.ref}`;
        await this.opts.git(row.repo, ['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${row.ref}:${remoteRef}`], FETCH_TIMEOUT_MS);
        const count = await this.opts.git(row.repo, ['rev-list', '--count', `${row.sha}..${remoteRef}`]);
        if (count.code !== 0) return;
        const commits = Number(count.stdout.trim()) || 0;
        const names = commits > 0 ? await this.opts.git(row.repo, ['diff', '--name-only', row.sha, remoteRef]) : null;
        const files = names && names.code === 0 ? lines(names.stdout).slice(0, MAX_AHEAD_FILES) : [];
        this.opts.db
          .query('UPDATE sync_worktrees SET ahead_commits = ?, ahead_files = ? WHERE slug = ? AND floor = ?')
          .run(commits, JSON.stringify(files), row.slug, row.floor);
        changed = true;
      });
    }
    if (changed) this.opts.onChange();
  }

  async cleanup(finished: Set<string>): Promise<string[]> {
    const removed: string[] = [];
    for (const slug of this.slugs()) {
      if (!finished.has(slug)) continue;
      await this.remove(slug);
      removed.push(slug);
    }
    const known = new Set(this.opts.db.query<{ path: string }, []>('SELECT path FROM sync_worktrees').all().map((r) => r.path));
    for (const slug of safeList(this.fuentes())) {
      for (const floor of safeList(join(this.fuentes(), slug))) {
        const dir = join(this.fuentes(), slug, floor);
        if (known.has(dir)) continue;
        const repo = worktreeRepo(dir);
        if (repo) await this.queue.run(repo, () => this.opts.git(repo, ['worktree', 'remove', '--force', dir]));
        this.removeDir(dir);
        removed.push(`${slug}/${floor}`);
      }
      this.removeDir(join(this.fuentes(), slug), true);
    }
    for (const floor of Object.values(this.opts.floors())) {
      const repo = realPath(floor.path);
      if (existsSync(repo)) await this.queue.run(repo, () => this.opts.git(repo, ['worktree', 'prune']));
    }
    return removed;
  }

  async expire(cutoff: number, lastActivity: (slug: string) => number): Promise<string[]> {
    const expired: string[] = [];
    for (const slug of this.slugs()) {
      const created = Math.max(...this.rows(slug).map((r) => r.created_at));
      if (Math.max(created, lastActivity(slug)) >= cutoff) continue;
      await this.remove(slug);
      expired.push(slug);
    }
    return expired;
  }

  private async syncFloor(slug: string, floorSlug: string, repo: string, ref: string): Promise<SyncFloorResult> {
    const git = this.opts.git;
    const target = join(this.fuentes(), slug, floorSlug);
    const existing = this.row(slug, floorSlug);
    if (existing && existsSync(target)) {
      return {
        floor: floorSlug,
        ref: existing.ref,
        sha: existing.sha,
        date: existing.date,
        stale: existing.stale === 1,
        fetchedAt: null,
        path: target,
        reused: true,
        since: null,
        newCommits: [],
        stat: null,
      };
    }
    const inside = await git(repo, ['rev-parse', '--is-inside-work-tree']);
    if (inside.code !== 0) return { floor: floorSlug, error: `${repo} no es un repositorio git.` };
    const remoteRef = `refs/remotes/origin/${ref}`;
    const fetch = await git(repo, ['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${ref}:${remoteRef}`], FETCH_TIMEOUT_MS);
    const stale = fetch.code !== 0;
    const verify = await git(repo, ['rev-parse', '--verify', '--quiet', `${remoteRef}^{commit}`]);
    if (verify.code !== 0) {
      if (!stale || /couldn't find remote ref/i.test(fetch.stderr)) return { floor: floorSlug, error: `La rama ${ref} no existe en origin de ${floorSlug}.` };
      return { floor: floorSlug, error: `No se pudo hacer fetch de ${floorSlug} (${firstLine(fetch.stderr)}) y no hay copia local de origin/${ref}.` };
    }
    const sha = verify.stdout.trim();
    const date = (await git(repo, ['log', '-1', '--format=%cI', sha])).stdout.trim() || null;
    let fetchedAt: string | null = null;
    if (stale) {
      const common = (await git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).stdout.trim();
      try {
        fetchedAt = new Date(statSync(join(common, 'FETCH_HEAD')).mtimeMs).toISOString();
      } catch {}
    }
    if (existsSync(target)) {
      await git(repo, ['worktree', 'remove', '--force', target]);
      this.removeDir(target);
    }
    await git(repo, ['worktree', 'prune']);
    mkdirSync(dirname(target), { recursive: true });
    const add = await git(repo, ['worktree', 'add', '--detach', '--quiet', target, sha], WORKTREE_TIMEOUT_MS);
    if (add.code !== 0) return { floor: floorSlug, error: `No se pudo crear la foto de ${floorSlug}: ${firstLine(add.stderr)}` };
    const last = this.opts.db
      .query<{ last_sha: string }, [string, string]>('SELECT last_sha FROM floor_sync WHERE floor = ? AND ref = ?')
      .get(floorSlug, ref)?.last_sha ?? null;
    let newCommits: string[] = [];
    let stat: string | null = null;
    if (last && last !== sha) {
      const log = await git(repo, ['log', '--oneline', `-${MAX_LOG}`, `${last}..${sha}`]);
      newCommits = log.code === 0 ? lines(log.stdout) : [];
      const shortstat = await git(repo, ['diff', '--shortstat', last, sha]);
      stat = shortstat.code === 0 ? shortstat.stdout.trim() || null : null;
    }
    const now = this.opts.now();
    this.opts.db
      .query(
        `INSERT INTO floor_sync (floor, ref, last_sha, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(floor, ref) DO UPDATE SET last_sha = excluded.last_sha, updated_at = excluded.updated_at`,
      )
      .run(floorSlug, ref, sha, now);
    this.opts.db
      .query(
        `INSERT INTO sync_worktrees (slug, floor, repo, path, ref, sha, date, stale, ahead_commits, ahead_files, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
         ON CONFLICT(slug, floor) DO UPDATE SET repo = excluded.repo, path = excluded.path, ref = excluded.ref, sha = excluded.sha,
           date = excluded.date, stale = excluded.stale, ahead_commits = NULL, ahead_files = NULL, created_at = excluded.created_at`,
      )
      .run(slug, floorSlug, repo, target, ref, sha, date, stale ? 1 : 0, now);
    return {
      floor: floorSlug,
      ref,
      sha,
      date,
      stale,
      fetchedAt,
      path: target,
      reused: false,
      since: last,
      newCommits,
      stat,
    };
  }

  private rows(slug: string): WorktreeRow[] {
    return this.opts.db.query<WorktreeRow, [string]>('SELECT * FROM sync_worktrees WHERE slug = ? ORDER BY floor').all(slug);
  }

  private row(slug: string, floor: string): WorktreeRow | null {
    return this.opts.db.query<WorktreeRow, [string, string]>('SELECT * FROM sync_worktrees WHERE slug = ? AND floor = ?').get(slug, floor) ?? null;
  }

  private removeDir(dir: string, onlyIfEmpty = false): void {
    const fuentes = realPath(this.fuentes());
    if (!existsSync(dir) || !isInside(realPath(dir), fuentes) || realPath(dir) === fuentes) return;
    if (onlyIfEmpty && safeList(dir).length > 0) return;
    rmSync(dir, { recursive: true, force: true });
  }
}

function parseFiles(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((f): f is string => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function worktreeRepo(dir: string): string | null {
  try {
    const content = readFileSync(join(dir, '.git'), 'utf8');
    const gitdir = /^gitdir:\s*(.+)$/m.exec(content)?.[1]?.trim();
    if (!gitdir) return null;
    const marker = '/.git/worktrees/';
    const at = gitdir.indexOf(marker);
    return at > 0 ? gitdir.slice(0, at) : null;
  } catch {
    return null;
  }
}
