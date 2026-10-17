import { describe, expect, test } from 'bun:test';
import { PRINT_S } from './constants';
import { sheetProgress } from './printer';

describe('the printer sheet', () => {
  test('slides out in 1.4 s, stays until 2 s and then is gone', () => {
    expect(PRINT_S).toBe(2);
    expect(sheetProgress(-1)).toBeNull();
    expect(sheetProgress(0)).toBe(0);
    expect(sheetProgress(0.7)).toBeCloseTo(0.5, 5);
    expect(sheetProgress(1.4)).toBe(1);
    expect(sheetProgress(1.99)).toBe(1);
    expect(sheetProgress(2)).toBeNull();
    expect(sheetProgress(9)).toBeNull();
  });
});
