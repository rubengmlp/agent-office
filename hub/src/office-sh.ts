import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_DIR, writeAtomic, type Paths } from './config';
import { profileFor, type Profiles } from './profiles';
import type { OfficeConfig } from './types';

export type SessionSpec = {
  name: string;
  cwd: string;
  role: string;
  agent: string;
  extraArgs: string[];
};

export function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function managedFloors(config: OfficeConfig) {
  return Object.entries(config.floors)
    .filter(([, floor]) => floor.managed)
    .sort(([a], [b]) => a.localeCompare(b));
}

export function sessionSpecs(config: OfficeConfig, p: Paths, workspaceDir = WORKSPACE_DIR): SessionSpec[] {
  const specs: SessionSpec[] = [
    {
      name: 'director',
      cwd: workspaceDir,
      role: 'office:director',
      agent: 'office:director',
      extraArgs: ['--append-system-prompt-file', p.directorFloors],
    },
  ];
  for (const [slug, floor] of managedFloors(config)) {
    specs.push({ name: `lead-${slug}`, cwd: floor.path, role: `office-lead-${slug}`, agent: `office-lead-${slug}`, extraArgs: [] });
  }
  return specs;
}

export function directorFloorsText(config: OfficeConfig, profiles: Profiles): string {
  const lines = ['## Plantas gestionadas', ''];
  const floors = managedFloors(config);
  if (floors.length === 0) lines.push('Todavía no hay plantas gestionadas.');
  for (const [slug, floor] of floors) {
    const profile = profileFor(profiles, floor.stack);
    lines.push(`- \`${slug}\`: ${profile.label}, repositorio ${floor.path}. Jefe de planta: sesión \`lead-${slug}\`.`);
  }
  return `${lines.join('\n')}\n`;
}

export function sessionScript(spec: SessionSpec): string {
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
  return [
    '#!/bin/sh',
    `cd ${sq(spec.cwd)} || exit 1`,
    'export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1',
    'export CLAUDE_CODE_ENABLE_TODO_TOOLS=1',
    `export AGENT_OFFICE_ROLE=${sq(spec.role)}`,
    `export AGENT_OFFICE_NAME=${sq(spec.name)}`,
    `exec claude ${args.map(sq).join(' ')} "$@"`,
    '',
  ].join('\n');
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
  for (const spec of specs) writeAtomic(join(p.sessionsDir, `${spec.name}.sh`), sessionScript(spec), 0o700);
  writeAtomic(p.officeSh, officeScript(specs, p), 0o700);
  return specs;
}
