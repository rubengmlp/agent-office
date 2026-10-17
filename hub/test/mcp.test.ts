import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOWED_TOOLS, MAX_RESULT, McpServer, PROTOCOL_VERSIONS, TOOLS, plain, serve, type McpDeps, type RpcResponse } from '../src/mcp';
import { startServer } from '../src/server';
import type { HookMeta } from '../src/types';
import { ev, floor, harness, type Harness } from './helpers';

const KEY = 'k'.repeat(64);
const LEAD = '44444444-dddd-4eee-8fff-000000000004';
const leadMeta: HookMeta = { socket: null, token: null, role: 'office-lead-mobile', name: 'lead-mobile' };

type Call = { url: string; key: string | undefined };

function fakeDeps(handler: (path: string) => Response | Promise<Response>, over: Partial<McpDeps> = {}): { deps: McpDeps; calls: Call[]; logs: string[] } {
  const calls: Call[] = [];
  const logs: string[] = [];
  const deps: McpDeps = {
    fetch: async (url, init) => {
      calls.push({ url, key: init.headers['X-Office-Key'] });
      return handler(url.replace('http://hub.test', ''));
    },
    base: () => 'http://hub.test',
    key: () => KEY,
    log: (text) => logs.push(text),
    ...over,
  };
  return { deps, calls, logs };
}

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const request = (id: number | string | null, method: string, params?: unknown) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
const result = (answer: unknown): Record<string, unknown> => (answer as { result: Record<string, unknown> }).result;
const errorOf = (answer: unknown): { code: number; message: string } => (answer as { error: { code: number; message: string } }).error;
const textOf = (answer: unknown): string => (result(answer).content as { text: string }[])[0].text;

describe('protocol', () => {
  const server = new McpServer(fakeDeps(() => json({})).deps);

  test('initialize negotiates the version the client asks for and falls back to the newest', async () => {
    for (const version of PROTOCOL_VERSIONS) {
      const answer = await server.handle(request(1, 'initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } }));
      expect(result(answer)).toMatchObject({ protocolVersion: version, serverInfo: { name: 'office' }, capabilities: { tools: {} } });
    }
    expect(result(await server.handle(request(2, 'initialize', { protocolVersion: '2030-01-01' }))).protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
    expect(result(await server.handle(request(3, 'initialize'))).protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
    expect(await server.handle(request('abc', 'ping'))).toEqual({ jsonrpc: '2.0', id: 'abc', result: {} });
  });

  test('a notification gets no answer, known or not', async () => {
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await server.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } })).toBeNull();
    expect(await server.handle({ jsonrpc: '2.0', method: 'whatever/else' })).toBeNull();
  });

  test('an unknown method with an id is an error, and a malformed message too', async () => {
    expect(errorOf(await server.handle(request(7, 'resources/list'))).code).toBe(-32601);
    expect(await server.handle(request(7, 'resources/list'))).toMatchObject({ id: 7 });
    expect(errorOf(await server.handle('hola')).code).toBe(-32600);
    expect(errorOf(await server.handle({ jsonrpc: '2.0', id: 4 })).code).toBe(-32600);
    expect(await server.handle({ jsonrpc: '2.0', id: 4, result: {} })).toBeNull();
  });

  test('tools/list names the four read-only tools with their schema', async () => {
    const tools = result(await server.handle(request(1, 'tools/list'))).tools as { name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((t) => t.name)).toEqual(['office_state', 'office_plans', 'office_usage', 'office_search']);
    expect(tools.every((t) => t.inputSchema.type === 'object' && t.annotations.readOnlyHint)).toBe(true);
    expect(TOOLS.find((t) => t.name === 'office_search')?.inputSchema.required).toEqual(['q']);
    expect(ALLOWED_TOOLS).toEqual(tools.map((t) => `mcp__office__${t.name}`));
  });

  test('an unknown tool is an invalid-params error, not a tool result', async () => {
    expect(errorOf(await server.handle(request(1, 'tools/call', { name: 'office_delete', arguments: {} }))).code).toBe(-32602);
    expect(errorOf(await server.handle(request(1, 'tools/call', {}))).code).toBe(-32602);
  });

  test('a batch answers every request and skips the notifications', async () => {
    const answers = (await server.handle([request(1, 'ping'), { jsonrpc: '2.0', method: 'notifications/initialized' }, request(2, 'tools/list')])) as RpcResponse[];
    expect(answers.map((a) => a.id)).toEqual([1, 2]);
    expect(await server.handle([{ jsonrpc: '2.0', method: 'notifications/initialized' }])).toBeNull();
    expect(errorOf(await server.handle([])).code).toBe(-32600);
  });
});

