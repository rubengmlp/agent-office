import type { Database } from 'bun:sqlite';
import { basename, posix } from 'node:path';
import { roleIdOf } from './scope';
import type { ChatClaimView, ChatKind, ChatMessageView, ChatOrigin, HubText, HubTextKey } from './types';

export const GLOBAL_CHANNEL = 'global';
// The name the user writes under; no agent may take it, so a line of an agent never reads as the user's.
export const USER_NAME = 'usuario';
export const MAX_CHAT_TEXT = 2000;
export const MAX_FILES = 40;
export const SNAPSHOT_LIMIT = 200;
export const READ_LIMIT = 50;
export const HISTORY_LIMIT = 100;
export const INJECT_LIMIT = 20;
export const WAIT_MAX_MS = 90_000;
export const CLAIM_TTL_MS = 4 * 3_600_000;
export const CHAT_KINDS: readonly ChatKind[] = ['texto', 'toca', 'listo', 'pregunta'];

export type ChatDeps = {
  db: Database;
  now: () => number;
  channels: () => string[];
  roleLabel: (role: string | null) => string | null;
  onMessage: (message: ChatMessageView) => void;
};

export type ChatAuthor = { key: string; name: string; role: string | null; floor: string; origin: ChatOrigin };

export type ChatInput = { channel: string; kind: ChatKind; text: string; files: string[]; author: ChatAuthor };

export type ChatError = { status: 400 | 403 | 404; error: HubText };

export type ChatUnread = { messages: ChatMessageView[]; hidden: number };

type ChatRow = {
  id: number;
  ts: number;
  channel: string;
  floor: string;
  author_key: string;
  author_name: string;
  role: string | null;
  origin: string;
  kind: string;
  text: string;
  files: string;
};

type Waiter = { channel: string; afterId: number; resolve: (messages: ChatMessageView[]) => void; timer: ReturnType<typeof setTimeout> };

export function isChatKind(value: unknown): value is ChatKind {
  return typeof value === 'string' && (CHAT_KINDS as readonly string[]).includes(value);
}

// Seconds the agent asked to wait, as milliseconds within 0..WAIT_MAX_MS.
export function clampWait(seconds: unknown): number {
  const n = typeof seconds === 'string' ? Number(seconds) : seconds;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 0;
  return Math.min(WAIT_MAX_MS, Math.floor(n * 1000));
}

// A path with a line break could fake a line of the chat in the agents' context: check refuses it.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function normalizeChatPath(file: string): string {
  const clean = posix.normalize(file.trim().replace(/\\/g, '/'));
  return clean.replace(/^(\.\/)+/, '');
}

// Same file when the paths are equal, or when one of them has no folder and the names match.
export function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes('/') && b.includes('/')) return false;
  return basename(a) === basename(b);
}

