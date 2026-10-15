import type { FloorKind, RoleId, RoleKind } from './types';

export type Department = 'redaccion' | 'mantenimiento';

type FixedRole = { roleId: RoleId; kind: RoleKind; department: Department | null };

const FIXED_ROLES: Record<string, FixedRole> = {
  'office-director': { roleId: 'director', kind: 'director', department: null },
  'office-reviewer': { roleId: 'reviewer', kind: 'reviewer', department: null },
  'office-lead-redaccion': { roleId: 'lead', kind: 'lead', department: 'redaccion' },
  'office-redactor': { roleId: 'redactor', kind: 'writer', department: 'redaccion' },
  'office-revisor-planes': { roleId: 'revisor-planes', kind: 'planReviewer', department: 'redaccion' },
  'office-lead-mantenimiento': { roleId: 'lead', kind: 'lead', department: 'mantenimiento' },
  'office-artesano': { roleId: 'artesano', kind: 'skillwright', department: 'mantenimiento' },
  'office-revisor-skills': { roleId: 'revisor-skills', kind: 'skillReviewer', department: 'mantenimiento' },
};

const LEGACY: Record<string, string> = {
  'office:director': 'office-director',
  'office:reviewer': 'office-reviewer',
};

export function canonicalRole(role: string | null | undefined): string | null {
  if (!role) return null;
  return LEGACY[role] ?? role;
}

export function isOfficeRole(role: string | null | undefined): boolean {
  return !!role && (role.startsWith('office-') || role.startsWith('office:'));
}

export function isLeadRole(role: string | null | undefined): boolean {
  return !!role && role.startsWith('office-lead-');
}

export function isTesterRole(role: string | null | undefined): boolean {
  return !!role && role.startsWith('office-tester-');
}

function fixed(role: string | null | undefined): FixedRole | null {
  const canonical = canonicalRole(role);
  return canonical ? (FIXED_ROLES[canonical] ?? null) : null;
}

export function roleKind(role: string | null | undefined): RoleKind {
  const known = fixed(role);
  if (known) return known.kind;
  if (!role) return 'intern';
  if (role.startsWith('office-lead-')) return 'lead';
  if (role.startsWith('office-dev-')) return 'dev';
  if (role.startsWith('office-tester-')) return 'tester';
  return 'intern';
}

export function roleIdOf(role: string | null | undefined): RoleId | null {
  const known = fixed(role);
  if (known) return known.roleId;
  if (!role) return null;
  if (role.startsWith('office-lead-')) return 'lead';
  if (role.startsWith('office-dev-')) return 'dev';
  if (role.startsWith('office-tester-')) return 'tester';
  return null;
}

export function departmentOf(role: string | null | undefined): Department | null {
  return fixed(role)?.department ?? null;
}

export function isVerdictRole(role: string | null | undefined): boolean {
  const kind = roleKind(role);
  return kind === 'planReviewer' || kind === 'skillReviewer';
}

export function isAuthorRole(role: string | null | undefined): boolean {
  const kind = roleKind(role);
  return kind === 'writer' || kind === 'skillwright';
}

export function isDepartmentFloor(kind: FloorKind): boolean {
  return kind === 'redaccion' || kind === 'mantenimiento';
}

export function remembers(kind: FloorKind): boolean {
  return kind !== 'observed';
}

export function roleFromName(name: string | null | undefined, floor: string, floorKind: FloorKind): string | null {
  if (!name) return null;
  if (floorKind === 'managed') {
    if (/^dev(-|$)/.test(name)) return `office-dev-${floor}`;
    if (/^tester(-|$)/.test(name)) return `office-tester-${floor}`;
    if (/^reviewer(-|$)/.test(name)) return 'office-reviewer';
  }
  if (floorKind === 'redaccion') {
    if (/^redactor(-|$)/.test(name)) return 'office-redactor';
    if (/^revisor-planes(-|$)/.test(name)) return 'office-revisor-planes';
  }
  if (floorKind === 'mantenimiento') {
    if (/^artesano(-|$)/.test(name)) return 'office-artesano';
    if (/^revisor-skills(-|$)/.test(name)) return 'office-revisor-skills';
  }
  return null;
}

export function inOfficeScope(input: {
  floorKind: FloorKind;
  sessionRole: string | null;
  leadRole: string | null;
}): boolean {
  if (input.floorKind === 'observed') return false;
  return isOfficeRole(input.sessionRole) || isOfficeRole(input.leadRole);
}
