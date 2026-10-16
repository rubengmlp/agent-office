import { t, type MessageKey } from '../i18n';
import type { DepartmentsConfig, Effort, PermissionMode, RoleId, RoleKind } from '../types';

export const OTHER_MODEL = '__other__';

export const DEFAULT_CHOICE = '__default__';

export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,79}$/;

export const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

export type NumberKey =
  | 'maxRounds'
  | 'maxPlanBytes'
  | 'maxReviewerReads'
  | 'maxLessons'
  | 'maxLessonsPerSession'
  | 'maxContextChars'
  | 'leaveAfterMinutes'
  | 'maxBriefsPerOrder'
  | 'stalledAfterMinutes'
  | 'checksTimeoutMinutes'
  | 'checksMaxParallel'
  | 'checksTailBytes'
  | 'worktreeRetentionDays'
  | 'worktreeMaxActive'
  | 'worktreeWarnGb'
  | 'checkpointMaxFileKb';

export type NumberField = {
  key: NumberKey;
  labelKey: MessageKey;
  hintKey: MessageKey;
  min: number;
  max: number;
};

export const ROLE_ROWS: readonly { id: RoleId; kind: RoleKind; labelKey: MessageKey }[] = [
  { id: 'director', kind: 'director', labelKey: 'settings.role.director' },
  { id: 'lead', kind: 'lead', labelKey: 'settings.role.lead' },
  { id: 'dev', kind: 'dev', labelKey: 'settings.role.dev' },
  { id: 'tester', kind: 'tester', labelKey: 'settings.role.tester' },
  { id: 'reviewer', kind: 'reviewer', labelKey: 'settings.role.reviewer' },
  { id: 'redactor', kind: 'writer', labelKey: 'settings.role.redactor' },
  { id: 'revisor-planes', kind: 'planReviewer', labelKey: 'settings.role.revisor-planes' },
  { id: 'artesano', kind: 'skillwright', labelKey: 'settings.role.artesano' },
  { id: 'revisor-skills', kind: 'skillReviewer', labelKey: 'settings.role.revisor-skills' },
];

export function targetRoleLabel(target: string, id: RoleId): string {
  if (id === 'lead') {
    if (target === 'redaccion') return t('settings.floorRoles.lead.redaccion');
    if (target === 'mantenimiento') return t('settings.floorRoles.lead.mantenimiento');
    return t('settings.floorRoles.lead.floor');
  }
  const row = ROLE_ROWS.find((item) => item.id === id);
  return row ? t(row.labelKey) : id;
}

// Model aliases are names and stay as they are; the other two options are translated.
export const MODEL_OPTIONS: readonly ({ value: string; label: string } | { value: string; labelKey: MessageKey })[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'fable', label: 'Fable' },
  { value: 'inherit', labelKey: 'settings.model.inherit' },
  { value: OTHER_MODEL, labelKey: 'settings.model.other' },
];

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const PERMISSION_MODE_OPTIONS: readonly { value: PermissionMode; labelKey: MessageKey }[] = [
  { value: 'auto', labelKey: 'settings.permissionMode.auto' },
  { value: 'manual', labelKey: 'settings.permissionMode.manual' },
  { value: 'acceptEdits', labelKey: 'settings.permissionMode.acceptEdits' },
  { value: 'plan', labelKey: 'settings.permissionMode.plan' },
  { value: 'dontAsk', labelKey: 'settings.permissionMode.dontAsk' },
];

export function permissionTargetLabel(slug: string): string {
  if (slug === 'direccion') return t('settings.permissionTarget.direccion');
  if (slug === 'redaccion') return t('floor.redaccion');
  if (slug === 'mantenimiento') return t('floor.mantenimiento');
  return slug;
}

export function permissionTargetHint(slug: string): string {
  if (slug === 'direccion') return t('settings.permissionTarget.hint.direccion');
  if (slug === 'redaccion' || slug === 'mantenimiento') return t('settings.permissionTarget.hint.department');
  return t('settings.permissionTarget.hint.floor');
}

