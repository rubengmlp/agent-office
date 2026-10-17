import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_ROLE_MODELS,
  PACK_MODELS,
  emptyLayouts,
  furnitureSignature,
  isEmptyOverride,
  modelOverride,
  overrideHash,
  paletteRole,
  resolveOverride,
  spotOf,
  withCharacter,
  withDesk,
  withFurniture,
  withLead,
  withoutPlacement,
} from '../src/layouts';
import type { LayoutsFile } from '../src/types';

const file: LayoutsFile = {
  version: 1,
  floors: { mobile: { lead: { u: 0.1, v: 0.2 }, desks: [{ u: 0.3, v: 0.3 }], furniture: { coffee: { u: 0.9, v: 0.1 } } } },
  all: { furniture: { coffee: { u: 0.5, v: 0.5 }, lab: { u: 0.6, v: 0.1 } }, characters: { dev: 'quaternius/punk.glb' } },
};

describe('resolveOverride', () => {
  test('nothing anywhere is undefined, so a floor without changes costs nothing', () => {
    expect(resolveOverride(null, 'mobile')).toBeUndefined();
    expect(resolveOverride(undefined, 'mobile')).toBeUndefined();
    expect(resolveOverride(emptyLayouts(), 'mobile')).toBeUndefined();
    expect(resolveOverride({ version: 1, floors: { mobile: { desks: [null] }, backend: {} }, all: {} }, 'mobile')).toBeUndefined();
  });

  test('a floor starts from `all` and its own fields win', () => {
    expect(resolveOverride(file, 'mobile')).toEqual({
      lead: { u: 0.1, v: 0.2 },
      desks: [{ u: 0.3, v: 0.3 }],
      furniture: { coffee: { u: 0.9, v: 0.1 }, lab: { u: 0.6, v: 0.1 } },
      characters: { dev: 'quaternius/punk.glb' },
    });
    expect(resolveOverride(file, 'backend')).toEqual({ furniture: { coffee: { u: 0.5, v: 0.5 }, lab: { u: 0.6, v: 0.1 } }, characters: { dev: 'quaternius/punk.glb' } });
  });

  test('isEmptyOverride sees through empty lists and maps', () => {
    expect(isEmptyOverride(undefined)).toBe(true);
    expect(isEmptyOverride({ desks: [null, null], furniture: {}, characters: {} })).toBe(true);
    expect(isEmptyOverride({ desks: [null, { u: 0, v: 0 }] })).toBe(false);
    expect(isEmptyOverride({ characters: { lead: 'quaternius/king.glb' } })).toBe(false);
  });
});

describe('signatures', () => {
  test('the furniture signature changes with the furniture only, and is empty with none', () => {
    expect(furnitureSignature(undefined)).toBe('');
    expect(furnitureSignature({ desks: [{ u: 1, v: 1 }], characters: { dev: 'quaternius/punk.glb' } })).toBe('');
    const a = furnitureSignature({ furniture: { coffee: { u: 0.5, v: 0.5 } } });
    expect(a).not.toBe('');
    expect(furnitureSignature({ furniture: { coffee: { u: 0.5, v: 0.5 } }, lead: { u: 0, v: 0 } })).toBe(a);
    expect(furnitureSignature({ furniture: { coffee: { u: 0.5, v: 0.6 } } })).not.toBe(a);
    expect(furnitureSignature({ furniture: { lab: { u: 0.5, v: 0.5 } } })).not.toBe(a);
  });

  test('the override hash sees every part and is empty with none', () => {
    expect(overrideHash(undefined)).toBe('');
    expect(overrideHash({ desks: [null] })).toBe('');
    const base = { lead: { u: 0.1, v: 0.1 }, desks: [{ u: 0.2, v: 0.2 }], furniture: { coffee: { u: 0.3, v: 0.3 } }, characters: { dev: 'quaternius/punk.glb' } };
    const hash = overrideHash(base);
    expect(hash).not.toBe('');
    expect(overrideHash({ ...base })).toBe(hash);
    for (const changed of [
      { ...base, lead: { u: 0.1, v: 0.2 } },
      { ...base, desks: [{ u: 0.2, v: 0.3 }] },
      { ...base, furniture: { coffee: { u: 0.4, v: 0.3 } } },
      { ...base, characters: { dev: 'quaternius/king.glb' } },
    ]) {
      expect(overrideHash(changed)).not.toBe(hash);
    }
  });
});

