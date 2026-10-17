import { describe, expect, test } from 'bun:test';
import { hubEn } from '../../shared/i18n/en';
import { hubEs } from '../../shared/i18n/es';
import { renderHubText } from '../src/render-text';
import type { HubText } from '../src/types';

describe('shared hub dictionaries', () => {
  test('the Spanish and English hub dictionaries have the same keys, all hub.*', () => {
    expect(Object.keys(hubEn).sort()).toEqual(Object.keys(hubEs).sort());
    expect(Object.keys(hubEs).every((key) => key.startsWith('hub.'))).toBe(true);
  });
});

describe('renderHubText', () => {
  test('raw text as is, null as empty', () => {
    expect(renderHubText('flutter test')).toBe('flutter test');
    expect(renderHubText(null)).toBe('');
    expect(renderHubText(undefined)).toBe('');
  });

  test('a key in Spanish with its nested parameters', () => {
    const lesson = { key: 'hub.act.lessonSaved', params: { role: { key: 'hub.role.redactor' }, floor: { key: 'hub.floor.redaccion' } } } as const;
    expect(renderHubText(lesson)).toBe('lección guardada para redactor en Redacción');
    expect(renderHubText({ key: 'hub.act.sessionStart', params: { source: 'startup' } })).toBe('sesión iniciada (startup)');
  });

  test('parameters go in a single pass and unknown keys come out as the key', () => {
    expect(renderHubText({ key: 'hub.act.message', params: { to: '{text}', text: 'hola' } })).toBe('escribe a {text}: hola');
    expect(renderHubText({ key: 'hub.act.fromNewerHub' } as unknown as HubText)).toBe('hub.act.fromNewerHub');
    expect(renderHubText({ key: 42 } as unknown as HubText)).toBe('');
  });
});
