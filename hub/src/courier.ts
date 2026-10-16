import { createConnection } from 'node:net';

export const ORDER_PREFIX = '[Agent Office]';

export const ORDER_LEAD = `${ORDER_PREFIX} Orden del usuario desde el panel de la oficina:`;

export function orderText(text: string): string {
  return `${ORDER_LEAD} ${text.trim()}`;
}

export function encodeInbox(token: string | null, content: string): string {
  const lines: string[] = [];
  if (token) lines.push(JSON.stringify({ type: 'auth', token }));
  lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content } }));
  return `${lines.join('\n')}\n`;
}

export function deliver(socketPath: string, payload: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      socket.destroy();
      finish(new Error('tiempo de espera agotado'));
    }, timeoutMs);
    socket.on('connect', () => socket.end(payload));
    socket.on('error', (error) => finish(error));
    socket.on('close', (hadError) => {
      if (!hadError) finish();
    });
  });
}
