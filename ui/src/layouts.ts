import type { FloorLayoutOverride, FurnitureKind, LayoutsFile, RoleKind, Spot } from './types';

export const FURNITURE: readonly FurnitureKind[] = ['coffee', 'meeting', 'lab', 'board', 'printer'];

export const ROLE_KINDS: readonly RoleKind[] = [
  'director',
  'lead',
  'dev',
  'tester',
  'reviewer',
  'writer',
  'planReviewer',
  'skillwright',
  'skillReviewer',
  'intern',
];

// The characters of the pack and the one each role wears by default (manifest.json can change the latter).
export const PACK_MODELS: readonly string[] = [
  'adventurer',
  'astronaut',
  'beach',
  'business-man',
  'casual',
  'farmer',
  'hoodie',
  'king',
  'punk',
  'swat',
  'worker',
].map((name) => `quaternius/${name}.glb`);

export const DEFAULT_ROLE_MODELS: Record<RoleKind, string> = {
  director: 'quaternius/business-man.glb',
  lead: 'quaternius/casual.glb',
  dev: 'quaternius/hoodie.glb',
  tester: 'quaternius/worker.glb',
  reviewer: 'quaternius/punk.glb',
  writer: 'quaternius/adventurer.glb',
  planReviewer: 'quaternius/adventurer.glb',
  skillwright: 'quaternius/farmer.glb',
  skillReviewer: 'quaternius/swat.glb',
  intern: 'quaternius/beach.glb',
};

export function emptyLayouts(): LayoutsFile {
  return { version: 1, floors: {} };
}

export function isEmptyOverride(override: FloorLayoutOverride | undefined): boolean {
  if (!override) return true;
  return (
    override.lead === undefined &&
    (override.desks === undefined || override.desks.every((spot) => spot === null)) &&
    Object.keys(override.furniture ?? {}).length === 0 &&
    Object.keys(override.characters ?? {}).length === 0
  );
}

// What a floor starts from (`all`) with its own override on top: a field of the floor wins, and furniture and
// characters merge one by one. Nothing set anywhere is undefined, so a floor without changes costs nothing.
export function resolveOverride(file: LayoutsFile | null | undefined, slug: string): FloorLayoutOverride | undefined {
  if (!file) return undefined;
  const base = file.all;
  const own = file.floors[slug];
  if (isEmptyOverride(base) && isEmptyOverride(own)) return undefined;
  const out: FloorLayoutOverride = {};
  const lead = own?.lead ?? base?.lead;
  if (lead) out.lead = lead;
  const desks = own?.desks ?? base?.desks;
  if (desks) out.desks = desks;
  const furniture = { ...base?.furniture, ...own?.furniture };
  if (Object.keys(furniture).length > 0) out.furniture = furniture;
  const characters = { ...base?.characters, ...own?.characters };
  if (Object.keys(characters).length > 0) out.characters = characters;
  return out;
}

function fnv(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const spotKey = (spot: Spot | null | undefined): string => (spot ? `${spot.u.toFixed(4)},${spot.v.toFixed(4)}` : '-');

// The signature of what changes the furniture of a room, which is built once and rebuilt only when this
// changes; '' when nothing was moved.
export function furnitureSignature(override: FloorLayoutOverride | undefined): string {
  const parts = FURNITURE.filter((kind) => override?.furniture?.[kind] !== undefined).map((kind) => `${kind}=${spotKey(override?.furniture?.[kind])}`);
  return parts.length === 0 ? '' : fnv(parts.join('|'));
}

// The same for the whole override: desks, lead, furniture and characters.
export function overrideHash(override: FloorLayoutOverride | undefined): string {
  if (isEmptyOverride(override)) return '';
  const o = override ?? {};
  const parts = [
    `lead=${spotKey(o.lead)}`,
    `desks=${(o.desks ?? []).map(spotKey).join(';')}`,
    ...FURNITURE.map((kind) => `${kind}=${spotKey(o.furniture?.[kind])}`),
    ...ROLE_KINDS.map((role) => `${role}=${o.characters?.[role] ?? ''}`),
  ];
  return fnv(parts.join('|'));
}

// The model a role wears on a floor, or undefined for the one the manifest says.
export function modelOverride(override: FloorLayoutOverride | undefined, role: RoleKind): string | undefined {
  return override?.characters?.[role];
}

// In 2D a character is a sprite: a role that wears the model of another one takes that role's outfit.
export function paletteRole(role: RoleKind, override: FloorLayoutOverride | undefined): RoleKind {
  const model = modelOverride(override, role);
  if (model === undefined) return role;
  if (DEFAULT_ROLE_MODELS[role] === model) return role;
  return ROLE_KINDS.find((kind) => DEFAULT_ROLE_MODELS[kind] === model) ?? role;
}

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function spotOf(u: number, v: number): Spot {
  return { u: Math.round(clamp01(u) * 10_000) / 10_000, v: Math.round(clamp01(v) * 10_000) / 10_000 };
}

function floorOverride(file: LayoutsFile, slug: string): FloorLayoutOverride {
  return { ...file.floors[slug] };
}

// The functions below return a new file; the editor sends it to the hub.
export function withDesk(file: LayoutsFile, slug: string, index: number, spot: Spot): LayoutsFile {
  const own = floorOverride(file, slug);
  const desks = [...(own.desks ?? [])];
  while (desks.length <= index) desks.push(null);
  desks[index] = spot;
  return { ...file, floors: { ...file.floors, [slug]: { ...own, desks } } };
}

export function withLead(file: LayoutsFile, slug: string, spot: Spot): LayoutsFile {
  return { ...file, floors: { ...file.floors, [slug]: { ...floorOverride(file, slug), lead: spot } } };
}

export function withFurniture(file: LayoutsFile, slug: string, kind: FurnitureKind, spot: Spot): LayoutsFile {
  const own = floorOverride(file, slug);
  return { ...file, floors: { ...file.floors, [slug]: { ...own, furniture: { ...own.furniture, [kind]: spot } } } };
}

// Puts the desks, the lead and the furniture of a floor back where they were; the characters stay.
export function withoutPlacement(file: LayoutsFile, slug: string): LayoutsFile {
  const own = file.floors[slug];
  if (!own) return file;
  const { lead: _lead, desks: _desks, furniture: _furniture, ...rest } = own;
  const floors = { ...file.floors };
  if (Object.keys(rest).length === 0) delete floors[slug];
  else floors[slug] = rest;
  return { ...file, floors };
}

export function withCharacter(file: LayoutsFile, role: RoleKind, model: string | null): LayoutsFile {
  const all = { ...file.all };
  const characters = { ...all.characters };
  if (model === null) delete characters[role];
  else characters[role] = model;
  if (Object.keys(characters).length > 0) all.characters = characters;
  else delete all.characters;
  const next: LayoutsFile = { ...file, floors: file.floors };
  if (Object.keys(all).length > 0) next.all = all;
  else delete next.all;
  return next;
}
