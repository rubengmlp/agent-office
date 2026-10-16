import { TemplateError } from './agents';
import { loadConfig, type Paths } from './config';
import { FloorConflictError, FloorError, planFloor, purgeFloor, writeFloor } from './floor-cli';
import { realPath } from './floors';
import type { Office } from './office';
import type { Profiles } from './profiles';
import { record, text } from './state-machine';
import type { FloorAddResult, FloorErrorStatus, FloorFailure, FloorRemoveResult } from './types';

const MAX_PATH = 1000;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

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

function fail(status: FloorErrorStatus, error: string): FloorFailure {
  return { ok: false, status, error };
}

function failure(error: unknown): FloorFailure {
  if (error instanceof FloorConflictError) return fail(409, error.message);
  if (error instanceof FloorError || error instanceof TemplateError) return fail(400, error.message);
  return fail(500, (error as Error).message);
}

export function createFloorAdmin(
  p: Paths,
  profiles: () => Profiles,
  office: FloorOffice,
  reload: () => void,
  gitTop: GitTopFn = gitTopLevel,
): FloorAdmin {
  return {
    add(raw) {
      const body = record(raw);
      const path = text(body.path);
      if (!path || path.length > MAX_PATH) return fail(400, 'Indica la ruta del repositorio.');
      const slug = text(body.slug) ?? undefined;
      try {
        const current = profiles();
        const plan = planFloor(p, current, path, slug);
        const top = gitTop(plan.path);
        if (top === null) return fail(400, `${plan.path} no es un repositorio git: añade la carpeta raíz del repositorio.`);
        if (realPath(top) !== plan.path) {
          return fail(400, `${plan.path} está dentro del repositorio ${top}: añade la carpeta raíz del repositorio.`);
        }
        if (loadConfig(p).floors[plan.slug]?.managed) {
          throw new FloorConflictError(`${plan.path} ya es la planta gestionada «${plan.slug}».`, 'managed');
        }
        const startCommand = writeFloor(p, current, plan);
        reload();
        return {
          ok: true,
          slug: plan.slug,
          path: plan.path,
          stack: plan.stack,
          startCommand,
          note: `Planta ${plan.slug} (${plan.profile.label}) gestionada. Arranca su jefe con bun run office.`,
        };
      } catch (error) {
        return failure(error);
      }
    },

    async remove(slug) {
      if (!SLUG.test(slug)) return fail(400, `"${slug}" no es un nombre de planta válido.`);
      const floor = loadConfig(p).floors[slug];
      if (!floor) return fail(404, `No hay ninguna planta "${slug}".`);
      const open = office.floorInUse(slug);
      if (open.length > 0) {
        return fail(409, `Cierra la sesión lead-${slug} (y su equipo) antes de borrar la planta. Sesiones abiertas: ${open.join(', ')}.`);
      }
      // Data first, config last: while the floor is still in config.json, a failure halfway is fixed by repeating the DELETE.
      try {
        const { rows, worktrees } = await office.forgetFloor(slug, realPath(floor.path));
        const files = purgeFloor(p, profiles(), slug).length;
        reload();
        return { ok: true, slug, removed: { files, rows, worktrees } };
      } catch (error) {
        return fail(500, (error as Error).message);
      }
    },
  };
}
