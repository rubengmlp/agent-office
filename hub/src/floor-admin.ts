import { TemplateError } from './agents';
import { loadConfig, type Paths } from './config';
import { FloorConflictError, FloorError, checkSlug, planFloor, purgeFloor, writeFloor } from './floor-cli';
import { FloorInUseError } from './floor-data';
import { realPath } from './floors';
import type { Office } from './office';
import type { Profiles } from './profiles';
import { record, text } from './state-machine';
import type { FloorAddResult, FloorErrorStatus, FloorFailure, FloorRemoveResult, HubText } from './types';

const MAX_PATH = 1000;

export type FloorAdmin = {
  add(raw: unknown): FloorAddResult;
  remove(slug: string): Promise<FloorRemoveResult>;
};

export type FloorOffice = Pick<Office, 'floorInUse' | 'forgetFloor'>;

export type GitTopFn = (dir: string) => string | null;

export const gitTopLevel: GitTopFn = (dir) => {
  try {
    const r = Bun.spawnSync(['git', '-C', dir, 'rev-parse', '--show-toplevel'], { stdout: 'pipe', stderr: 'ignore' });
    return r.exitCode === 0 ? r.stdout.toString().trim() || null : null;
  } catch {
    return null;
  }
};

function fail(status: FloorErrorStatus, error: HubText): FloorFailure {
  return { ok: false, status, error };
}

// The panel gets the key of a FloorError; template errors and anything unexpected go as raw text.
function failure(error: unknown): FloorFailure {
  if (error instanceof FloorConflictError) return fail(409, error.text ?? error.message);
  if (error instanceof FloorError) return fail(400, error.text ?? error.message);
  if (error instanceof TemplateError) return fail(400, error.message);
  return fail(500, (error as Error).message);
}

export function createFloorAdmin(
  p: Paths,
  profiles: () => Profiles,
  office: FloorOffice,
  reload: () => void,
  gitTop: GitTopFn = gitTopLevel,
): FloorAdmin {
  const removing = new Set<string>();
  return {
    add(raw) {
      const body = record(raw);
      const path = text(body.path);
      if (!path || path.length > MAX_PATH) return fail(400, { key: 'hub.floors.pathRequired' });
      const slug = text(body.slug) ?? undefined;
      try {
        const current = profiles();
        const plan = planFloor(p, current, path, slug);
        const top = gitTop(plan.path);
        if (top === null) return fail(400, { key: 'hub.floors.notGitRepo', params: { path: plan.path } });
        if (realPath(top) !== plan.path) return fail(400, { key: 'hub.floors.insideRepo', params: { path: plan.path, top } });
        if (loadConfig(p).floors[plan.slug]?.managed) {
          throw new FloorConflictError(`${plan.path} ya es la planta gestionada «${plan.slug}».`, 'managed', {
            key: 'hub.floors.conflictManaged',
            params: { path: plan.path, slug: plan.slug },
          });
        }
        const startCommand = writeFloor(p, current, plan);
        reload();
        return {
          ok: true,
          slug: plan.slug,
          path: plan.path,
          stack: plan.stack,
          startCommand,
          note: { key: 'hub.floors.added', params: { slug: plan.slug, startCommand } },
        };
      } catch (error) {
        return failure(error);
      }
    },

    async remove(slug) {
      try {
        checkSlug(slug);
      } catch (error) {
        return failure(error);
      }
      if (removing.has(slug)) return fail(409, { key: 'hub.floors.removing', params: { slug } });
      const floor = loadConfig(p).floors[slug];
      if (!floor) return fail(404, { key: 'hub.floors.notFound', params: { slug } });
      const open = office.floorInUse(slug);
      if (open.length > 0) return fail(409, new FloorInUseError(slug, open).text);
      // Data first, config last: while the floor is still in config.json, a failure halfway is fixed by repeating the DELETE.
      removing.add(slug);
      try {
        const { rows, worktrees } = await office.forgetFloor(slug, realPath(floor.path));
        const files = purgeFloor(p, profiles(), slug).length;
        reload();
        return { ok: true, slug, removed: { files, rows, worktrees } };
      } catch (error) {
        if (error instanceof FloorInUseError) return fail(409, error.text);
        if (error instanceof FloorError) return fail(404, error.text ?? error.message);
        return fail(500, (error as Error).message);
      } finally {
        removing.delete(slug);
      }
    },
  };
}
