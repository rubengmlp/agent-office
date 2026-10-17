import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeAtomic } from './config';
import { noLog, type Log } from './log';
import type { FloorLayoutOverride, FurnitureKind, HubText, LayoutsFile, RoleKind, Spot } from './types';

export const MAX_LAYOUTS_BYTES = 64 * 1024;
export const MAX_DESKS = 40;
export const MAX_FLOORS = 64;

export const FURNITURE_KINDS: readonly FurnitureKind[] = ['coffee', 'meeting', 'lab', 'board', 'printer'];

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

// A model of the pack, or one of the folder of custom characters.
export const MODEL_PATTERN = /^(?:quaternius\/[a-z-]+|custom\/[A-Za-z0-9_-]+)\.glb$/;
const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type LayoutsCheck = { ok: true; data: LayoutsFile } | { ok: false; error: HubText };

export function emptyLayouts(): LayoutsFile {
  return { version: 1, floors: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Invalid extends Error {
  constructor(readonly text: HubText) {
    super('invalid layout');
  }
}

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

function spotOf(raw: unknown, where: string): Spot {
  if (!isRecord(raw) || typeof raw.u !== 'number' || typeof raw.v !== 'number') throw new Invalid({ key: 'hub.layouts.spot', params: { where } });
  const { u, v } = raw;
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) throw new Invalid({ key: 'hub.layouts.spot', params: { where } });
  return { u: round(u), v: round(v) };
}

function overrideOf(raw: unknown, where: string): FloorLayoutOverride {
  if (!isRecord(raw)) throw new Invalid({ key: 'hub.layouts.invalid' });
  const out: FloorLayoutOverride = {};
  if (raw.lead !== undefined) out.lead = spotOf(raw.lead, `${where}.lead`);
  if (raw.desks !== undefined) {
    if (!Array.isArray(raw.desks)) throw new Invalid({ key: 'hub.layouts.invalid' });
    if (raw.desks.length > MAX_DESKS) throw new Invalid({ key: 'hub.layouts.tooManyDesks', params: { max: MAX_DESKS } });
    out.desks = raw.desks.map((desk, index) => (desk === null ? null : spotOf(desk, `${where}.desks[${index}]`)));
  }
  if (raw.furniture !== undefined) {
    if (!isRecord(raw.furniture)) throw new Invalid({ key: 'hub.layouts.invalid' });
    const furniture: Partial<Record<FurnitureKind, Spot>> = {};
    for (const [name, spot] of Object.entries(raw.furniture)) {
      if (!(FURNITURE_KINDS as readonly string[]).includes(name)) throw new Invalid({ key: 'hub.layouts.furniture', params: { name } });
      furniture[name as FurnitureKind] = spotOf(spot, `${where}.furniture.${name}`);
    }
    out.furniture = furniture;
  }
  if (raw.characters !== undefined) {
    if (!isRecord(raw.characters)) throw new Invalid({ key: 'hub.layouts.invalid' });
    const characters: Partial<Record<RoleKind, string>> = {};
    for (const [role, model] of Object.entries(raw.characters)) {
      if (!(ROLE_KINDS as readonly string[]).includes(role)) throw new Invalid({ key: 'hub.layouts.role', params: { role } });
      if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) throw new Invalid({ key: 'hub.layouts.model', params: { role } });
      characters[role as RoleKind] = model;
    }
    out.characters = characters;
  }
  return out;
}

// The file, clean: only what the panel knows how to draw, positions rounded, floors that no longer exist kept
// (a floor that comes back finds its layout).
export function validateLayouts(raw: unknown): LayoutsCheck {
  try {
    if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.floors)) throw new Invalid({ key: 'hub.layouts.invalid' });
    const slugs = Object.keys(raw.floors);
    if (slugs.length > MAX_FLOORS) throw new Invalid({ key: 'hub.layouts.tooManyFloors', params: { max: MAX_FLOORS } });
    const floors: Record<string, FloorLayoutOverride> = {};
    for (const slug of slugs) {
      if (!SLUG_PATTERN.test(slug)) throw new Invalid({ key: 'hub.layouts.slug', params: { slug } });
      floors[slug] = overrideOf(raw.floors[slug], slug);
    }
    const data: LayoutsFile = { version: 1, floors };
    if (raw.all !== undefined) data.all = overrideOf(raw.all, 'all');
    return { ok: true, data };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.text };
    throw error;
  }
}

export type LayoutsSave = LayoutsCheck | { ok: false; error: HubText; failed: true };

// layouts.json next to config.json: one hub writes it, whole, through a temporary file and a rename, mode 600.
// It is not in config.json because saving the settings regenerates the agents, nor in the browser because
// another browser would not see it.
export class LayoutStore {
  private data: LayoutsFile;

  constructor(
    private readonly file: string,
    private readonly log: Log = noLog,
  ) {
    this.data = this.read();
  }

  get(): LayoutsFile {
    return this.data;
  }

  save(raw: unknown): LayoutsSave {
    const checked = validateLayouts(raw);
    if (!checked.ok) return checked;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeAtomic(this.file, `${JSON.stringify(checked.data, null, 2)}\n`);
    } catch (error) {
      this.log(`no se pudo guardar layouts.json: ${error instanceof Error ? error.message : String(error)}`);
      return { ok: false, error: { key: 'hub.layouts.saveFailed' }, failed: true };
    }
    this.data = checked.data;
    return checked;
  }

  private read(): LayoutsFile {
    if (!existsSync(this.file)) return emptyLayouts();
    try {
      const checked = validateLayouts(JSON.parse(readFileSync(this.file, 'utf8')) as unknown);
      if (checked.ok) return checked.data;
      this.log('layouts.json no es válido: la oficina arranca con la distribución por defecto');
    } catch (error) {
      this.log(`layouts.json no se puede leer: ${error instanceof Error ? error.message : String(error)}`);
    }
    return emptyLayouts();
  }
}
