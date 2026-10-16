import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../src/i18n/en';
import { es, type MessageKey } from '../src/i18n/es';
import { createTranslator, interpolate } from '../src/i18n/index';

// Keys whose text is legitimately the same in both languages: proper names, words shared by both, symbols.
const SAME_KEYS: MessageKey[] = [
  'topbar.status.replay',
  'replay.label',
  'role.director',
  'role.tester',
  'settings.role.director',
  'settings.role.tester',
  'settings.section.roles',
  'settings.section.hub',
  'stack.flutter',
  'stack.laravel',
  'stack.node',
  'verdict.tests',
  'table.docs.skills',
];

const SOURCE_DIR = join(import.meta.dir, '../src');
const ACCENTED_LITERAL = /(['"`])(?:(?!\1)[^\n])*[áéíóúñÁÉÍÓÚÑ¿¡](?:(?!\1)[^\n])*\1/;

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe('dictionaries', () => {
  test('en has exactly the keys of es, none empty, with the same placeholders', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    for (const key of Object.keys(es) as MessageKey[]) {
      expect(es[key].trim(), key).not.toBe('');
      expect(en[key].trim(), key).not.toBe('');
      expect(placeholders(en[key]), key).toEqual(placeholders(es[key]));
    }
  });

  test('every .one key has its .other', () => {
    const keys = new Set<string>(Object.keys(es));
    for (const key of keys) {
      if (key.endsWith('.one')) expect(keys.has(`${key.slice(0, -'.one'.length)}.other`), key).toBe(true);
    }
  });

  test('no key has the same text in both languages unless listed in SAME_KEYS', () => {
    const same = (Object.keys(es) as MessageKey[]).filter((key) => es[key] === en[key]);
    expect(same.sort()).toEqual([...SAME_KEYS].sort());
  });
});

describe('translator', () => {
  test('interpolate replaces known placeholders and keeps unknown ones', () => {
    expect(interpolate('{a} y {b}', { a: 1 })).toBe('1 y {b}');
    expect(interpolate('sin marcadores')).toBe('sin marcadores');
  });

  test('t and plural use the given dictionary', () => {
    const spanish = createTranslator(es);
    expect(spanish.t('table.files.other', { n: 3 })).toBe('3 ficheros');
    expect(spanish.plural('table.files', 1)).toBe('1 fichero');
    expect(spanish.plural('table.files', 2)).toBe('2 ficheros');

    const english = createTranslator(en);
    expect(english.t('table.files.other', { n: 3 })).toBe('3 files');
    expect(english.plural('table.files', 1)).toBe('1 file');
    expect(english.plural('table.files', 0)).toBe('0 files');
  });
});

describe('source scan', () => {
  test('no accented literal outside i18n/', () => {
    const found: string[] = [];
    for (const path of new Bun.Glob('**/*.ts').scanSync(SOURCE_DIR)) {
      if (path.startsWith('i18n/')) continue;
      const lines = readFileSync(join(SOURCE_DIR, path), 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (ACCENTED_LITERAL.test(line)) found.push(`${path}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });
});
