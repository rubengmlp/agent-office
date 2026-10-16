import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SCRIPTS_DIR, TEMPLATES_DIR, docsRepoPath, roleSettingsFor, writeAtomic, type Paths } from './config';
import { kilobytes, planByteLimit } from './gate';
import { checksOf, gateModeOf, profileFor, testCommandFor, type CompiledProfile, type Profiles } from './profiles';
import type { FloorConfig, GateMode, OfficeConfig, RoleId } from './types';

export class TemplateError extends Error {}

export const FLOOR_ROLES = ['lead', 'dev', 'tester'] as const;
export type FloorRole = (typeof FLOOR_ROLES)[number];

export type AgentDoc = { name: string; roleId: RoleId; template: string; file: string; content: string };

export type FloorAgentDoc = AgentDoc & { floorRole: FloorRole };

type FixedAgent = { name: string; roleId: RoleId; template: string; department: 'redaccion' | 'mantenimiento' | null };

export const FIXED_AGENTS: readonly FixedAgent[] = [
  { name: 'office-director', roleId: 'director', template: 'director', department: null },
  { name: 'office-reviewer', roleId: 'reviewer', template: 'reviewer', department: null },
  { name: 'office-lead-redaccion', roleId: 'lead', template: 'lead-redaccion', department: 'redaccion' },
  { name: 'office-redactor', roleId: 'redactor', template: 'redactor', department: 'redaccion' },
  { name: 'office-revisor-planes', roleId: 'revisor-planes', template: 'revisor-planes', department: 'redaccion' },
  { name: 'office-lead-mantenimiento', roleId: 'lead', template: 'lead-mantenimiento', department: 'mantenimiento' },
  { name: 'office-artesano', roleId: 'artesano', template: 'artesano', department: 'mantenimiento' },
  { name: 'office-revisor-skills', roleId: 'revisor-skills', template: 'revisor-skills', department: 'mantenimiento' },
];

export const SYNC_SCRIPT = join(SCRIPTS_DIR, 'office-sync.sh');
export const CHAT_SCRIPT = join(SCRIPTS_DIR, 'office-chat.sh');
export const ENCARGO_SCRIPT = join(SCRIPTS_DIR, 'office-encargo.sh');

export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new TemplateError(`La plantilla usa una variable sin valor: ${name}`);
    return value;
  });
}

export function skillLine(profile: CompiledProfile): string {
  return profile.skill
    ? `Invoca la skill \`${profile.skill}\` con la herramienta Skill antes de abrir ningún fichero.`
    : 'Este repositorio no tiene una skill propia: lee su CLAUDE.md antes de abrir ningún fichero.';
}

export function agentPath(p: Paths, name: string): string {
  return join(p.agentsDir, `${name}.md`);
}

export function floorAgentName(role: FloorRole, slug: string): string {
  return `office-${role}-${slug}`;
}

export function managedFloors(config: OfficeConfig): [string, FloorConfig][] {
  return Object.entries(config.floors)
    .filter(([, floor]) => floor.managed)
    .sort(([a], [b]) => a.localeCompare(b));
}

export function floorsList(config: OfficeConfig, profiles: Profiles): string {
  const floors = managedFloors(config);
  if (floors.length === 0) return '- Todavía no hay plantas gestionadas.';
  return floors
    .map(([slug, floor]) => {
      const label = profileFor(profiles, floor.stack).label;
      return `- \`${slug}\`: ${label}, repositorio ${floor.path}, rama base \`${floor.baseBranch}\`.`;
    })
    .join('\n');
}

export function commonVars(
  p: Paths,
  config: OfficeConfig,
  profiles: Profiles,
  roleId: RoleId,
  target?: string | null,
): Record<string, string> {
  const role = roleSettingsFor(config, target, roleId);
  return {
    model: role.model,
    effort: role.effort,
    docsRepo: docsRepoPath(config),
    maxRounds: String(config.review.maxRounds),
    maxPlanKb: String(kilobytes(planByteLimit(config.review.maxPlanBytes, 1, false))),
    maxPlanKbAnalysis: String(kilobytes(planByteLimit(config.review.maxPlanBytes, 1, true))),
    maxReviewerReads: String(config.review.maxReviewerReads),
    maxBriefsPerOrder: String(config.limits.maxBriefsPerOrder),
    maxLessonsPerSession: String(config.memory.maxLessonsPerSession),
    skillsDir: p.skillsDir,
    syncScript: SYNC_SCRIPT,
    chatScript: CHAT_SCRIPT,
    encargoScript: ENCARGO_SCRIPT,
    port: String(config.port),
    floorsList: floorsList(config, profiles),
  };
}