describe('characters in 2D and 3D', () => {
  test('the model of a role is the one the override names', () => {
    expect(modelOverride(undefined, 'dev')).toBeUndefined();
    expect(modelOverride({ characters: { dev: 'quaternius/punk.glb' } }, 'dev')).toBe('quaternius/punk.glb');
    expect(modelOverride({ characters: { dev: 'quaternius/punk.glb' } }, 'lead')).toBeUndefined();
  });

  test('in 2D a role wears the outfit of the role whose model it was given', () => {
    expect(paletteRole('dev', undefined)).toBe('dev');
    expect(paletteRole('dev', { characters: { dev: DEFAULT_ROLE_MODELS.reviewer } })).toBe('reviewer');
    expect(paletteRole('dev', { characters: { dev: DEFAULT_ROLE_MODELS.dev } })).toBe('dev');
    expect(paletteRole('dev', { characters: { dev: 'quaternius/king.glb' } })).toBe('dev');
    expect(paletteRole('dev', { characters: { dev: 'custom/hero.glb' } })).toBe('dev');
  });

  test('every default model is in the pack', () => {
    for (const model of Object.values(DEFAULT_ROLE_MODELS)) expect(PACK_MODELS).toContain(model);
  });
});

describe('editing a layout', () => {
  test('moving a desk fills the gaps with null and does not touch the original', () => {
    const next = withDesk(emptyLayouts(), 'mobile', 2, { u: 0.5, v: 0.5 });
    expect(next.floors.mobile?.desks).toEqual([null, null, { u: 0.5, v: 0.5 }]);
    expect(withDesk(next, 'mobile', 0, { u: 0.1, v: 0.1 }).floors.mobile?.desks?.[0]).toEqual({ u: 0.1, v: 0.1 });
    expect(emptyLayouts().floors).toEqual({});
  });

  test('the lead and the furniture are set on their floor only', () => {
    const next = withFurniture(withLead(emptyLayouts(), 'mobile', { u: 0.2, v: 0.4 }), 'backend', 'printer', { u: 0.9, v: 0.9 });
    expect(next.floors.mobile).toEqual({ lead: { u: 0.2, v: 0.4 } });
    expect(next.floors.backend).toEqual({ furniture: { printer: { u: 0.9, v: 0.9 } } });
  });

  test('restoring a floor drops its desks, lead and furniture and keeps its characters', () => {
    const start: LayoutsFile = { version: 1, floors: { mobile: { ...file.floors.mobile, characters: { dev: 'quaternius/king.glb' } }, backend: { lead: { u: 1, v: 1 } } } };
    expect(withoutPlacement(start, 'mobile').floors.mobile).toEqual({ characters: { dev: 'quaternius/king.glb' } });
    expect(withoutPlacement(start, 'backend').floors).toEqual({ mobile: start.floors.mobile });
    expect(withoutPlacement(start, 'missing')).toBe(start);
  });

  test('a character is set for every floor in `all`, and cleared again', () => {
    const set = withCharacter(emptyLayouts(), 'tester', 'quaternius/swat.glb');
    expect(set.all).toEqual({ characters: { tester: 'quaternius/swat.glb' } });
    const cleared = withCharacter(set, 'tester', null);
    expect(cleared.all).toBeUndefined();
    expect(withCharacter(file, 'dev', null).all).toEqual({ furniture: file.all?.furniture });
  });

  test('spots are clamped and rounded', () => {
    expect(spotOf(-1, 2)).toEqual({ u: 0, v: 1 });
    expect(spotOf(0.123456, 0.5)).toEqual({ u: 0.1235, v: 0.5 });
  });
});
