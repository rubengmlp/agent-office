import type { FloorKind, RoleKind } from './types';

export function isOfficeRole(role: string | null | undefined): boolean {
  return !!role && (role.startsWith('office-') || role.startsWith('office:'));
}

export function isLeadRole(role: string | null | undefined): boolean {
  return !!role && role.startsWith('office-lead-');
}

export function isTesterRole(role: string | null | undefined): boolean {
  return !!role && role.startsWith('office-tester-');
}

export function roleKind(role: string | null | undefined): RoleKind {
  if (!role) return 'intern';
  if (role === 'office:director') return 'director';
  if (role.startsWith('office-lead-')) return 'lead';
  if (role.startsWith('office-dev-')) return 'dev';
  if (role.startsWith('office-tester-')) return 'tester';
  if (role === 'office:reviewer') return 'reviewer';
  return 'intern';
}

export function inOfficeScope(input: {
  floorKind: FloorKind;
  sessionRole: string | null;
  leadRole: string | null;
}): boolean {
  if (input.floorKind !== 'managed' && input.floorKind !== 'direccion') return false;
  return isOfficeRole(input.sessionRole) || isOfficeRole(input.leadRole);
}
