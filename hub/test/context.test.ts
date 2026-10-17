import { afterEach, describe, expect, test } from 'bun:test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BIG_WINDOW, DEFAULT_WINDOW, contextOf, isCompaction, tableWindow, usedPctOf, windowFor } from '../src/context';
import { openDb } from '../src/db';
import { parseChunk, projectSlug, TokenMeter, type MeterAgent } from '../src/tokens';
import type { HookMeta, ServerMessage } from '../src/types';
import { ev, floor, harness, tempDir, type Harness } from './helpers';

const SONNET = 'claude-sonnet-5-5';
const LEAD = '22222222-bbbb-4ccc-8ddd-000000000002';
const leadMeta: HookMeta = { socket: null, token: null, role: 'office-lead-mobile', name: 'lead-mobile' };
const FRESH = { lastMsgId: null, lastOut: 0 };
const NOW = Date.parse('2026-10-16T12:30:00.000Z');

// A turn that holds `context` tokens in the window (all of it as cache read).
function turn(id: string, context: number, output = 10): string {
  return `${JSON.stringify({
    type: 'assistant',
    timestamp: '2026-10-16T12:00:00.000Z',
    message: {
      id,
      model: SONNET,
      content: [{ type: 'text', text: 'x' }],
      usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: context - 2, output_tokens: output },
    },
  })}\n`;
}

function boundary(post: number | null): string {
  return `${JSON.stringify({
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    compactMetadata: { trigger: 'auto', preTokens: 160_000, ...(post === null ? {} : { postTokens: post }) },
  })}\n`;
}

const bytes = (...lines: string[]): Buffer => Buffer.from(lines.join(''));

describe('window and context', () => {
  test('200 K by default, by table prefix, and 1 M with [1m]', () => {
    expect(tableWindow('claude-opus-5-5')).toBe(DEFAULT_WINDOW);
    expect(tableWindow('claude-haiku-4-5')).toBe(DEFAULT_WINDOW);
    expect(tableWindow('something-else')).toBe(DEFAULT_WINDOW);
    expect(tableWindow(null)).toBe(DEFAULT_WINDOW);
    expect(tableWindow('claude-opus-5-5[1m]')).toBe(BIG_WINDOW);
  });

  test('windowFor takes the biggest of the status line, the role model, the table and the tokens seen', () => {
    expect(windowFor('claude-opus-5-5')).toBe(DEFAULT_WINDOW);
    expect(windowFor('claude-opus-5-5', { reported: 1_000_000 })).toBe(BIG_WINDOW);
    expect(windowFor('claude-opus-5-5', { reported: 150_000 })).toBe(DEFAULT_WINDOW);
    expect(windowFor('claude-opus-5-5', { roleModel: 'opus[1m]' })).toBe(BIG_WINDOW);
    expect(windowFor('claude-opus-5-5', { roleModel: 'opus' })).toBe(DEFAULT_WINDOW);
    expect(windowFor('claude-opus-5-5', { observed: 200_000 })).toBe(DEFAULT_WINDOW);
    expect(windowFor('claude-opus-5-5', { observed: 200_001 })).toBe(BIG_WINDOW);
  });

  test('a turn holds what it read and cached, not what it wrote', () => {
    expect(contextOf({ input: 5, cacheRead: 100, cacheCreate: 20 })).toBe(125);
    expect(usedPctOf(50_000, 200_000)).toBe(25);
    expect(usedPctOf(500_000, 200_000)).toBe(100);
  });

  test('a compaction is a drop of more than 40 % between turns', () => {
    expect(isCompaction(150_000, 90_001)).toBe(false);
    expect(isCompaction(150_000, 89_999)).toBe(true);
    expect(isCompaction(150_000, 30_000)).toBe(true);
    expect(isCompaction(null, 30_000)).toBe(false);
    expect(isCompaction(8_000, 100)).toBe(false);
  });
});