describe('tools against the routes of the hub', () => {
  let h: Harness;
  afterEach(() => h?.cleanup());

  function boot(): void {
    h = harness();
    const repo = join(h.root, 'mobile');
    mkdirSync(repo, { recursive: true });
    h.config.floors.mobile = floor(repo);
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { source: 'startup' }), leadMeta);
    h.office.ingestUsage({
      session_id: LEAD,
      context_window: { context_window_size: 200_000, used_percentage: 62.4, current_usage: { input_tokens: 10, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 4_000 } },
      rate_limits: { five_hour: { used_percentage: 40, resets_at: Math.floor(h.clock.now / 1000) + 7200 } },
    });
  }

  const hub = (path: string): Response => {
    const url = new URL(path, 'http://hub.test');
    if (url.pathname === '/api/state') return json(h.office.snapshot());
    if (url.pathname === '/api/documents') return json(h.office.documents());
    if (url.pathname === '/api/usage/summary') return json(h.office.tokenSummary(url.searchParams.get('range') === 'week' ? 'week' : 'today'));
    return new Response('not found', { status: 404 });
  };
  const call = (server: McpServer, name: string, args: unknown = {}) => server.handle(request(1, 'tools/call', { name, arguments: args }));

  test('office_state sends the key and answers floors, agents with their context, and nothing else per agent', async () => {
    boot();
    const { deps, calls } = fakeDeps(hub);
    const answer = await call(new McpServer(deps), 'office_state');
    expect(calls).toEqual([{ url: 'http://hub.test/api/state', key: KEY }]);
    expect(result(answer).isError).toBeUndefined();
    const body = JSON.parse(textOf(answer));
    expect(body.floors).toContainEqual({ slug: 'mobile', label: 'mobile', kind: 'managed', agents: 1 });
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).toMatchObject({ name: 'lead-mobile', floor: 'mobile', context: '62 % (124k de 200k, 0 compactaciones)' });
    expect(body.agents[0]).not.toHaveProperty('key');
    expect(textOf(answer).length).toBeLessThan(MAX_RESULT);
  });

  test('office_state with a floor filters, and an unknown floor is a tool error that names the real ones', async () => {
    boot();
    const server = new McpServer(fakeDeps(hub).deps);
    expect(JSON.parse(textOf(await call(server, 'office_state', { floor: 'mobile' }))).agents).toHaveLength(1);
    const unknown = await call(server, 'office_state', { floor: 'nada' });
    expect(result(unknown).isError).toBe(true);
    expect(textOf(unknown)).toContain('mobile');
  });

  test('office_plans filters by status and rejects one that does not exist', async () => {
    boot();
    const docs = [
      { path: 'a.md', kind: 'plan', slug: 'a', title: 'Login', docType: 'plan', status: 'aprobado', round: 2, maxRounds: 4, score: 9, updatedAt: 2000, deliveredAt: null, decidedAt: null, base: [], ahead: [], installedAt: [], tokens: null },
      { path: 'b.md', kind: 'plan', slug: 'b', title: 'Pagos', docType: 'plan', status: 'borrador', round: 1, maxRounds: 4, score: null, updatedAt: 3000, deliveredAt: null, decidedAt: null, base: [], ahead: [], installedAt: [], tokens: null },
      { path: 's.md', kind: 'skill', slug: 's', title: 'Skill', docType: 'skill', status: 'aprobado', round: 1, maxRounds: 4, score: null, updatedAt: 4000, deliveredAt: null, decidedAt: null, base: [], ahead: [], installedAt: [], tokens: null },
    ];
    const server = new McpServer(fakeDeps((path) => (path === '/api/documents' ? json(docs) : hub(path))).deps);
    expect(JSON.parse(textOf(await call(server, 'office_plans'))).plans.map((p: { slug: string }) => p.slug)).toEqual(['b', 'a']);
    expect(JSON.parse(textOf(await call(server, 'office_plans', { status: 'aprobado' }))).plans).toEqual([
      { slug: 'a', title: 'Login', status: 'aprobado', round: '2/4', score: 9, path: 'a.md', updated: new Date(2000).toISOString(), delivered: null },
    ]);
    const bad = await call(server, 'office_plans', { status: 'raro' });
    expect(result(bad).isError).toBe(true);
    expect(textOf(bad)).toContain('aprobado');
  });

  test('office_usage joins the summary of the range with the windows of the limit and their forecast', async () => {
    boot();
    const { deps, calls } = fakeDeps(hub);
    const answer = await call(new McpServer(deps), 'office_usage', { range: 'week' });
    expect(calls.map((c) => c.url).sort()).toEqual(['http://hub.test/api/state', 'http://hub.test/api/usage/summary?range=week']);
    expect(calls.every((c) => c.key === KEY)).toBe(true);
    const body = JSON.parse(textOf(answer));
    expect(body).toMatchObject({ range: 'week', limit: { fiveHour: { usedPct: 40, forecast: 'pocas muestras' }, sevenDay: null } });
    const bad = await call(new McpServer(deps), 'office_usage', { range: 'year' });
    expect(result(bad).isError).toBe(true);
  });

  test('office_search passes the filters to /api/search and returns what the hub answers', async () => {
    boot();
    const { deps, calls } = fakeDeps((path) => (path.startsWith('/api/search') ? json({ results: [{ kind: 'activity', body: 'Redacción empieza' }] }) : hub(path)));
    const answer = await call(new McpServer(deps), 'office_search', { q: 'redaccion', floor: 'mobile', kind: 'activity', from: 10, limit: 500 });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'redaccion', floor: 'mobile', kind: 'activity', from: '10', limit: '100' });
    expect(JSON.parse(textOf(answer))).toEqual({ results: [{ kind: 'activity', body: 'Redacción empieza' }] });
    expect(result(await call(new McpServer(deps), 'office_search', {})).isError).toBe(true);
    expect(result(await call(new McpServer(deps), 'office_search', { q: 'x', kind: 'raro' })).isError).toBe(true);
  });

  test('office_search says the search is not available when the route is missing', async () => {
    boot();
    const answer = await call(new McpServer(fakeDeps(hub).deps), 'office_search', { q: 'algo' });
    expect(result(answer)).toMatchObject({ isError: true });
    expect(textOf(answer)).toBe('búsqueda no disponible');
  });

  test('a hub that is down, a rejected key and a missing key are tool errors, never protocol errors', async () => {
    boot();
    const down = await call(new McpServer(fakeDeps(() => Promise.reject(new Error('ECONNREFUSED'))).deps), 'office_state');
    expect(result(down).isError).toBe(true);
    expect(textOf(down)).toContain('El hub no responde');
    const rejected = await call(new McpServer(fakeDeps(() => new Response('unauthorized', { status: 401 })).deps), 'office_plans');
    expect(result(rejected).isError).toBe(true);
    expect(textOf(rejected)).toContain('rechazó la clave');
    const { deps, calls } = fakeDeps(hub, { key: () => null });
    const keyless = await call(new McpServer(deps), 'office_state');
    expect(result(keyless).isError).toBe(true);
    expect(calls).toHaveLength(0);
    const broken = await call(new McpServer(fakeDeps(() => new Response('<html>', { status: 200 })).deps), 'office_state');
    expect(result(broken).isError).toBe(true);
    const failing = await call(new McpServer(fakeDeps(() => new Response('x', { status: 500 })).deps), 'office_state');
    expect(textOf(failing)).toContain('500');
  });

  test('a result over the limit is cut with a note', async () => {
    boot();
    const docs = Array.from({ length: 50 }, (_, i) => ({
      path: `p${i}.md`, kind: 'plan', slug: `p${i}`, title: 'T'.repeat(600), docType: 'plan', status: 'borrador', round: 1, maxRounds: 4, score: null, updatedAt: i, deliveredAt: null, decidedAt: null, base: [], ahead: [], installedAt: [], tokens: null,
    }));
    const answer = await call(new McpServer(fakeDeps(() => json(docs)).deps), 'office_plans');
    const text = textOf(answer);
    expect(text.length).toBeLessThanOrEqual(MAX_RESULT);
    expect(text).toContain('recortado');
  });

  test('plain turns a hub text into readable words', () => {
    expect(plain('texto crudo')).toBe('texto crudo');
    expect(plain({ key: 'hub.detail.thinking' })).toBe('detail.thinking');
    expect(plain({ key: 'hub.detail.delegatesTo', params: { who: 'dev', what: 'login' } })).toBe('detail.delegatesTo: dev, login');
    expect(plain(null)).toBe('');
  });
});

