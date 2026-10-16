import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { managedFloors } from './agents';
import { GLOBAL_CHANNEL, READ_LIMIT, USER_NAME, isChatKind, normalizeChatPath, type ChatAuthor, type ChatDesk, type ChatError, type ChatUnread } from './chat';
import { chatInboxText, encodeInbox, type deliver } from './courier';
import { DIRECCION, isInside, realPath, type FloorResolver } from './floors';
import type { OfficeBus } from './office-bus';
import type { SessionRuntime } from './office-state';
import { isLeadRole } from './scope';
import { keyMatches } from './security';
import type { SessionBook } from './session-book';
import { short } from './state-machine';
import type { ChatMessageView, ChatPostRequest, ChatPostResult, ChatUserResult, HookMeta, HubText, OfficeConfig } from './types';

export type ChatRoomOpts = {
  bus: OfficeBus;
  book: SessionBook;
  chat: ChatDesk;
  config: () => OfficeConfig;
  floors: FloorResolver;
  deliver: typeof deliver;
  lines: (unread: ChatUnread, channel: string) => string | null;
  // A dev announces files are theirs no more, from this folder.
  listo: (cwd: string, floor: string) => void;
};

export type UserChatResult = ({ ok: true } & ChatUserResult) | Extract<ChatPostResult, { ok: false }>;

export type ReadChatResult = { afterId: number | null; messages: ChatMessageView[] } | 'no-channel';

export class ChatRoom {
  constructor(private readonly opts: ChatRoomOpts) {}

  postChat(raw: ChatPostRequest, meta: HookMeta): ChatPostResult {
    const kind = raw.kind ?? 'texto';
    if (!isChatKind(kind)) return { ok: false, status: 400, error: { key: 'hub.api.chatKind' } };
    const found = this.chatAuthor(raw, meta);
    if ('error' in found) return { ok: false, ...found };
    const { author, root, cwd } = found;
    const channel = raw.channel?.trim() || author.floor;
    // Paths are relative to the root of the floor, as fileLabel shows them, wherever the script ran from.
    const files = (raw.files ?? []).map((file) => {
      const abs = realPath(resolve(cwd, file));
      return abs !== root && isInside(abs, root) ? relative(root, abs) : normalizeChatPath(file);
    });
    const input = { channel, kind, text: raw.text ?? '', files };
    const error = this.opts.chat.check(input);
    if (error) return { ok: false, ...error };
    if (channel !== GLOBAL_CHANNEL && channel !== author.floor) return { ok: false, status: 403, error: { key: 'hub.api.chatChannelForbidden' } };
    const { message, warnings } = this.opts.chat.post({ ...input, author });
    this.chatActivity(message);
    if (kind === 'listo' && cwd) this.opts.listo(cwd, author.floor);
    return { ok: true, message, warnings };
  }

  // The user writes from the panel: the message goes to the channel and, through the inbox, to the leads that
  // read it, after the lines of their team they had not seen yet.
  async userChat(channel: string, body: string): Promise<UserChatResult> {
    const input = { channel, kind: 'texto' as const, text: body, files: [] };
    const error = this.opts.chat.check(input);
    if (error) return { ok: false, ...error };
    const author: ChatAuthor = { key: 'panel', name: USER_NAME, role: null, floor: channel === GLOBAL_CHANNEL ? DIRECCION : channel, origin: 'user' };
    const { message } = this.opts.chat.post({ ...input, author });
    this.chatActivity(message);
    let delivered = 0;
    for (const session of this.chatLeads(channel)) {
      if (!session.socket || !existsSync(session.socket)) continue;
      const channels = [session.floor, GLOBAL_CHANNEL];
      const pending = this.opts.chat.unread(session.sessionId, channels);
      const lines = this.opts.lines({ messages: pending.messages.filter((m) => m.id !== message.id), hidden: pending.hidden }, session.floor) ?? '';
      // Seen before the delivery: the turn it starts may reach the hub before deliver returns, and must not get
      // these lines again. If it fails, the lead has not seen them.
      const before = this.opts.chat.seenMark(session.sessionId);
      this.opts.chat.markSeen(session.sessionId, pending.last, channels);
      try {
        await this.opts.deliver(session.socket, encodeInbox(session.token, chatInboxText(channel, lines, message.text)));
      } catch {
        this.opts.chat.restoreSeen(session.sessionId, before);
        continue;
      }
      delivered += 1;
    }
    return { ok: true, message, delivered };
  }

  async readChat(channel: string, afterId: number | null, waitMs: number, signal?: AbortSignal): Promise<ReadChatResult> {
    if (!this.opts.chat.isChannel(channel)) return 'no-channel';
    if (waitMs > 0) {
      // Without desde, waiting means waiting for what comes next, not getting the latest ones at once.
      const after = afterId ?? this.opts.chat.lastId(channel);
      return { afterId: after, messages: await this.opts.chat.wait(channel, after, waitMs, signal) };
    }
    if (afterId === null) return { afterId: null, messages: this.opts.chat.before(channel, null, READ_LIMIT) };
    return { afterId, messages: this.opts.chat.since(channel, afterId) };
  }

