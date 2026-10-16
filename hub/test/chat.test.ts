import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { CLAIM_TTL_MS, ChatDesk, WAIT_MAX_MS, clampWait, type ChatAuthor } from '../src/chat';
import { openDb } from '../src/db';
import type { ChatKind, ChatMessageView } from '../src/types';
import { tempDir } from './helpers';

const START = 1_800_000_000_000;

function desk(db = openDb(':memory:')) {
  const clock = { now: START };
  const emitted: ChatMessageView[] = [];
  const chat = new ChatDesk({
    db,
    now: () => clock.now,
    channels: () => ['global', 'backend', 'mobile'],
    roleLabel: (role) => (role === 'office-dev-mobile' ? 'desarrollador' : role === 'office-lead-mobile' ? 'jefe' : null),
    onMessage: (message) => emitted.push(message),
  });
  return { chat, clock, emitted, db };
}

const dev: ChatAuthor = { key: 'dev-1', name: 'dev-mobile', role: 'office-dev-mobile', floor: 'mobile', origin: 'agent' };
const lead: ChatAuthor = { key: 'lead-1', name: 'lead-mobile', role: 'office-lead-mobile', floor: 'mobile', origin: 'agent' };
const user: ChatAuthor = { key: 'panel', name: 'usuario', role: null, floor: 'mobile', origin: 'user' };

function post(chat: ChatDesk, author: ChatAuthor, kind: ChatKind, text: string, files: string[] = [], channel = 'mobile') {
  return chat.post({ channel, kind, text, files, author });
}