describe('stdio', () => {
  async function run(chunks: string[], deps: McpDeps = fakeDeps(() => json({})).deps): Promise<unknown[]> {
    const out: string[] = [];
    async function* input(): AsyncGenerator<string> {
      for (const chunk of chunks) yield chunk;
    }
    await serve(input(), (line) => out.push(line), new McpServer(deps));
    return out.map((line) => {
      expect(line.endsWith('\n')).toBe(true);
      expect(line.slice(0, -1)).not.toContain('\n');
      return JSON.parse(line);
    });
  }

  test('one JSON message per line, also when a line arrives in pieces', async () => {
    const one = JSON.stringify(request(1, 'ping'));
    const answers = await run([one.slice(0, 5), `${one.slice(5)}\n${JSON.stringify(request(2, 'tools/list'))}\n`, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), '\n']);
    expect(answers.map((a) => (a as { id: number }).id).sort()).toEqual([1, 2]);
  });

  test('a line that is not JSON gets a parse error with a null id and the next one is still served', async () => {
    const answers = await run(['{esto no\n', `${JSON.stringify(request(3, 'ping'))}\n`]);
    expect(answers).toContainEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: expect.any(String) } });
    expect(answers).toContainEqual({ jsonrpc: '2.0', id: 3, result: {} });
  });

  test('the last line without a newline is served when the input ends', async () => {
    const answers = await run([JSON.stringify(request(9, 'ping'))]);
    expect(answers).toEqual([{ jsonrpc: '2.0', id: 9, result: {} }]);
  });
});

