import { describe, expect, test } from 'bun:test';
import type { ChatKind, ChatMessageView } from '../types';
import { CLAIM_TTL_MS, openClaims } from './claims';

const NOW = 1_800_000_000_000;

function message(id: number, author: string, kind: ChatKind, files: string[], ts = NOW - 60_000): ChatMessageView {
  return {
    id,
    ts,
    channel: 'mobile',
    floor: 'mobile',
    authorKey: author,
    authorName: author,
    role: 'office-dev-mobile',
    roleId: 'dev',
    origin: 'agent',
    kind,
    text: '',
    files,
  };
}

describe('openClaims', () => {
  test('a toca stays open until the same author says listo', () => {
    const claimed = [message(1, 'dev-1', 'toca', ['lib/a.dart', 'lib/b.dart'])];
    expect(openClaims(claimed, NOW).map((c) => c.file)).toEqual(['lib/a.dart', 'lib/b.dart']);
    const released = [...claimed, message(2, 'dev-1', 'listo', ['lib/a.dart'])];
    expect(openClaims(released, NOW).map((c) => c.file)).toEqual(['lib/b.dart']);
  });

  test('a listo of another author does not close the claim', () => {
    const messages = [message(1, 'dev-1', 'toca', ['lib/a.dart']), message(2, 'dev-2', 'listo', ['lib/a.dart'])];
    expect(openClaims(messages, NOW)).toEqual([{ file: 'lib/a.dart', authorKey: 'dev-1', authorName: 'dev-1', ts: NOW - 60_000, id: 1 }]);
  });

  test('a listo by file name closes a claim with its folder', () => {
    const messages = [message(1, 'dev-1', 'toca', ['lib/screens/login.dart']), message(2, 'dev-1', 'listo', ['login.dart'])];
    expect(openClaims(messages, NOW)).toEqual([]);
  });

  test('a claim older than four hours has expired', () => {
    const messages = [message(1, 'dev-1', 'toca', ['lib/a.dart'], NOW - CLAIM_TTL_MS - 1), message(2, 'dev-2', 'texto', [])];
    expect(openClaims(messages, NOW)).toEqual([]);
  });
});