function parseFiles(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function toView(row: ChatRow): ChatMessageView {
  return {
    id: row.id,
    ts: row.ts,
    channel: row.channel,
    floor: row.floor,
    authorKey: row.author_key,
    authorName: row.author_name,
    role: row.role,
    roleId: roleIdOf(row.role),
    origin: row.origin === 'user' ? 'user' : 'agent',
    kind: isChatKind(row.kind) ? row.kind : 'texto',
    text: row.text,
    files: parseFiles(row.files),
  };
}

function clock(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const ERROR_TEXTS: Partial<Record<HubTextKey, string>> = {
  'hub.api.chatFields': 'falta el canal, el texto o las rutas del mensaje.',
  'hub.api.chatTooLong': `el mensaje es demasiado largo (máximo ${MAX_CHAT_TEXT} caracteres y ${MAX_FILES} rutas).`,
  'hub.api.chatKind': 'tipo de mensaje desconocido: usa di, toca, listo o pregunta.',
  'hub.api.chatAuthorUnknown': 'no hay ningún agente vivo con ese nombre en la planta; revisa --de.',
  'hub.api.chatFloorUnknown': 'esta carpeta no es de ninguna planta gestionada; ejecuta el script desde el repositorio de tu planta.',
  'hub.api.chatChannelUnknown': 'ese canal no existe; usa el slug de tu planta o global.',
  'hub.api.chatChannelForbidden': 'solo puedes escribir en el canal de tu planta o en #global.',
  'hub.api.chatSessionUnknown': 'la sesión que ejecuta el script no está abierta en esta planta o no se identifica con su token; --de solo vale para compañeros de tu propio equipo.',
};

// Text for the agent that called the script, in the language of the templates; the panel gets the HubText.
export function errorTextFor(error: HubText): string {
  if (typeof error === 'string') return error;
  return ERROR_TEXTS[error.key] ?? error.key;
}

export class ChatDesk {
  private readonly waiters = new Set<Waiter>();
  private readonly seen = new Map<string, { id: number; channels: string[] }>();

  constructor(private readonly deps: ChatDeps) {}

  channels(): string[] {
    return this.deps.channels();
  }

  isChannel(id: string): boolean {
    return this.channels().includes(id);
  }

  check(input: Omit<ChatInput, 'author'>): ChatError | null {
    if (!isChatKind(input.kind)) return { status: 400, error: { key: 'hub.api.chatKind' } };
    const claims = input.kind === 'toca' || input.kind === 'listo';
    if (!input.channel || (claims ? input.files.length === 0 : !input.text.trim())) return { status: 400, error: { key: 'hub.api.chatFields' } };
    if (input.text.length > MAX_CHAT_TEXT || input.files.length > MAX_FILES) return { status: 400, error: { key: 'hub.api.chatTooLong' } };
    if (input.files.some((file) => CONTROL_CHARS.test(file))) return { status: 400, error: { key: 'hub.api.chatFields' } };
    if (!this.isChannel(input.channel)) return { status: 404, error: { key: 'hub.api.chatChannelUnknown' } };
    return null;
  }

  post(input: ChatInput): { message: ChatMessageView; warnings: ChatClaimView[] } {
    const files = input.kind === 'toca' || input.kind === 'listo' ? [...new Set(input.files.map(normalizeChatPath).filter(Boolean))] : [];
    const warnings: ChatClaimView[] = [];
    if (input.kind === 'toca') {
      const seen = new Set<string>();
      for (const file of files) {
        for (const claim of this.claimsOn(input.channel, file, input.author.key)) {
          const id = `${claim.id}|${claim.file}`;
          if (seen.has(id)) continue;
          seen.add(id);
          warnings.push(claim);
        }
      }
    }
    const { author } = input;
    const inserted = this.deps.db
      .query(
        `INSERT INTO chat_messages (ts, channel, floor, author_key, author_name, role, origin, kind, text, files)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(this.deps.now(), input.channel, author.floor, author.key, author.name, author.role, author.origin, input.kind, input.text.trim(), JSON.stringify(files));
    const row = this.deps.db.query<ChatRow, [number]>('SELECT * FROM chat_messages WHERE id = ?').get(Number(inserted.lastInsertRowid));
    if (!row) throw new Error('chat_messages: la fila recién insertada no existe');
    const message = toView(row);
    this.deps.onMessage(message);
    this.wake(message.channel);
    return { message, warnings };
  }

  since(channel: string, afterId: number, limit = READ_LIMIT): ChatMessageView[] {
    return this.deps.db
      .query<ChatRow, [string, number, number]>('SELECT * FROM chat_messages WHERE channel = ? AND id > ? ORDER BY id ASC LIMIT ?')
      .all(channel, afterId, limit)
      .map(toView);
  }

  // Oldest first: the page of messages right before beforeId, or the latest ones without it.
  before(channel: string, beforeId: number | null, limit = HISTORY_LIMIT): ChatMessageView[] {
    return this.deps.db
      .query<ChatRow, [string, number, number]>('SELECT * FROM chat_messages WHERE channel = ? AND id < ? ORDER BY id DESC LIMIT ?')
      .all(channel, beforeId ?? Number.MAX_SAFE_INTEGER, limit)
      .map(toView)
      .reverse();
  }

  recent(limit = SNAPSHOT_LIMIT): ChatMessageView[] {
    return this.deps.db
      .query<ChatRow, [number]>('SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?')
      .all(limit)
      .map(toView)
      .reverse();
  }

  lastId(channel: string): number {
    return this.deps.db.query<{ id: number | null }, [string]>('SELECT MAX(id) AS id FROM chat_messages WHERE channel = ?').get(channel)?.id ?? 0;
  }

  wait(channel: string, afterId: number, timeoutMs: number, signal?: AbortSignal): Promise<ChatMessageView[]> {
    const ready = this.since(channel, afterId);
    if (ready.length > 0 || timeoutMs <= 0 || signal?.aborted) return Promise.resolve(ready);
    return new Promise((resolve) => {
      const waiter: Waiter = {
        channel,
        afterId,
        resolve: (messages) => {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          resolve(messages);
        },
        timer: setTimeout(() => waiter.resolve([]), Math.min(timeoutMs, WAIT_MAX_MS)),
      };
      this.waiters.add(waiter);
      signal?.addEventListener('abort', () => waiter.resolve([]), { once: true });
    });
  }

  waiting(): number {
    return this.waiters.size;
  }

  // A file is claimed by an author while their last toca naming it is newer than their last listo naming it,
  // and younger than CLAIM_TTL_MS. Read from SQLite on demand: nothing is kept in memory.
  openClaims(channel: string): ChatClaimView[] {
    const rows = this.deps.db
      .query<ChatRow, [string, number]>("SELECT * FROM chat_messages WHERE channel = ? AND kind IN ('toca', 'listo') AND ts >= ? ORDER BY id ASC")
      .all(channel, this.deps.now() - CLAIM_TTL_MS);
    let open: ChatClaimView[] = [];
    for (const row of rows) {
      const files = parseFiles(row.files);
      open = open.filter((claim) => claim.authorKey !== row.author_key || !files.some((file) => samePath(file, claim.file)));
      if (row.kind !== 'toca') continue;
      for (const file of files) open.push({ file, authorKey: row.author_key, authorName: row.author_name, ts: row.ts, id: row.id });
    }
    return open;
  }

  claimsOn(channel: string, file: string, exceptAuthor?: string): ChatClaimView[] {
    const target = normalizeChatPath(file);
    return this.openClaims(channel).filter((claim) => claim.authorKey !== exceptAuthor && samePath(claim.file, target));
  }

  // Messages of these channels the agent has not been shown yet, without its own; marks them seen.
  unreadFor(agentKey: string, channels: string[], limit = INJECT_LIMIT): ChatUnread {
    const unread = this.unread(agentKey, channels, limit);
    this.markSeen(agentKey, unread.last, channels);
    return { messages: unread.messages, hidden: unread.hidden };
  }

  // The same without marking them: last is the id to mark once they reached the agent.
  unread(agentKey: string, channels: string[], limit = INJECT_LIMIT): ChatUnread & { last: number } {
    const after = this.seen.get(agentKey)?.id ?? 0;
    if (channels.length === 0) return { messages: [], hidden: 0, last: after };
    const marks = channels.map(() => '?').join(', ');
    const where = `channel IN (${marks}) AND id > ? AND author_key != ?`;
    const rows = this.deps.db
      .query<ChatRow, (string | number)[]>(`SELECT * FROM chat_messages WHERE ${where} ORDER BY id DESC LIMIT ?`)
      .all(...channels, after, agentKey, limit);
    const total = this.deps.db.query<{ n: number }, (string | number)[]>(`SELECT COUNT(*) AS n FROM chat_messages WHERE ${where}`).get(...channels, after, agentKey)?.n ?? 0;
    const last = this.deps.db
      .query<{ id: number | null }, string[]>(`SELECT MAX(id) AS id FROM chat_messages WHERE channel IN (${marks})`)
      .get(...channels)?.id ?? 0;
    return { messages: rows.map(toView).reverse(), hidden: Math.max(0, total - rows.length), last: Math.max(after, last) };
  }

  markSeen(agentKey: string, id: number, channels: string[] = []): void {
    const current = this.seen.get(agentKey);
    if (current && current.id >= id && (current.channels.length > 0 || channels.length === 0)) return;
    this.seen.set(agentKey, { id: Math.max(id, current?.id ?? 0), channels: current?.channels.length ? current.channels : channels });
  }

  seenMark(agentKey: string): { id: number; channels: string[] } | undefined {
    const entry = this.seen.get(agentKey);
    return entry ? { id: entry.id, channels: [...entry.channels] } : undefined;
  }

  restoreSeen(agentKey: string, mark: { id: number; channels: string[] } | undefined): void {
    if (mark) this.seen.set(agentKey, mark);
    else this.seen.delete(agentKey);
  }

  forgetFloor(slug: string): void {
    for (const waiter of [...this.waiters]) if (waiter.channel === slug) waiter.resolve([]);
    for (const [key, entry] of this.seen) if (entry.channels.includes(slug)) this.seen.delete(key);
  }

  // One line per message for the agents' context; whitespace collapses so a message cannot fake another line.
  format(messages: readonly ChatMessageView[]): string {
    return messages.map((message) => this.line(message)).join('\n');
  }

  // The same, under a #channel: line per channel when the messages come from more than one.
  digest(messages: readonly ChatMessageView[]): string {
    const channels = [...new Set(messages.map((message) => message.channel))];
    if (channels.length <= 1) return this.format(messages);
    return channels.map((channel) => `#${channel}:\n${this.format(messages.filter((message) => message.channel === channel))}`).join('\n');
  }

  private line(message: ChatMessageView): string {
    const head = `#${message.id} ${clock(message.ts)}`;
    const text = oneLine(message.text);
    if (message.origin === 'user') return `${head} usuario: ${text}`;
    const label = this.deps.roleLabel(message.role);
    const who = label ? `${message.authorName} (${label})` : message.authorName;
    if (message.kind === 'toca' || message.kind === 'listo') {
      const files = message.files.map(oneLine).join(', ');
      return `${head} ${who} ${message.kind === 'toca' ? 'TOCA' : 'LISTO'} ${files}${text ? ` — ${text}` : ''}`;
    }
    if (message.kind === 'pregunta') return `${head} ${who} PREGUNTA: ${text}`;
    return `${head} ${who}: ${text}`;
  }

  postText(message: ChatMessageView, warnings: readonly ChatClaimView[]): string {
    const now = this.deps.now();
    const lines = [`Publicado #${message.id} en #${message.channel}.`];
    for (const claim of warnings) {
      const minutes = Math.max(0, Math.round((now - claim.ts) / 60_000));
      lines.push(`Aviso: ${claim.authorName} ya anunció ${claim.file} hace ${minutes} min (#${claim.id}). Acordadlo en el chat antes de editar.`);
    }
    return lines.join('\n');
  }

  readText(channel: string, afterId: number | null, messages: readonly ChatMessageView[]): string {
    if (messages.length > 0) return this.format(messages);
    return afterId === null ? `Sin mensajes en #${channel}.` : `Sin mensajes nuevos en #${channel} desde #${afterId}.`;
  }

  private wake(channel: string): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.channel !== channel) continue;
      const messages = this.since(channel, waiter.afterId);
      if (messages.length > 0) waiter.resolve(messages);
    }
  }
}
