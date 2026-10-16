import { afterEach, describe, expect, test } from 'bun:test';
import { applyLang } from '../src/i18n/index';
import { formatTokens, tokensLine, tokenWritten } from '../src/labels';
import { Store, withDefaults } from '../src/store';
import type { AgentView, TokenTotals } from '../src/types';

Object.assign(globalThis, { window: { ...Reflect.get(globalThis, 'window'), setInterval: () => 0, setTimeout: () => 0 } });

afterEach(() => applyLang('es'));

const TOTALS: TokenTotals = { turns: 29, input: 40, cacheRead: 3_000_000, cacheCreate: 146_000, output: 1_400 };

describe('formatTokens', () => {
  test('writes thousands and millions with one decimal and the language separator', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1_400)).toBe('1,4 K');
    expect(formatTokens(3_000_000)).toBe('3,0 M');
    expect(formatTokens(146_000)).toBe('146 K');
    expect(formatTokens(99_960)).toBe('100 K');
    expect(formatTokens(999_960)).toBe('1,0 M');
    applyLang('en');
    expect(formatTokens(1_400)).toBe('1.4 K');
    expect(formatTokens(3_000_000)).toBe('3.0 M');
  });
});

describe('tokensLine', () => {
  test('reads, writes (input plus cache creation) and output in the language of the panel', () => {
    expect(tokenWritten(TOTALS)).toBe(146_040);
    expect(tokensLine(TOTALS)).toBe('Tokens: 29 turnos · 3,0 M leídos · 146 K escritos · 1,4 K generados');
    expect(tokensLine({ ...TOTALS, turns: 1 })).toContain('1 turno ·');
    applyLang('en');
    expect(tokensLine(TOTALS)).toBe('Tokens: 29 turns · 3.0 M read · 146 K written · 1.4 K generated');
  });
});

describe('withDefaults', () => {
  test('an agent from an older hub has no tokens', () => {
    const old = { key: 'a', endedAt: null } as unknown as AgentView;
    expect(withDefaults(old).tokens).toBeNull();
    expect(withDefaults({ ...old, tokens: TOTALS }).tokens).toEqual(TOTALS);
  });
});

describe('Store', () => {
  test('a tokens message updates the agent it names and ignores an unknown one', () => {
    const store = new Store();
    const agent = { key: 'a', sessionId: 's', endedAt: null, tokens: null } as unknown as AgentView;
    store.apply({ type: 'agent', data: agent });
    store.apply({ type: 'tokens', data: { agentKey: 'a', tokens: TOTALS, plan: null } });
    expect(store.agents.get('a')?.tokens).toEqual(TOTALS);
    store.apply({ type: 'tokens', data: { agentKey: 'nobody', tokens: TOTALS, plan: null } });
    expect(store.agents.has('nobody')).toBe(false);
  });
});
