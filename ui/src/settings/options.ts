import type { DepartmentsConfig, Effort, PermissionMode, RoleId } from '../types';

export const OTHER_MODEL = '__other__';

export const DEFAULT_CHOICE = '__default__';

export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,79}$/;

export const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

export type NumberKey = 'maxRounds' | 'maxLessons' | 'maxLessonsPerSession' | 'maxContextChars' | 'leaveAfterMinutes';

export type NumberField = {
  key: NumberKey;
  label: string;
  hint: string;
  min: number;
  max: number;
};

export const ROLE_ROWS: readonly { id: RoleId; label: string }[] = [
  { id: 'director', label: 'Director' },
  { id: 'lead', label: 'Jefes de planta' },
  { id: 'dev', label: 'Desarrolladores' },
  { id: 'tester', label: 'Testers' },
  { id: 'reviewer', label: 'Revisores de código' },
  { id: 'redactor', label: 'Redactores' },
  { id: 'revisor-planes', label: 'Revisores de planes' },
  { id: 'artesano', label: 'Artesanos de skills' },
  { id: 'revisor-skills', label: 'Revisores de skills' },
];

export const MODEL_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'fable', label: 'Fable' },
  { value: 'inherit', label: 'Heredar (inherit)' },
  { value: OTHER_MODEL, label: 'Otro…' },
];

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const PERMISSION_MODE_OPTIONS: readonly { value: PermissionMode; label: string }[] = [
  { value: 'auto', label: 'Automático: decide qué es seguro y pregunta el resto' },
  { value: 'manual', label: 'Manual: pregunta antes de cada acción no permitida' },
  { value: 'acceptEdits', label: 'Aceptar ediciones: edita sin preguntar' },
  { value: 'plan', label: 'Plan: solo lee y propone, no edita ni ejecuta' },
  { value: 'dontAsk', label: 'No preguntar: deniega lo no permitido' },
];

export function permissionTargetLabel(slug: string): string {
  if (slug === 'direccion') return 'Dirección (director)';
  if (slug === 'redaccion') return 'Redacción';
  if (slug === 'mantenimiento') return 'Mantenimiento';
  return slug;
}

export const DEPARTMENT_ROWS: readonly { key: keyof DepartmentsConfig; label: string; hint: string }[] = [
  { key: 'redaccion', label: 'Redacción', hint: 'Redactores y revisores que escriben y revisan planes.' },
  { key: 'mantenimiento', label: 'Mantenimiento', hint: 'Artesanos y revisores que crean skills.' },
];

export const REVIEW_FIELDS: readonly NumberField[] = [
  {
    key: 'maxRounds',
    label: 'Rondas máximas',
    hint: 'Si en la última ronda quedan bloqueantes, el revisor contesta SIN ACUERDO.',
    min: 1,
    max: 10,
  },
];

export const MEMORY_FIELDS: readonly NumberField[] = [
  {
    key: 'maxLessons',
    label: 'Lecciones por planta y rol',
    hint: 'Al pasarse se podan las más antiguas de origen agente; las tuyas no.',
    min: 1,
    max: 200,
  },
  {
    key: 'maxLessonsPerSession',
    label: 'Lecciones por sesión',
    hint: 'Cuántas LECCIÓN: acepta el hub de cada agente; con 0 no acepta ninguna.',
    min: 0,
    max: 20,
  },
  {
    key: 'maxContextChars',
    label: 'Caracteres de contexto',
    hint: 'Tope del texto de memoria que recibe cada agente al empezar.',
    min: 500,
    max: 20000,
  },
];

export const OFFICE_FIELDS: readonly NumberField[] = [
  {
    key: 'leaveAfterMinutes',
    label: 'Minutos hasta irse a casa',
    hint: 'Un compañero libre durante este tiempo sale del edificio si su jefe no está trabajando; vuelve en cuanto recibe trabajo.',
    min: 1,
    max: 60,
  },
];

export const NUMBER_FIELDS: readonly NumberField[] = [...REVIEW_FIELDS, ...MEMORY_FIELDS, ...OFFICE_FIELDS];
