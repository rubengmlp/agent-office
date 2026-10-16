import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitSync, type GitRunner } from './git';

export const DOCS_GITIGNORE = ['redaccion/.fuentes/', '*-workspace/', 'taller/skills/*/evals/', '.DS_Store', ''].join('\n');

const README = `# Documentos de Agent Office

- \`redaccion/planes/\`: planes escritos por Redacción y revisados por rondas.
- \`taller/skills/\`: skills creadas por Mantenimiento antes de instalarlas.

La oficina hace un commit por ronda de revisión. \`redaccion/.fuentes/\` guarda fotos de las plantas mientras se escribe un plan y no se versiona.
`;

export type EnsureResult = { root: string; created: boolean; initialized: boolean };

export function ensureDocsRepo(root: string): EnsureResult {
  const created = !existsSync(root);
  for (const dir of [join(root, 'redaccion', 'planes'), join(root, 'redaccion', 'historial'), join(root, 'redaccion', '.fuentes'), join(root, 'taller', 'skills')]) {
    mkdirSync(dir, { recursive: true });
  }
  const gitignore = join(root, '.gitignore');
  if (!existsSync(gitignore)) writeFileSync(gitignore, DOCS_GITIGNORE);
  const readme = join(root, 'README.md');
  if (!existsSync(readme)) writeFileSync(readme, README);
  let initialized = false;
  if (!existsSync(join(root, '.git'))) {
    gitSync(root, ['init', '-q']);
    gitSync(root, ['add', '--', '.gitignore', 'README.md']);
    gitSync(root, ['commit', '-q', '-m', 'office-docs: estructura inicial', '--', '.gitignore', 'README.md']);
    initialized = true;
  }
  return { root, created, initialized };
}

export type CommitOutcome = 'committed' | 'unchanged' | 'failed';

export async function commitDocument(
  git: GitRunner,
  root: string,
  relPaths: string | readonly string[],
  message: string,
): Promise<CommitOutcome> {
  if (!existsSync(join(root, '.git'))) return 'failed';
  const paths = (typeof relPaths === 'string' ? [relPaths] : relPaths).filter((path) => existsSync(join(root, path)));
  if (paths.length === 0) return 'failed';
  const added = await git(root, ['add', '--', ...paths]);
  if (added.code !== 0) return 'failed';
  const staged = await git(root, ['diff', '--cached', '--quiet', '--', ...paths]);
  if (staged.code === 0) return 'unchanged';
  const commit = await git(root, ['commit', '--only', '--quiet', '-m', message, '--', ...paths]);
  return commit.code === 0 ? 'committed' : 'failed';
}
