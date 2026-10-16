import { describe, expect, test } from 'bun:test';
import { SPEND_REFRESH_MS, spendDue } from '../src/table/usage-block';

describe('spendDue', () => {
  test('loads when visible and never loaded, then once a minute, never while loading or hidden', () => {
    expect(spendDue(1000, null, true, false)).toBe(true);
    expect(spendDue(1000, null, false, false)).toBe(false);
    expect(spendDue(1000, null, true, true)).toBe(false);
    expect(spendDue(1000 + SPEND_REFRESH_MS - 1, 1000, true, false)).toBe(false);
    expect(spendDue(1000 + SPEND_REFRESH_MS, 1000, true, false)).toBe(true);
  });
});