  chatHistory(channel: string, beforeId: number | null): ChatMessageView[] | 'no-channel' {
    if (!this.opts.chat.isChannel(channel)) return 'no-channel';
    return this.opts.chat.before(channel, beforeId);
  }

  // The script is not a hook and brings no agent_id: the floor comes from its folder. Who signs comes from the
  // token of the session (X-Office-Token, the one the launcher gives every process of it): --de may name that
  // session or one of its agents and nobody else. A script that brings no token signs with the name it
  // declares, and cannot use --de.
  private chatAuthor(raw: ChatPostRequest, meta: HookMeta): { author: ChatAuthor; root: string; cwd: string } | ChatError {
    const cwd = raw.cwd?.trim();
    const root = cwd ? this.opts.floors.rootOf(realPath(cwd)) : null;
    const slug = root ? managedFloors(this.opts.config()).find(([, floor]) => realPath(floor.path) === root)?.[0] : undefined;
    if (!cwd || !root || !slug) return { status: 404, error: { key: 'hub.api.chatFloorUnknown' } };
    const from = raw.from?.trim() || null;
    const unknown: ChatError = { status: 403, error: { key: 'hub.api.chatSessionUnknown' } };
    if (meta.token) {
      const caller = this.liveSessionWithToken(meta.token, slug);
      if (!caller) return unknown;
      const sessionAuthor = (name: string): ChatAuthor => ({
        key: caller.sessionId,
        name,
        role: caller.role ?? this.opts.book.agents.get(caller.sessionId)?.role ?? null,
        floor: slug,
        origin: 'agent',
      });
      if (!from || from === caller.name) {
        const name = caller.name ?? meta.name;
        return name && name !== USER_NAME ? { author: sessionAuthor(name), root, cwd } : { status: 404, error: { key: 'hub.api.chatAuthorUnknown' } };
      }
      const agent = [...this.opts.book.agents.values()]
        .filter((a) => a.sessionId === caller.sessionId && a.name === from && a.endedAt === null && !this.opts.book.isRetired(a))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (!agent || from === USER_NAME) return unknown;
      return { author: { key: agent.key, name: from, role: agent.role, floor: slug, origin: 'agent' }, root, cwd };
    }
    if (from) return unknown;
    const name = meta.name;
    if (name && name !== USER_NAME) {
      const agent = [...this.opts.book.agents.values()]
        .filter((a) => a.name === name && a.floor === slug && a.endedAt === null && !this.opts.book.isRetired(a))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (agent) return { author: { key: agent.key, name, role: agent.role, floor: slug, origin: 'agent' }, root, cwd };
      const session = this.liveSessionNamed(name, slug);
      if (session) {
        const role = session.role ?? this.opts.book.agents.get(session.sessionId)?.role ?? null;
        return { author: { key: session.sessionId, name, role, floor: slug, origin: 'agent' }, root, cwd };
      }
    }
    return { status: 404, error: { key: 'hub.api.chatAuthorUnknown' } };
  }

  private liveSessionWithToken(token: string, slug: string): SessionRuntime | null {
    return [...this.opts.book.sessions.values()].find((s) => keyMatches(token, s.token ?? '') && s.floor === slug && s.endedAt === null) ?? null;
  }

  private liveSessionNamed(name: string, slug: string): SessionRuntime | null {
    return (
      [...this.opts.book.sessions.values()].filter((s) => s.name === name && s.floor === slug && s.endedAt === null).sort((a, b) => b.updatedAt - a.updatedAt)[0] ??
      null
    );
  }

  // Live leads of managed floors that read the channel: the floor's own, or all of them for #global.
  private chatLeads(channel: string): SessionRuntime[] {
    return [...this.opts.book.sessions.values()].filter((session) => {
      if (session.endedAt !== null || session.floorKind !== 'managed') return false;
      if (!isLeadRole(session.role ?? this.opts.book.agents.get(session.sessionId)?.role ?? null)) return false;
      return channel === GLOBAL_CHANNEL || session.floor === channel;
    });
  }

  private chatActivity(message: ChatMessageView): void {
    const base = { who: message.authorName, channel: message.channel };
    const files = message.files.join(', ');
    const summary: HubText =
      message.origin === 'user'
        ? { key: 'hub.act.chatUser', params: { channel: message.channel, text: short(message.text, 60) } }
        : message.kind === 'toca'
          ? { key: 'hub.act.chatClaim', params: { ...base, files } }
          : message.kind === 'listo'
            ? { key: 'hub.act.chatRelease', params: { ...base, files } }
            : { key: 'hub.act.chatPost', params: { ...base, text: short(message.text, 60) } };
    this.opts.bus.pushActivity({ ts: message.ts, agentKey: message.authorKey, event: 'Chat', tool: null, state: null, summary });
  }
}
