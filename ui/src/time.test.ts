import { describe, expect, test } from 'bun:test';
import { duration } from './time';

const MIN = 60_000;

describe('duration', () => {
  test('reads as minutes, hours with minutes, or days with hours', () => {
    expect(duration(0)).toBe('menos de 1 min');
    expect(duration(45 * MIN)).toBe('45 min');
    expect(duration(130 * MIN)).toBe('2 h 10 min');
    expect(duration(120 * MIN)).toBe('2 h');
    expect(duration((3 * 24 + 4) * 60 * MIN)).toBe('3 d 4 h');
    expect(duration(2 * 24 * 60 * MIN)).toBe('2 d');
    expect(duration(-5 * MIN)).toBe('menos de 1 min');
  });
});
