import { afterEach, describe, expect, test } from 'bun:test';
import { applyLang } from '../src/i18n/index';
import { documentStatusText, hasMaxRounds } from '../src/labels';
import { roundText } from '../src/plans/plans';
import type { DocumentView } from '../src/types';

function plan(round: number, maxRounds?: number): DocumentView {
  const doc = { path: 'redaccion/planes/login.md', kind: 'plan', slug: 'login', title: 'Login', status: 'revision', round, score: null } as DocumentView;
  return maxRounds === undefined ? doc : { ...doc, maxRounds };
}

describe('round over the cap', () => {
  afterEach(() => applyLang('es'));

  test('hasMaxRounds is false for a document from an older hub or recording', () => {
    expect(hasMaxRounds(plan(2, 4))).toBe(true);
    expect(hasMaxRounds(plan(2))).toBe(false);
  });

  test('the status and the plans row show N/M, or the bare round without maxRounds', () => {
    applyLang('en');
    expect(documentStatusText(plan(2, 4))).toBe('In review · round 2/4');
    expect(documentStatusText(plan(2))).toBe('In review · round 2');
    expect(roundText(plan(2, 4))).toBe('2 rounds of 4');
    expect(roundText(plan(1))).toBe('1 round');
  });
});