describe('parseChunk context', () => {
  test('the last turn gives lastContext, repeated lines of a message do not move it by themselves', () => {
    const r = parseChunk(bytes(turn('a', 50_000), turn('b', 60_000, 5), turn('b', 60_000, 90)), FRESH, NOW);
    expect(r.lastContext).toBe(60_000);
    expect(r.compactions).toBe(0);
    expect(r.lastModel).toBe(SONNET);
  });

  test('a drop between two turns counts one compaction, also across chunks', () => {
    const first = parseChunk(bytes(turn('a', 150_000), turn('b', 40_000), turn('c', 45_000)), FRESH, NOW);
    expect(first.compactions).toBe(1);
    expect(first.lastContext).toBe(45_000);
    const second = parseChunk(bytes(turn('d', 150_000)), { lastMsgId: 'c', lastOut: 10, lastContext: 45_000 }, NOW);
    expect(second.compactions).toBe(0);
    const third = parseChunk(bytes(turn('e', 20_000)), { lastMsgId: 'd', lastOut: 10, lastContext: second.lastContext }, NOW);
    expect(third.compactions).toBe(1);
  });

  test('a compact_boundary line counts once and the drop after it does not count again', () => {
    const r = parseChunk(bytes(turn('a', 150_000), boundary(30_000), turn('b', 35_000)), FRESH, NOW);
    expect(r.compactions).toBe(1);
    expect(r.lastContext).toBe(35_000);
    const noPost = parseChunk(bytes(turn('a', 150_000), boundary(null), turn('b', 20_000)), FRESH, NOW);
    expect(noPost.compactions).toBe(1);
  });

  test('a line that only mentions compact_boundary is not one', () => {
    const quoted = `${JSON.stringify({ type: 'user', message: { content: 'the "compact_boundary" line' } })}\n`;
    expect(parseChunk(bytes(quoted, turn('a', 1_000)), FRESH, NOW).compactions).toBe(0);
  });
});

describe('TokenMeter cursor', () => {
  let cleanup = (): void => {};
  afterEach(() => cleanup());

  test('persists last_context and compactions and resumes them', () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const home = join(t.dir, 'claude-home');
    const cwd = join(t.dir, 'repo');
    const dir = join(home, 'projects', projectSlug(cwd));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'sess-1.jsonl');
    const db = openDb(':memory:');
    const agent: MeterAgent = { key: 'sess-1', sessionId: 'sess-1', floor: 'mobile', roleId: 'lead', name: 'lead-mobile', cwd, plan: null };
    const events: { context?: { tokens: number; compactions: number; window: number; source: string } | null }[] = [];
    const meter = new TokenMeter({ db, claudeHome: home, now: () => NOW, onRead: (e) => events.push(e) });
    writeFileSync(file, turn('a', 150_000) + turn('b', 40_000));
    meter.readNow(agent);
    expect(db.query('SELECT last_context, compactions FROM token_cursor WHERE agent_key = ?').get('sess-1')).toEqual({ last_context: 40_000, compactions: 1 });
    expect(events.at(-1)?.context).toMatchObject({ tokens: 40_000, compactions: 1, window: DEFAULT_WINDOW, source: 'transcript' });

    const again = new TokenMeter({ db, claudeHome: home, now: () => NOW, onRead: (e) => events.push(e) });
    expect(again.compactions('sess-1')).toBe(1);
    appendFileSync(file, turn('c', 100_000));
    again.readNow(agent);
    expect(db.query('SELECT last_context, compactions FROM token_cursor WHERE agent_key = ?').get('sess-1')).toEqual({ last_context: 100_000, compactions: 1 });
  });

  test('a window bigger than 200 K once the tokens say so, and the options override the table', () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const home = join(t.dir, 'claude-home');
    const cwd = join(t.dir, 'repo');
    const dir = join(home, 'projects', projectSlug(cwd));
    mkdirSync(dir, { recursive: true });
    const agent: MeterAgent = { key: 'sess-1', sessionId: 'sess-1', floor: 'mobile', roleId: 'lead', name: 'lead-mobile', cwd, plan: null };
    writeFileSync(join(dir, 'sess-1.jsonl'), turn('a', 300_000));
    const events: ServerMessage[] = [];
    const meter = new TokenMeter({ db: openDb(':memory:'), claudeHome: home, now: () => NOW, onRead: (data) => events.push({ type: 'tokens', data }) });
    meter.readNow(agent);
    expect(events[0]).toMatchObject({ data: { context: { tokens: 300_000, window: BIG_WINDOW, usedPct: 30 } } });
  });
});