export const DEPARTMENT_ROWS: readonly { key: keyof DepartmentsConfig; labelKey: MessageKey; hintKey: MessageKey }[] = [
  { key: 'redaccion', labelKey: 'settings.department.redaccion', hintKey: 'settings.department.hint.redaccion' },
  { key: 'mantenimiento', labelKey: 'settings.department.mantenimiento', hintKey: 'settings.department.hint.mantenimiento' },
];

export const REVIEW_FIELDS: readonly NumberField[] = [
  { key: 'maxRounds', labelKey: 'settings.field.maxRounds', hintKey: 'settings.field.hint.maxRounds', min: 1, max: 10 },
  { key: 'maxPlanBytes', labelKey: 'settings.field.maxPlanBytes', hintKey: 'settings.field.hint.maxPlanBytes', min: 0, max: 200000 },
  { key: 'maxReviewerReads', labelKey: 'settings.field.maxReviewerReads', hintKey: 'settings.field.hint.maxReviewerReads', min: 0, max: 500 },
];

export const MEMORY_FIELDS: readonly NumberField[] = [
  { key: 'maxLessons', labelKey: 'settings.field.maxLessons', hintKey: 'settings.field.hint.maxLessons', min: 1, max: 200 },
  {
    key: 'maxLessonsPerSession',
    labelKey: 'settings.field.maxLessonsPerSession',
    hintKey: 'settings.field.hint.maxLessonsPerSession',
    min: 0,
    max: 20,
  },
  {
    key: 'maxContextChars',
    labelKey: 'settings.field.maxContextChars',
    hintKey: 'settings.field.hint.maxContextChars',
    min: 500,
    max: 20000,
  },
];

export const OFFICE_FIELDS: readonly NumberField[] = [
  {
    key: 'leaveAfterMinutes',
    labelKey: 'settings.field.leaveAfterMinutes',
    hintKey: 'settings.field.hint.leaveAfterMinutes',
    min: 1,
    max: 60,
  },
  {
    key: 'maxBriefsPerOrder',
    labelKey: 'settings.field.maxBriefsPerOrder',
    hintKey: 'settings.field.hint.maxBriefsPerOrder',
    min: 0,
    max: 20,
  },
  {
    key: 'stalledAfterMinutes',
    labelKey: 'settings.field.stalledAfterMinutes',
    hintKey: 'settings.field.hint.stalledAfterMinutes',
    min: 0,
    max: 240,
  },
];

export const DELIVERY_FIELDS: readonly NumberField[] = [
  { key: 'checksTimeoutMinutes', labelKey: 'settings.field.checksTimeoutMinutes', hintKey: 'settings.field.hint.checksTimeoutMinutes', min: 1, max: 120 },
  { key: 'checksMaxParallel', labelKey: 'settings.field.checksMaxParallel', hintKey: 'settings.field.hint.checksMaxParallel', min: 1, max: 8 },
  { key: 'checksTailBytes', labelKey: 'settings.field.checksTailBytes', hintKey: 'settings.field.hint.checksTailBytes', min: 1000, max: 64000 },
  { key: 'worktreeRetentionDays', labelKey: 'settings.field.worktreeRetentionDays', hintKey: 'settings.field.hint.worktreeRetentionDays', min: 1, max: 90 },
  { key: 'worktreeMaxActive', labelKey: 'settings.field.worktreeMaxActive', hintKey: 'settings.field.hint.worktreeMaxActive', min: 1, max: 20 },
  { key: 'worktreeWarnGb', labelKey: 'settings.field.worktreeWarnGb', hintKey: 'settings.field.hint.worktreeWarnGb', min: 1, max: 1000 },
  { key: 'checkpointMaxFileKb', labelKey: 'settings.field.checkpointMaxFileKb', hintKey: 'settings.field.hint.checkpointMaxFileKb', min: 1, max: 102400 },
];

export const NUMBER_FIELDS: readonly NumberField[] = [...REVIEW_FIELDS, ...MEMORY_FIELDS, ...OFFICE_FIELDS, ...DELIVERY_FIELDS];
