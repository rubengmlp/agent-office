import { describe, expect, test } from 'bun:test';
import { fold, fuzzyFilter, fuzzyMatch } from '../src/fuzzy';

describe('fold', () => {
  test('drops accents and case and keeps the length', () => {
    expect(fold('Planta Dirección Ñandú')).toBe('planta direccion nandu');
    expect(fold('Árbol').length).toBe('Árbol'.length);
  });
});

describe('fuzzyMatch', () => {
  test('an empty query matches everything with no letters marked', () => {
    expect(fuzzyMatch('', 'lead-mobile')).toEqual({ score: 0, indices: [] });
    expect(fuzzyMatch('  ', 'lead-mobile')?.indices).toEqual([]);
  });

  test('the letters must appear in order', () => {
    expect(fuzzyMatch('ldm', 'lead-mobile')?.indices).toEqual([0, 3, 5]);
    expect(fuzzyMatch('mdl', 'lead-mobile')).toBeNull();
    expect(fuzzyMatch('xyz', 'lead-mobile')).toBeNull();
  });

  test('folds accents in both the query and the text', () => {
    expect(fuzzyMatch('direccion', 'Dirección')).not.toBeNull();
    expect(fuzzyMatch('dirección', 'direccion')).not.toBeNull();
    expect(fuzzyMatch('ESPANA', 'España')).not.toBeNull();
  });

  test('a prefix beats a word start, which beats scattered letters', () => {
    const prefix = fuzzyMatch('tab', 'Tablero')?.score ?? 0;
    const word = fuzzyMatch('tab', 'Ver tablero')?.score ?? 0;
    const scattered = fuzzyMatch('tab', 'Tienda abierta bar')?.score ?? 0;
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(scattered);
  });

  test('a shorter text wins between equal matches', () => {
    expect((fuzzyMatch('lead', 'lead')?.score ?? 0) > (fuzzyMatch('lead', 'lead-mobile-long-name')?.score ?? 0)).toBe(true);
  });
});

describe('fuzzyFilter', () => {
  const names = ['lead-mobile', 'tester-mobile', 'Redacción', 'Tabla', 'Tablero'];

  test('keeps only what fits, best first', () => {
    expect(fuzzyFilter(names, 'tab', (n) => n).map((r) => r.item)).toEqual(['Tabla', 'Tablero']);
    expect(fuzzyFilter(names, 'mob', (n) => n).map((r) => r.item)).toEqual(['lead-mobile', 'tester-mobile']);
  });

  test('matches through accents', () => {
    expect(fuzzyFilter(names, 'redaccion', (n) => n).map((r) => r.item)).toEqual(['Redacción']);
  });

  test('keeps the original order between equal scores', () => {
    const same = ['bb', 'aa', 'cc'];
    expect(fuzzyFilter(same, '', (n) => n).map((r) => r.item)).toEqual(['bb', 'aa', 'cc']);
  });

  test('nothing fits an impossible query', () => {
    expect(fuzzyFilter(names, 'zzz', (n) => n)).toEqual([]);
  });
});
