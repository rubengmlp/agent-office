import { afterAll, describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { deliver, encodeInbox, orderText } from '../src/courier';
import { tempDir } from './helpers';

describe('courier', () => {
  const { dir, cleanup } = tempDir('ao-');
  afterAll(cleanup);

  test('delivers the auth line and then the user message, one JSON per line', async () => {
    const socketPath = join(dir, 'inbox.sock');
    let received = '';
    const server = createServer((conn) => {
      conn.on('data', (chunk) => {
        received += chunk.toString();
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    await deliver(socketPath, encodeInbox('tok-1', 'hola'));
    await Bun.sleep(20);
    server.close();
    const lines = received.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { type: 'auth', token: 'tok-1' },
      { type: 'user', message: { role: 'user', content: 'hola' } },
    ]);
  });

  test('without a token only the message line is sent', () => {
    expect(encodeInbox(null, 'x').trim().split('\n')).toHaveLength(1);
  });

  test('fails when nothing listens on the socket', async () => {
    await expect(deliver(join(dir, 'missing.sock'), 'x')).rejects.toThrow();
  });

  test('orders carry the panel prefix', () => {
    expect(orderText('  Prioriza el login  ')).toBe('[Agent Office] Orden del usuario desde el panel de la oficina: Prioriza el login');
  });
});
