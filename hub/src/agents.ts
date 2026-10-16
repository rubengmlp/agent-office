import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SCRIPTS_DIR, TEMPLATES_DIR, docsRepoPath, writeAtomic, type Paths } from './config';
import { profileFor, testCommandFor, type CompiledProfile, type Profiles } from './profiles';
import type { FloorConfig, OfficeConfig, RoleId } from './types';

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

export function commonVars(p: Paths, config: OfficeConfig, profiles: Profiles, roleId: RoleId): Record<string, string> {
  const role = config.roles[roleId];
  return {
    model: role.model,
    effort: role.effort,
    docsRepo: docsRepoPath(config),
    maxRounds: String(config.review.maxRounds),
    maxLessonsPerSession: String(config.memory.maxLessonsPerSession),
    skillsDir: p.skillsDir,
    syncScript: SYNC_SCRIPT,
    port: String(config.port),
    floorsList: floorsList(config, profiles),
  };
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
  return FLOOR_ROLES.map((role) => {
    const name = floorAgentName(role, slug);
    const vars = {
      ...commonVars(p, config, profiles, role),
      slug,
      path: floor.path,
      label: profile.label,
      testCommand: testCommandFor(floor.path, profile),
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
    content: render(readTemplate(templatesDir, a.template), commonVars(p, config, profiles, a.roleId)),
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
