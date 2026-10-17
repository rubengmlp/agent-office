import { afterEach, describe, expect, test } from 'bun:test';
import { applyLang } from '../src/i18n/index';
import { contextFill, contextLevel, contextLine, contextOf } from '../src/labels';
import { Store, withDefaults } from '../src/store';
import type { AgentContext, AgentView } from '../src/types';
import { agent } from './fixtures';

Object.assign(globalThis, { window: { ...Reflect.get(globalThis, 'window'), setInterval: () => 0, setTimeout: () => 0 } });

afterEach(() => applyLang('es'));

const context = (extra: Partial<AgentContext> = {}): AgentContext => ({ usedPct: 45, tokens: 90_000, window: 200_000, compactions: 0, source: 'transcript', at: 1, ...extra });

describe('contextLevel', () => {
  test('ok under 60, warn from 60 to 80, danger above 80', () => {
    expect([0, 59.9].map(contextLevel)).toEqual(['ok', 'ok']);
    expect([60, 70, 80].map(contextLevel)).toEqual(['warn', 'warn', 'warn']);
    expect([80.1, 95, 100].map(contextLevel)).toEqual(['danger', 'danger', 'danger']);
  });

  test('the width of a bar stays between 0 and 100', () => {
    expect(contextFill(context({ usedPct: 45.5 }))).toBe(45.5);
    expect(contextFill(context({ usedPct: 130 }))).toBe(100);
    expect(contextFill(context({ usedPct: -3 }))).toBe(0);
  });
});

describe('contextLine', () => {
  test('percentage, tokens used of the window, and compactions only when there are some', () => {
    expect(contextLine(context())).toBe('Contexto 45 % · 90,0 K de 200 K');
    expect(contextLine(context({ compactions: 1 }))).toBe('Contexto 45 % · 90,0 K de 200 K · 1 compactación');
    expect(contextLine(context({ usedPct: 62.4, tokens: 124_800, window: 1_000_000, compactions: 3 }))).toBe('Contexto 62 % · 125 K de 1,0 M · 3 compactaciones');
    applyLang('en');
    expect(contextLine(context({ compactions: 2 }))).toBe('Context 45 % · 90.0 K of 200 K · 2 compactions');
  });
});

describe('contextOf', () => {
  test('an ended agent shows no context, and an agent from an older hub shows none either', () => {
    expect(contextOf(agent('a', { context: context() }))).toEqual(context());
    expect(contextOf(agent('a', { context: context(), endedAt: 5 }))).toBeNull();
    expect(contextOf(agent('a'))).toBeNull();
    expect(contextOf({ endedAt: null } as AgentView)).toBeNull();
  });
});

describe('Store and context', () => {
  test('withDefaults gives an older agent a null context', () => {
    expect(withDefaults({ key: 'a', endedAt: null } as unknown as AgentView).context).toBeNull();
    expect(withDefaults({ key: 'a', endedAt: null, context: context() } as unknown as AgentView).context).toEqual(context());
  });

  test('an agent message brings the context and a tokens message updates it, keeping it when it brings none', () => {
    const store = new Store();
    store.apply({ type: 'agent', data: agent('a', { context: context({ usedPct: 20, source: 'statusline' }) }) });
    expect(store.agents.get('a')?.context?.usedPct).toBe(20);
    const tokens = { turns: 1, input: 1, cacheRead: 1, cacheCreate: 1, output: 1 };
    store.apply({ type: 'tokens', data: { agentKey: 'a', tokens, plan: null, context: context({ usedPct: 70 }) } });
    expect(store.agents.get('a')?.context).toMatchObject({ usedPct: 70, source: 'transcript' });
    store.apply({ type: 'tokens', data: { agentKey: 'a', tokens, plan: null } });
    expect(store.agents.get('a')?.context?.usedPct).toBe(70);
    store.apply({ type: 'tokens', data: { agentKey: 'a', tokens, plan: null, context: null } });
    expect(store.agents.get('a')?.context?.usedPct).toBe(70);
  });
});