describe('Office context', () => {
  let h: Harness;
  afterEach(() => h?.cleanup());

  const homeDir = (): string => join(h.root, 'claude-home');
  const agent = (key: string) => h.office.snapshot().agents.find((a) => a.key === key);
  const slow = (): Promise<void> => h.office.idle();
  const agentMessages = () => h.messages.flatMap((m) => (m.type === 'agent' && m.data.key === LEAD ? [m.data] : []));
  const tokenMessages = () => h.messages.flatMap((m) => (m.type === 'tokens' ? [m.data] : []));
  const statusline = (context: unknown, extra: Record<string, unknown> = {}) =>
    h.office.ingestUsage({ session_id: LEAD, model: { id: 'claude-opus-5-5' }, context_window: context, ...extra });

  function boot(configure?: (h: Harness) => void): { repo: string; file: string } {
    h = harness();
    configure?.(h);
    const repo = join(h.root, 'mobile');
    mkdirSync(repo, { recursive: true });
    h.config.floors.mobile = floor(repo);
    const dir = join(homeDir(), 'projects', projectSlug(repo));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${LEAD}.jsonl`);
    writeFileSync(file, '');
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { transcript_path: file, source: 'startup' }), leadMeta);
    return { repo, file };
  }

  test('the status line fills the context of a main session and speaks only when the rounded percentage changes', () => {
    boot();
    expect(agent(LEAD)?.context).toBeNull();
    h.messages.length = 0;
    statusline({ context_window_size: 200_000, used_percentage: null, current_usage: null });
    expect(agent(LEAD)?.context).toBeNull();
    expect(agentMessages()).toHaveLength(0);

    statusline({ context_window_size: 200_000, used_percentage: 41.3, current_usage: { input_tokens: 5, cache_read_input_tokens: 80_000, cache_creation_input_tokens: 2_000 } });
    expect(agent(LEAD)?.context).toMatchObject({ usedPct: 41.3, tokens: 82_005, window: 200_000, compactions: 0, source: 'statusline', at: h.clock.now });
    expect(agentMessages()).toHaveLength(1);

    h.clock.advance(60_000);
    statusline({ context_window_size: 200_000, used_percentage: 41.4, current_usage: { input_tokens: 5, cache_read_input_tokens: 80_100, cache_creation_input_tokens: 2_000 } });
    expect(agentMessages()).toHaveLength(1);
    expect(agent(LEAD)?.context?.at).toBe(h.clock.now);

    h.clock.advance(60_000);
    statusline({ context_window_size: 200_000, used_percentage: 43, current_usage: { input_tokens: 5, cache_read_input_tokens: 84_000, cache_creation_input_tokens: 2_000 } });
    expect(agentMessages()).toHaveLength(2);
    expect(agentMessages().at(-1)?.context).toMatchObject({ usedPct: 43 });
  });

  test('a status line without context_window, or from an unknown session, changes nothing', () => {
    boot();
    h.messages.length = 0;
    h.office.ingestUsage({ session_id: LEAD, rate_limits: {} });
    h.office.ingestUsage({ session_id: 'nobody', context_window: { used_percentage: 10, current_usage: { input_tokens: 5 } } });
    expect(agent(LEAD)?.context).toBeNull();
    expect(agentMessages()).toHaveLength(0);
  });

  test('the model of the role with [1m] and the window reported by the status line give 1 M', () => {
    boot((x) => {
      x.config.roles.lead.model = 'opus[1m]';
    });
    statusline({ used_percentage: null, current_usage: { input_tokens: 1, cache_read_input_tokens: 99_999, cache_creation_input_tokens: 0 } });
    expect(agent(LEAD)?.context).toMatchObject({ window: BIG_WINDOW, tokens: 100_000, usedPct: 10 });
  });

  test('the transcript fills the context when the status line is silent, and the status line wins for two minutes', async () => {
    const { file } = boot();
    appendFileSync(file, turn('a', 60_000));
    h.office.ingest(ev(LEAD, '', 'Stop', {}));
    await slow();
    expect(agent(LEAD)?.context).toMatchObject({ tokens: 60_000, source: 'transcript', window: DEFAULT_WINDOW });
    expect(tokenMessages().at(-1)?.context).toMatchObject({ usedPct: 30, source: 'transcript' });

    statusline({ context_window_size: 200_000, used_percentage: 35, current_usage: { input_tokens: 1, cache_read_input_tokens: 69_999, cache_creation_input_tokens: 0 } });
    h.clock.advance(60_000);
    appendFileSync(file, turn('b', 62_000));
    h.office.ingest(ev(LEAD, '', 'Stop', {}));
    await slow();
    expect(agent(LEAD)?.context).toMatchObject({ source: 'statusline', usedPct: 35 });

    h.clock.advance(120_000);
    appendFileSync(file, turn('c', 64_000));
    h.office.ingest(ev(LEAD, '', 'Stop', {}));
    await slow();
    expect(agent(LEAD)?.context).toMatchObject({ source: 'transcript', tokens: 64_000 });
  });

  test('a drop in the transcript counts a compaction on the agent', async () => {
    const { file } = boot();
    appendFileSync(file, turn('a', 150_000) + turn('b', 40_000));
    h.office.ingest(ev(LEAD, '', 'Stop', {}));
    await slow();
    expect(agent(LEAD)?.context).toMatchObject({ tokens: 40_000, compactions: 1 });
  });

  test('SessionStart compact adds an activity and counts once together with the boundary of the transcript', async () => {
    const { repo, file } = boot();
    appendFileSync(file, turn('a', 150_000));
    h.office.ingest(ev(LEAD, repo, 'Stop', {}));
    await slow();
    expect(agent(LEAD)?.context).toMatchObject({ tokens: 150_000, compactions: 0 });

    appendFileSync(file, boundary(30_000));
    h.clock.advance(1000);
    h.messages.length = 0;
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { source: 'compact' }), leadMeta);
    const activity = h.messages.flatMap((m) => (m.type === 'activity' && m.data.event === 'Compacted' ? [m.data] : []));
    expect(activity).toHaveLength(1);
    expect(activity[0].summary).toEqual({ key: 'hub.act.compacted', params: { who: 'lead-mobile', from: '75 %', to: '15 %' } });
    expect(agent(LEAD)?.context).toMatchObject({ compactions: 1, tokens: 30_000 });

    appendFileSync(file, turn('b', 33_000));
    h.office.ingest(ev(LEAD, repo, 'Stop', {}));
    await slow();
    expect(agent(LEAD)?.context).toMatchObject({ compactions: 1, tokens: 33_000 });
  });

  test('SessionStart compact before the transcript shows it still counts, and the drop later does not add one', async () => {
    const { repo, file } = boot();
    appendFileSync(file, turn('a', 150_000));
    h.office.ingest(ev(LEAD, repo, 'Stop', {}));
    await slow();
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { source: 'compact' }), leadMeta);
    expect(agent(LEAD)?.context?.compactions).toBe(1);
    expect(h.office.snapshot().activity.some((a) => typeof a.summary !== 'string' && a.summary.key === 'hub.act.compacted')).toBe(true);

    appendFileSync(file, turn('b', 30_000));
    h.office.ingest(ev(LEAD, repo, 'Stop', {}));
    await slow();
    expect(agent(LEAD)?.context).toMatchObject({ compactions: 1, tokens: 30_000 });
  });

  test('a teammate gets its context from the transcript of the subagent', async () => {
    const { repo } = boot();
    h.office.ingest(ev(LEAD, repo, 'PreToolUse', { tool_name: 'Agent', tool_use_id: 'call-1', tool_input: { name: 'dev-uno', subagent_type: 'office-dev-mobile', prompt: '…' } }));
    h.office.ingest(ev(LEAD, repo, 'SubagentStart', { agent_id: 'adev-1', agent_type: 'dev-uno' }));
    const sub = join(homeDir(), 'projects', 'elsewhere', 'agent-adev-1.jsonl');
    mkdirSync(join(homeDir(), 'projects', 'elsewhere'), { recursive: true });
    writeFileSync(sub, turn('a', 20_000) + turn('b', 90_000));
    h.office.ingest(ev(LEAD, repo, 'SubagentStop', { agent_id: 'adev-1', agent_type: 'dev-uno', agent_transcript_path: sub }));
    await slow();
    expect(agent('adev-1')?.context).toMatchObject({ tokens: 90_000, usedPct: 45, source: 'transcript' });
  });
});
