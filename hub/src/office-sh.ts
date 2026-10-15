import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { managedFloors } from './agents';
import { WORKSPACE_DIR, docsRepoPath, writeAtomic, type Paths } from './config';
import { REDACCION_DIR, TALLER_DIR } from './floors';
import { profileFor, type Profiles } from './profiles';
import type { OfficeConfig, RoleSettings } from './types';

export type SessionSpec = {
  name: string;
  cwd: string;
  role: string;
  agent: string;
  extraArgs: string[];
  needsHub: boolean;
};

export function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function modelArgs(settings: RoleSettings): string[] {
  const model = settings.model === 'inherit' ? [] : ['--model', settings.model];
  return [...model, '--effort', settings.effort];
}

export function sessionSpecs(config: OfficeConfig, p: Paths, workspaceDir = WORKSPACE_DIR): SessionSpec[] {
  const lead = modelArgs(config.roles.lead);
  const specs: SessionSpec[] = [
    {
      name: 'director',
      cwd: workspaceDir,
      role: 'office-director',
      agent: 'office-director',
      extraArgs: ['--append-system-prompt-file', p.directorFloors, ...modelArgs(config.roles.director)],
      needsHub: false,
    },
  ];
  for (const [slug, floor] of managedFloors(config)) {
    specs.push({
      name: `lead-${slug}`,
      cwd: floor.path,
      role: `office-lead-${slug}`,
      agent: `office-lead-${slug}`,
      extraArgs: lead,
      needsHub: false,
    });
  }
  const docs = docsRepoPath(config);
  if (config.departments.redaccion) {
    specs.push({
      name: 'lead-redaccion',
      cwd: join(docs, REDACCION_DIR),
      role: 'office-lead-redaccion',
      agent: 'office-lead-redaccion',
      extraArgs: lead,
      needsHub: true,
    });
  }
  if (config.departments.mantenimiento) {
    specs.push({
      name: 'lead-mantenimiento',
      cwd: join(docs, TALLER_DIR),
      role: 'office-lead-mantenimiento',
      agent: 'office-lead-mantenimiento',
      extraArgs: ['--add-dir', p.skillsDir, ...lead],
      needsHub: true,
    });
  }
  return specs;
}

export function directorFloorsText(config: OfficeConfig, profiles: Profiles): string {
  const lines = ['## Plantas gestionadas', ''];
  const floors = managedFloors(config);
  if (floors.length === 0) lines.push('Todavía no hay plantas gestionadas.');
  for (const [slug, floor] of floors) {
    const profile = profileFor(profiles, floor.stack);
    lines.push(
      `- \`${slug}\`: ${profile.label}, repositorio ${floor.path}, rama base \`${floor.baseBranch}\`. Jefe de planta: sesión \`lead-${slug}\`.`,
    );
  }
  lines.push('', '## Departamentos', '');
  const docs = docsRepoPath(config);
  if (!config.departments.redaccion && !config.departments.mantenimiento) lines.push('No hay departamentos activos.');
  if (config.departments.redaccion) {
    lines.push(
      `- Redacción: sesión \`lead-redaccion\`. Escribe planes revisados por rondas en ${join(docs, REDACCION_DIR, 'planes')} y te los entrega con \`HECHO:\`.`,
    );
  }
  if (config.departments.mantenimiento) {
    lines.push(
      `- Mantenimiento: sesión \`lead-mantenimiento\`. Crea skills de Claude Code en ${join(docs, TALLER_DIR, 'skills')} y las instala donde diga el usuario.`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export function sessionScript(spec: SessionSpec, port: number): string {
  const args = [
    '--agent',
    spec.agent,
    '--name',
    spec.name,
    '--teammate-mode',
    'in-process',
    '--settings',
    '{"subagentPromptCacheTtl":"1h"}',
    ...spec.extraArgs,
  ];
  const lines = ['#!/bin/sh'];
  if (spec.needsHub) {
    const health = `http://127.0.0.1:${port}/health`;
    lines.push(
      `if [ ! -d ${sq(spec.cwd)} ]; then`,
      `  echo ${sq(`No existe ${spec.cwd}. Crea el repositorio de documentos con: bun run setup`)}`,
      "  printf 'Pulsa Intro para cerrar. '",
      '  read _ || true',
      '  exit 1',
      'fi',
      `if ! curl -sf -m 2 ${sq(health)} >/dev/null 2>&1; then`,
      `  echo ${sq(`El hub de Agent Office no responde en ${health}. Sin hub no hay guardia de permisos: arráncalo con bun run hub y vuelve a abrir esta sesión.`)}`,
      "  printf 'Pulsa Intro para cerrar. '",
      '  read _ || true',
      '  exit 1',
      'fi',
    );
  }
  lines.push(
    `cd ${sq(spec.cwd)} || exit 1`,
    'export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1',
    'export CLAUDE_CODE_ENABLE_TODO_TOOLS=1',
    `export AGENT_OFFICE_ROLE=${sq(spec.role)}`,
    `export AGENT_OFFICE_NAME=${sq(spec.name)}`,
    `exec claude ${args.map(sq).join(' ')} "$@"`,
    '',
  );
  return lines.join('\n');
}

export function officeScript(specs: SessionSpec[], p: Paths): string {
  const names = specs.map((s) => s.name).join(' ');
  return `#!/bin/sh
set -eu
SESSIONS=${sq(p.sessionsDir)}
NAMES=${sq(names)}
if command -v tmux >/dev/null 2>&1; then
  for name in $NAMES; do
    if tmux has-session -t agent-office 2>/dev/null; then
      tmux new-window -t agent-office -n "$name" "'$SESSIONS/$name.sh'"
    else
      tmux new-session -d -s agent-office -n "$name" "'$SESSIONS/$name.sh'"
    fi
  done
  echo "Sesiones abiertas en tmux: tmux attach -t agent-office"
elif command -v osascript >/dev/null 2>&1; then
  for name in $NAMES; do
    osascript -e "tell application \\"Terminal\\" to do script \\"'$SESSIONS/$name.sh'\\"" >/dev/null
  done
  osascript -e 'tell application "Terminal" to activate' >/dev/null
  echo "Sesiones abiertas en Terminal"
else
  echo "Abre una terminal por sesión y ejecuta:"
  for name in $NAMES; do
    echo "  '$SESSIONS/$name.sh'"
  done
fi
`;
}

export function writeOfficeScripts(p: Paths, config: OfficeConfig, profiles: Profiles, workspaceDir = WORKSPACE_DIR): SessionSpec[] {
  mkdirSync(p.sessionsDir, { recursive: true, mode: 0o700 });
  const specs = sessionSpecs(config, p, workspaceDir);
  writeAtomic(p.directorFloors, directorFloorsText(config, profiles), 0o600);
  const wanted = new Set(specs.map((s) => `${s.name}.sh`));
  for (const file of readdirSync(p.sessionsDir)) {
    if (file.endsWith('.sh') && !wanted.has(file)) rmSync(join(p.sessionsDir, file));
  }
  for (const spec of specs) writeAtomic(join(p.sessionsDir, `${spec.name}.sh`), sessionScript(spec, config.port), 0o700);
  writeAtomic(p.officeSh, officeScript(specs, p), 0o700);
  return specs;
}