// What the lead is told about the tester, from the gate mode of its floor.
export function testerRule(mode: GateMode, testCommand: string): string {
  switch (mode) {
    case 'tester':
      return `Pide al tester que pruebe exactamente lo que cambió: el comando de tests de esta planta es: ${testCommand}. La puerta del HECHO exige un test en verde del tester posterior al último cambio; un test que ejecuta el propio desarrollador no cuenta.`;
    case 'checks+tester':
      return `Con las comprobaciones en verde, pide al tester que pruebe exactamente lo que cambió: el comando de tests de esta planta es: ${testCommand}. La puerta del HECHO exige las dos cosas: comprobaciones en verde sobre la última versión y un test en verde del tester posterior al último cambio.`;
    case 'checks':
      return `El tester no es obligatorio en esta planta: la puerta del HECHO solo exige las comprobaciones en verde sobre la última versión. Úsalo para lo que las comprobaciones no cubren (probar un flujo, reproducir un fallo); el comando de tests base de esta planta es: ${testCommand}.`;
  }
}

export function checksList(floor: Pick<FloorConfig, 'path' | 'stack' | 'checks'>): string {
  const checks = checksOf(floor);
  return checks.length > 0 ? checks.map((check) => `${check.name} (\`${check.command}\`)`).join(', ') : 'ninguna configurada';
}

function readTemplate(templatesDir: string, name: string): string {
  const file = join(templatesDir, `${name}.md.tpl`);
  if (!existsSync(file)) throw new TemplateError(`Falta la plantilla ${file}`);
  return readFileSync(file, 'utf8');
}

export function floorAgentDocs(
  p: Paths,
  config: OfficeConfig,
  profiles: Profiles,
  slug: string,
  floor: { path: string; stack: FloorConfig['stack'] },
  templatesDir = TEMPLATES_DIR,
): FloorAgentDoc[] {
  const profile = profileFor(profiles, floor.stack);
  const settings = { ...floor, ...config.floors[slug], path: floor.path, stack: floor.stack };
  const testCommand = testCommandFor(floor.path, profile);
  return FLOOR_ROLES.map((role) => {
    const name = floorAgentName(role, slug);
    const vars = {
      ...commonVars(p, config, profiles, role, slug),
      slug,
      path: floor.path,
      label: profile.label,
      testCommand,
      testerRule: testerRule(gateModeOf(settings), testCommand),
      checksList: checksList(settings),
      skillLine: skillLine(profile),
    };
    const content = render(readTemplate(templatesDir, role), vars);
    return { name, roleId: role, floorRole: role, template: role, file: agentPath(p, name), content };
  });
}

export function fixedAgentDocs(p: Paths, config: OfficeConfig, profiles: Profiles, templatesDir = TEMPLATES_DIR): AgentDoc[] {
  return FIXED_AGENTS.filter((a) => a.department === null || config.departments[a.department]).map((a) => ({
    name: a.name,
    roleId: a.roleId,
    template: a.template,
    file: agentPath(p, a.name),
    content: render(readTemplate(templatesDir, a.template), commonVars(p, config, profiles, a.roleId, a.department)),
  }));
}

export function writeAgentDocs(p: Paths, docs: { file: string; content: string }[]): number {
  mkdirSync(p.agentsDir, { recursive: true });
  for (const doc of docs) writeAtomic(doc.file, doc.content, 0o644);
  return docs.length;
}

export function writeFixedAgents(p: Paths, config: OfficeConfig, profiles: Profiles, templatesDir = TEMPLATES_DIR): number {
  const written = writeAgentDocs(p, fixedAgentDocs(p, config, profiles, templatesDir));
  for (const a of FIXED_AGENTS) {
    if (a.department === null || config.departments[a.department]) continue;
    const file = agentPath(p, a.name);
    if (existsSync(file)) rmSync(file);
  }
  return written;
}