describe('the process', () => {
  let h: Harness;
  let stop = (): void => {};
  afterEach(() => {
    stop();
    h?.cleanup();
  });

  test('bun hub/src/mcp.ts reads the key and port of its home and talks to a hub', async () => {
    h = harness();
    const repo = join(h.root, 'mobile');
    mkdirSync(repo, { recursive: true });
    h.config.floors.mobile = floor(repo);
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { source: 'startup' }), leadMeta);
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
    const port = Number(probe.port);
    probe.stop(true);
    const publicDir = join(h.root, 'public');
    mkdirSync(publicDir, { recursive: true });
    ({ stop } = startServer({ office: h.office, port, key: () => KEY, publicDir }));
    const home = join(h.root, 'mcp-home');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'key'), `${KEY}\n`);
    writeFileSync(join(home, 'port'), String(port));
    const script = join(import.meta.dir, '..', 'src', 'mcp.ts');
    const proc = Bun.spawn([process.execPath, script], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, AGENT_OFFICE_HOME: home, AGENT_OFFICE_CLAUDE_HOME: join(h.root, 'claude-home') },
    });
    proc.stdin.write(`${JSON.stringify(request(1, 'initialize', { protocolVersion: '2025-06-18' }))}\n`);
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    proc.stdin.write(`${JSON.stringify(request(2, 'tools/call', { name: 'office_state', arguments: {} }))}\n`);
    proc.stdin.end();
    const lines = (await new Response(proc.stdout).text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(await proc.exited).toBe(0);
    expect(lines.map((l) => l.id)).toEqual([1, 2]);
    expect(lines[0].result.serverInfo.name).toBe('office');
    const state = JSON.parse(lines[1].result.content[0].text);
    expect(state.agents.map((a: { name: string }) => a.name)).toEqual(['lead-mobile']);
  });

  test('without a hub it answers a tool error and keeps the stream alive', async () => {
    h = harness();
    const home = join(h.root, 'mcp-home');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'key'), KEY);
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') });
    const port = Number(probe.port);
    probe.stop(true);
    writeFileSync(join(home, 'port'), String(port));
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'src', 'mcp.ts')], {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, AGENT_OFFICE_HOME: home },
    });
    proc.stdin.write(`${JSON.stringify(request(1, 'tools/call', { name: 'office_state', arguments: {} }))}\n${JSON.stringify(request(2, 'ping'))}\n`);
    proc.stdin.end();
    const lines = (await new Response(proc.stdout).text()).trim().split('\n').map((line) => JSON.parse(line));
    await proc.exited;
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    expect(byId[1].result.isError).toBe(true);
    expect(byId[1].result.content[0].text).toContain('El hub no responde');
    expect(byId[2].result).toEqual({});
  });
});