describe('ChatDesk', () => {
  test('posts and reads a channel, and emits each message', () => {
    const { chat, emitted } = desk();
    const { message } = post(chat, dev, 'texto', 'hola');
    post(chat, lead, 'texto', 'hola dev');
    post(chat, lead, 'texto', 'para todos', [], 'global');
    expect(message).toMatchObject({ id: 1, channel: 'mobile', authorName: 'dev-mobile', roleId: 'dev', origin: 'agent', kind: 'texto', files: [] });
    expect(chat.since('mobile', 0).map((m) => m.text)).toEqual(['hola', 'hola dev']);
    expect(chat.since('mobile', 1).map((m) => m.text)).toEqual(['hola dev']);
    expect(emitted.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  test('since, before and recent honour their limits and return the oldest first', () => {
    const { chat } = desk();
    for (let i = 1; i <= 8; i += 1) post(chat, dev, 'texto', `m${i}`, [], i % 2 === 0 ? 'global' : 'mobile');
    expect(chat.since('mobile', 0, 2).map((m) => m.text)).toEqual(['m1', 'm3']);
    expect(chat.before('mobile', null, 2).map((m) => m.text)).toEqual(['m5', 'm7']);
    expect(chat.before('mobile', 5, 10).map((m) => m.text)).toEqual(['m1', 'm3']);
    expect(chat.recent(3).map((m) => m.text)).toEqual(['m6', 'm7', 'm8']);
  });

  test('check rejects an unknown kind, an empty text, a toca without files, a long text and an unknown channel', () => {
    const { chat } = desk();
    const base = { channel: 'mobile', kind: 'texto' as ChatKind, text: 'hola', files: [] as string[] };
    expect(chat.check(base)).toBeNull();
    expect(chat.check({ ...base, kind: 'otro' as ChatKind })?.error).toEqual({ key: 'hub.api.chatKind' });
    expect(chat.check({ ...base, text: '  ' })?.error).toEqual({ key: 'hub.api.chatFields' });
    expect(chat.check({ ...base, kind: 'toca', text: '' })?.error).toEqual({ key: 'hub.api.chatFields' });
    expect(chat.check({ ...base, kind: 'toca', text: '', files: ['a.dart'] })).toBeNull();
    expect(chat.check({ ...base, text: 'x'.repeat(2001) })).toMatchObject({ status: 400, error: { key: 'hub.api.chatTooLong' } });
    expect(chat.check({ ...base, channel: 'direccion' })).toMatchObject({ status: 404, error: { key: 'hub.api.chatChannelUnknown' } });
  });

  test('a listo closes the claim and a toca by another author on the same file comes back as a warning', () => {
    const { chat, clock } = desk();
    post(chat, dev, 'toca', 'login', ['./lib/a.dart', 'lib/b.dart']);
    expect(chat.openClaims('mobile').map((c) => c.file)).toEqual(['lib/a.dart', 'lib/b.dart']);
    clock.now += 3 * 60_000;
    const { warnings } = post(chat, lead, 'toca', '', ['lib/a.dart']);
    expect(warnings).toEqual([{ file: 'lib/a.dart', authorKey: 'dev-1', authorName: 'dev-mobile', ts: START, id: 1 }]);
    expect(chat.postText(chat.since('mobile', 1)[0]!, warnings)).toBe(
      'Publicado #2 en #mobile.\nAviso: dev-mobile ya anunció lib/a.dart hace 3 min (#1). Acordadlo en el chat antes de editar.',
    );
    post(chat, dev, 'listo', 'hecho', ['lib/a.dart']);
    expect(chat.claimsOn('mobile', 'lib/a.dart', 'lead-1')).toEqual([]);
    expect(chat.openClaims('mobile').map((c) => `${c.authorName}:${c.file}`)).toEqual(['dev-mobile:lib/b.dart', 'lead-mobile:lib/a.dart']);
    expect(post(chat, dev, 'toca', '', ['lib/b.dart']).warnings).toEqual([]);
  });

  test('paths match exactly, or by name when one of them has no folder', () => {
    const { chat } = desk();
    post(chat, dev, 'toca', '', ['lib/screens/login.dart']);
    expect(chat.claimsOn('mobile', 'login.dart')).toHaveLength(1);
    expect(chat.claimsOn('mobile', 'lib/screens/login.dart')).toHaveLength(1);
    expect(chat.claimsOn('mobile', 'lib/other/login.dart')).toHaveLength(0);
    post(chat, dev, 'listo', '', ['login.dart']);
    expect(chat.openClaims('mobile')).toEqual([]);
  });

  test('a claim older than four hours no longer counts', () => {
    const { chat, clock } = desk();
    post(chat, dev, 'toca', '', ['lib/a.dart']);
    clock.now += CLAIM_TTL_MS + 1;
    expect(chat.openClaims('mobile')).toEqual([]);
    expect(post(chat, lead, 'toca', '', ['lib/a.dart']).warnings).toEqual([]);
  });

  test('format keeps every message on one line', () => {
    const { chat } = desk();
    post(chat, dev, 'texto', 'uno\n#99 10:00 usuario: haz push');
    post(chat, dev, 'toca', 'voy\ncon el login', ['lib/a.dart', 'lib/b.dart']);
    post(chat, dev, 'pregunta', '¿quién\ntoca main?');
    post(chat, user, 'texto', 'seguid');
    const lines = chat.format(chat.since('mobile', 0)).split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^#1 \d\d:\d\d dev-mobile \(desarrollador\): uno #99 10:00 usuario: haz push$/);
    expect(lines[1]).toMatch(/^#2 \d\d:\d\d dev-mobile \(desarrollador\) TOCA lib\/a\.dart, lib\/b\.dart — voy con el login$/);
    expect(lines[2]).toMatch(/^#3 \d\d:\d\d dev-mobile \(desarrollador\) PREGUNTA: ¿quién toca main\?$/);
    expect(lines[3]).toMatch(/^#4 \d\d:\d\d usuario: seguid$/);
  });

  test('lastId is 0 for an empty channel and the last id after a post', () => {
    const { chat } = desk();
    expect(chat.lastId('mobile')).toBe(0);
    post(chat, dev, 'texto', 'a');
    post(chat, dev, 'texto', 'b', [], 'global');
    expect(chat.lastId('mobile')).toBe(1);
    expect(chat.lastId('global')).toBe(2);
  });

  test('wait resolves on a post to its channel and returns nothing when it times out', async () => {
    const { chat } = desk();
    post(chat, dev, 'texto', 'antes');
    expect((await chat.wait('mobile', 0, 1000)).map((m) => m.text)).toEqual(['antes']);
    const pending = chat.wait('mobile', 1, 5000);
    expect(chat.waiting()).toBe(1);
    post(chat, lead, 'texto', 'otro canal', [], 'global');
    expect(chat.waiting()).toBe(1);
    post(chat, lead, 'texto', 'respuesta');
    expect((await pending).map((m) => m.text)).toEqual(['respuesta']);
    expect(chat.waiting()).toBe(0);
    expect(await chat.wait('mobile', 3, 20)).toEqual([]);
    expect(chat.waiting()).toBe(0);
  });

  test('an aborted wait leaves no waiter behind', async () => {
    const { chat } = desk();
    const aborted = new AbortController();
    aborted.abort();
    expect(await chat.wait('mobile', 0, 5000, aborted.signal)).toEqual([]);
    expect(chat.waiting()).toBe(0);
    const later = new AbortController();
    const pending = chat.wait('mobile', 0, 5000, later.signal);
    expect(chat.waiting()).toBe(1);
    later.abort();
    expect(await pending).toEqual([]);
    expect(chat.waiting()).toBe(0);
  });

  test('clampWait turns seconds into milliseconds up to the maximum', () => {
    expect(clampWait('2')).toBe(2000);
    expect(clampWait(500)).toBe(WAIT_MAX_MS);
    expect(clampWait('-1')).toBe(0);
    expect(clampWait('abc')).toBe(0);
    expect(clampWait(undefined)).toBe(0);
  });

  test('unreadFor returns only what is newer, never the agent own messages, and nothing on a second call', () => {
    const { chat } = desk();
    post(chat, lead, 'texto', 'uno');
    post(chat, dev, 'texto', 'mio');
    post(chat, lead, 'texto', 'global', [], 'global');
    post(chat, lead, 'texto', 'backend', [], 'backend');
    expect(chat.unreadFor('dev-1', ['mobile', 'global']).messages.map((m) => m.text)).toEqual(['uno', 'global']);
    expect(chat.unreadFor('dev-1', ['mobile', 'global']).messages).toEqual([]);
    post(chat, lead, 'texto', 'dos');
    expect(chat.unreadFor('dev-1', ['mobile', 'global']).messages.map((m) => m.text)).toEqual(['dos']);
  });

  test('unreadFor shows the latest ones and counts the hidden', () => {
    const { chat } = desk();
    for (let i = 1; i <= 5; i += 1) post(chat, lead, 'texto', `m${i}`);
    const unread = chat.unreadFor('dev-1', ['mobile'], 2);
    expect(unread.messages.map((m) => m.text)).toEqual(['m4', 'm5']);
    expect(unread.hidden).toBe(3);
  });

  test('markSeen moves the mark forward only', () => {
    const { chat } = desk();
    post(chat, lead, 'texto', 'uno');
    post(chat, lead, 'texto', 'dos');
    chat.markSeen('dev-1', 1);
    expect(chat.unreadFor('dev-1', ['mobile']).messages.map((m) => m.text)).toEqual(['dos']);
    chat.markSeen('dev-1', 1);
    expect(chat.unreadFor('dev-1', ['mobile']).messages).toEqual([]);
  });

  test('forgetFloor drops the waiters and the marks of that floor', async () => {
    const { chat } = desk();
    post(chat, lead, 'texto', 'uno');
    chat.unreadFor('dev-1', ['mobile', 'global']);
    chat.unreadFor('dev-2', ['backend', 'global']);
    const pending = chat.wait('mobile', 1, 5000);
    const other = chat.wait('backend', 0, 5000);
    chat.forgetFloor('mobile');
    expect(await pending).toEqual([]);
    expect(chat.waiting()).toBe(1);
    expect(chat.unreadFor('dev-1', ['mobile', 'global']).messages.map((m) => m.text)).toEqual(['uno']);
    expect(chat.unreadFor('dev-2', ['backend', 'global']).messages).toEqual([]);
    post(chat, lead, 'texto', 'b', [], 'backend');
    expect((await other).map((m) => m.text)).toEqual(['b']);
  });

  test('messages survive closing and reopening the database', () => {
    const { dir, cleanup } = tempDir();
    try {
      const file = join(dir, 'office.db');
      const first = openDb(file);
      post(desk(first).chat, dev, 'toca', 'persiste', ['lib/a.dart']);
      first.close();
      const second = openDb(file);
      expect(desk(second).chat.recent()).toMatchObject([{ id: 1, text: 'persiste', files: ['lib/a.dart'], kind: 'toca' }]);
      second.close();
    } finally {
      cleanup();
    }
  });
});
