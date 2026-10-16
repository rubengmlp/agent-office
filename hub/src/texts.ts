import { DIRECCION, MANTENIMIENTO, REDACCION } from './floors';
import type { HubText, HubTextKey, HubTextParams, RoleId } from './types';

// Bases B with a `${B}.one` key; distributes over the union it is given.
export type PluralBase<K extends string> = K extends `${infer B}.one` ? B : never;

type OneParams<B extends PluralBase<HubTextKey>> = HubTextParams[`${B}.one` & HubTextKey];

// Chooses .one or .other (Spanish and English share the rule) and adds n to the parameters.
export function plural<B extends PluralBase<HubTextKey>>(base: B, n: number, params: Omit<OneParams<B>, 'n'>): HubText {
  return { key: `${base}.${n === 1 ? 'one' : 'other'}`, params: { ...params, n } } as HubText;
}

const ROLE_TEXT: Record<RoleId, HubText> = {
  director: { key: 'hub.role.director' },
  lead: { key: 'hub.role.lead' },
  dev: { key: 'hub.role.dev' },
  tester: { key: 'hub.role.tester' },
  reviewer: { key: 'hub.role.reviewer' },
  redactor: { key: 'hub.role.redactor' },
  'revisor-planes': { key: 'hub.role.revisor-planes' },
  artesano: { key: 'hub.role.artesano' },
  'revisor-skills': { key: 'hub.role.revisor-skills' },
};

export function roleText(roleId: RoleId): HubText {
  return ROLE_TEXT[roleId];
}

export function floorText(slug: string): HubText {
  if (slug === DIRECCION) return { key: 'hub.floor.direccion' };
  if (slug === REDACCION) return { key: 'hub.floor.redaccion' };
  if (slug === MANTENIMIENTO) return { key: 'hub.floor.mantenimiento' };
  return { key: 'hub.floor.other', params: { slug } };
}

// Optional suffixes of verdict and review entries: nested texts, or nothing.
export function roundText(round: number | null): HubText {
  return round ? { key: 'hub.round', params: { n: round } } : '';
}

export function scoreText(score: number | null): HubText {
  return score !== null ? { key: 'hub.score', params: { n: score } } : '';
}
