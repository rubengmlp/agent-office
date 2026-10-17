import { readFileSync } from 'node:fs';
import { paths } from './config';
import type { DocumentStatus, DocumentView, HubText, OrderView, Snapshot, TokenRow, TokenTotals, UsageRange, UsageSummary, UsageWindow } from './types';

// Read-only MCP server for the sessions of the office: JSON-RPC 2.0 by hand over stdio, one message per line,
// no dependencies. stdout carries only protocol; every log goes to stderr. The hub key is read from the file of
// the office (never from argv or the environment) and sent as X-Office-Key.

export const SERVER_NAME = 'office';
export const SERVER_VERSION = '1.0.0';
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const TOOL_NAMES = ['office_state', 'office_plans', 'office_usage', 'office_search'] as const;
export const MAX_RESULT = 20_000;
const REQUEST_MS = 10_000;
const DEFAULT_PORT = 4747;

type Id = string | number | null;
type Json = Record<string, unknown>;
type RpcError = { code: number; message: string };
export type RpcResponse = { jsonrpc: '2.0'; id: Id } & ({ result: unknown } | { error: RpcError });
export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export type McpDeps = {
  fetch: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;
  base: () => string;
  key: () => string | null;
  log: (text: string) => void;
};

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

const PLAN_STATUSES: readonly DocumentStatus[] = ['borrador', 'revision', 'aprobado', 'sin-acuerdo', 'entregado', 'aparcado', 'ejecutando', 'cerrado', 'descartado'];
const SEARCH_KINDS = ['activity', 'message', 'chat', 'agent'] as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
  {
    name: 'office_state',
    description:
      'Estado actual de la oficina: plantas, agentes vivos (estado, qué hacen, ocupación de su ventana de contexto), preguntas abiertas, encargos del Tablero y alertas. Opcionalmente de una sola planta.',
    inputSchema: {
      type: 'object',
      properties: { floor: { type: 'string', description: 'Identificador de la planta (por ejemplo "mobile"). Sin él, todas.' } },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: 'office_plans',
    description: 'Planes de Redacción con su estado, ronda y puntuación del revisor. Se puede filtrar por estado.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: PLAN_STATUSES, description: 'Solo los planes en este estado.' } },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: 'office_usage',
    description:
      'Consumo de tokens de la oficina (hoy o la semana) por rol, modelo, planta y plan, y las ventanas del límite de uso con su previsión de agotamiento.',
    inputSchema: {
      type: 'object',
      properties: { range: { type: 'string', enum: ['today', 'week'], description: 'Intervalo; por defecto hoy.' } },
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: 'office_search',
    description: 'Busca en el historial de la oficina: actividad de los agentes, mensajes, chat y agentes. Tolera acentos y prefijos.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Texto a buscar (hasta 8 términos).' },
        floor: { type: 'string', description: 'Limita a una planta.' },
        agent: { type: 'string', description: 'Limita a un agente.' },
        kind: { type: 'string', enum: SEARCH_KINDS, description: 'Limita a un tipo de resultado.' },
        from: { type: 'number', description: 'Desde (milisegundos desde 1970).' },
        to: { type: 'number', description: 'Hasta (milisegundos desde 1970).' },
        limit: { type: 'number', description: 'Máximo de resultados (1 a 100; por defecto 20).' },
      },
      required: ['q'],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
] as const;

// What the launchers allow without asking: the four tools of this server.
export const ALLOWED_TOOLS: readonly string[] = TOOL_NAMES.map((name) => `mcp__${SERVER_NAME}__${name}`);

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failed(value: unknown): value is ToolResult {
  return isRecord(value) && value.isError === true && Array.isArray(value.content);
}

function fail(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

// A result as compact JSON, cut before it floods the context of the session that asked.
export function ok(value: unknown): ToolResult {
  const body = JSON.stringify(value);
  const text = body.length <= MAX_RESULT ? body : `${body.slice(0, MAX_RESULT - 80)}… [recortado: ${body.length - MAX_RESULT + 80} caracteres más]`;
  return { content: [{ type: 'text', text }] };
}

// The panel translates HubText; here it comes out as the key without its prefix and the parameters, which is
// enough for a model to read.
export function plain(value: HubText | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  const params = isRecord(value.params) ? Object.values(value.params).map((param) => (typeof param === 'object' && param !== null ? plain(param as HubText) : String(param))) : [];
  const name = String(value.key).replace(/^hub\./, '');
  return params.length > 0 ? `${name}: ${params.join(', ')}` : name;
}

function iso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function grand(t: TokenTotals | null | undefined): number {
  return t ? t.input + t.cacheRead + t.cacheCreate + t.output : 0;
}

function kilo(n: number): string {
  return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
}

function stateResult(snapshot: Snapshot, floor: string | null): ToolResult {
  const inFloor = (slug: string): boolean => floor === null || slug === floor;
  if (floor !== null && !snapshot.floors.some((f) => f.slug === floor)) {
    return fail(`No hay ninguna planta "${floor}". Plantas: ${snapshot.floors.map((f) => f.slug).join(', ') || 'ninguna'}.`);
  }
  const alive = snapshot.agents.filter((a) => a.endedAt === null && inFloor(a.floor));
  const agents = alive.slice(0, 80).map((a) => ({
    name: a.name ?? a.role,
    role: a.role,
    floor: a.floor,
    state: a.state,
    doing: plain(a.detail),
    task: a.task,
    file: a.file,
    away: a.away || undefined,
    waiting: a.waiting ? { who: a.waiting.who, what: a.waiting.what } : undefined,
    stalled: a.stalledSince !== null ? iso(a.stalledSince) : undefined,
    context: a.context ? `${Math.round(a.context.usedPct)} % (${kilo(a.context.tokens)} de ${kilo(a.context.window)}, ${a.context.compactions} compactaciones)` : undefined,
    tokens: a.tokens ? grand(a.tokens) : undefined,
  }));
  const orders = snapshot.orders
    .filter((o: OrderView) => inFloor(o.floor) && o.status !== 'descartado')
    .slice(0, 40)
    .map((o) => ({ id: o.id, title: o.title, floor: o.floor, status: o.status, lead: o.lead, branch: o.branch, checks: o.checks && o.checks.status !== 'none' ? `${o.checks.status} ${o.checks.passed}/${o.checks.total}` : undefined }));
  return ok({
    now: iso(snapshot.now),
    floors: snapshot.floors.filter((f) => inFloor(f.slug)).map((f) => ({ slug: f.slug, label: f.label, kind: f.kind, agents: alive.filter((a) => a.floor === f.slug).length })),
    agents,
    agentsNotShown: alive.length > agents.length ? alive.length - agents.length : undefined,
    questions: snapshot.questions
      .filter((q) => inFloor(q.floor))
      .map((q) => ({ agent: snapshot.agents.find((a) => a.key === q.agentKey)?.name ?? q.agentKey, kind: q.kind ?? 'ask', floor: q.floor, tool: q.tool })),
    orders,
    alerts: snapshot.alerts.filter((a) => inFloor(a.floor)).slice(-10).map((a) => ({ level: a.level, floor: a.floor, files: a.files.length, at: iso(a.ts) })),
  });
}

function plansResult(documents: DocumentView[], status: DocumentStatus | null): ToolResult {
  const plans = documents
    .filter((d) => d.kind === 'plan' && (status === null || d.status === status))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50)
    .map((d) => ({ slug: d.slug, title: d.title, status: d.status, round: `${d.round}/${d.maxRounds}`, score: d.score, path: d.path, updated: iso(d.updatedAt), delivered: iso(d.deliveredAt), tokens: d.tokens ? grand(d.tokens) : undefined }));
  return ok({ plans });
}

function windowOf(w: UsageWindow | null): unknown {
  if (!w) return null;
  const f = w.forecast;
  return {
    usedPct: Math.round(w.usedPct),
    resets: iso(w.resetsAt),
    forecast: !f ? undefined : f.basis === 'thin' ? 'pocas muestras' : f.safe ? 'no se agota antes del reinicio' : { exhausts: iso(f.exhaustsAt), pctPerHour: Math.round(f.rate * 10) / 10 },
  };
}

function rows(list: TokenRow[]): unknown[] {
  return list.slice(0, 8).map((r) => ({ key: r.key || '(sin)', tokens: grand(r.tokens), turns: r.tokens.turns, agents: r.agents }));
}

function usageResult(summary: UsageSummary, snapshot: Snapshot): ToolResult {
  return ok({
    range: summary.range,
    from: summary.from,
    to: summary.to,
    limit: { fiveHour: windowOf(snapshot.usage.fiveHour), sevenDay: windowOf(snapshot.usage.sevenDay), sampledAt: iso(snapshot.usage.at) },
    total: { tokens: grand(summary.total.tokens), ...summary.total.tokens, agents: summary.total.agents },
    byRole: rows(summary.byRole),
    byModel: rows(summary.byModel),
    byFloor: rows(summary.byFloor),
    byPlan: rows(summary.byPlan),
  });
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : null;
}

export class McpServer {
  constructor(private readonly deps: McpDeps) {}

  // One JSON-RPC message (or batch) in, its answer out; null when nothing is to be answered (notifications).
  async handle(message: unknown): Promise<RpcResponse | RpcResponse[] | null> {
    if (Array.isArray(message)) {
      if (message.length === 0) return this.error(null, INVALID_REQUEST, 'Lote vacío');
      const answers = (await Promise.all(message.map((item) => this.one(item)))).filter((item): item is RpcResponse => item !== null);
      return answers.length > 0 ? answers : null;
    }
    return this.one(message);
  }

  private async one(message: unknown): Promise<RpcResponse | null> {
    if (!isRecord(message)) return this.error(null, INVALID_REQUEST, 'Petición no válida');
    const hasId = 'id' in message && (typeof message.id === 'string' || typeof message.id === 'number' || message.id === null);
    const id: Id = hasId ? (message.id as Id) : null;
    // A response from the client (we send no requests) or a message without method.
    if (typeof message.method !== 'string') return 'result' in message || 'error' in message ? null : this.error(hasId ? id : null, INVALID_REQUEST, 'Falta el método');
    if (!hasId) return null;
    try {
      return await this.dispatch(id, message.method, isRecord(message.params) ? message.params : {});
    } catch (error) {
      this.deps.log(`${message.method}: ${(error as Error).stack ?? String(error)}`);
      return this.error(id, -32603, 'Error interno');
    }
  }

  private async dispatch(id: Id, method: string, params: Json): Promise<RpcResponse> {
    switch (method) {
      case 'initialize': {
        const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const version = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
        return this.result(id, { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } });
      }
      case 'ping':
        return this.result(id, {});
      case 'tools/list':
        return this.result(id, { tools: TOOLS });
      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name : '';
        if (!(TOOL_NAMES as readonly string[]).includes(name)) return this.error(id, INVALID_PARAMS, `Herramienta desconocida: ${name || '(sin nombre)'}`);
        return this.result(id, await this.call(name, isRecord(params.arguments) ? params.arguments : {}));
      }
      default:
        return this.error(id, METHOD_NOT_FOUND, `Método desconocido: ${method}`);
    }
  }

  async call(name: string, args: Json): Promise<ToolResult> {
    switch (name) {
      case 'office_state': {
        const floor = text(args.floor);
        const snapshot = await this.get<Snapshot>('/api/state');
        return failed(snapshot) ? snapshot : stateResult(snapshot, floor);
      }
      case 'office_plans': {
        const status = text(args.status);
        if (status !== null && !(PLAN_STATUSES as readonly string[]).includes(status)) return fail(`Estado desconocido: ${status}. Estados: ${PLAN_STATUSES.join(', ')}.`);
        const documents = await this.get<DocumentView[]>('/api/documents');
        return failed(documents) ? documents : plansResult(documents, status as DocumentStatus | null);
      }
      case 'office_usage': {
        const range: UsageRange = args.range === 'week' ? 'week' : 'today';
        if (args.range !== undefined && args.range !== 'today' && args.range !== 'week') return fail('range debe ser "today" o "week".');
        const [summary, snapshot] = await Promise.all([this.get<UsageSummary>(`/api/usage/summary?range=${range}`), this.get<Snapshot>('/api/state')]);
        if (failed(summary)) return summary;
        return failed(snapshot) ? snapshot : usageResult(summary, snapshot);
      }
      default:
        return this.search(args);
    }
  }

  private async search(args: Json): Promise<ToolResult> {
    const q = text(args.q);
    if (q === null) return fail('Falta q: el texto a buscar.');
    const query = new URLSearchParams({ q });
    for (const field of ['floor', 'agent'] as const) {
      const value = text(args[field]);
      if (value !== null) query.set(field, value);
    }
    const kind = text(args.kind);
    if (kind !== null) {
      if (!(SEARCH_KINDS as readonly string[]).includes(kind)) return fail(`kind debe ser uno de: ${SEARCH_KINDS.join(', ')}.`);
      query.set('kind', kind);
    }
    for (const field of ['from', 'to'] as const) {
      const value = integer(args[field], 0, Number.MAX_SAFE_INTEGER);
      if (value !== null) query.set(field, String(value));
    }
    query.set('limit', String(integer(args.limit, 1, 100) ?? 20));
    const found = await this.get<unknown>(`/api/search?${query.toString()}`, { 404: 'búsqueda no disponible' });
    return failed(found) ? found : ok(found);
  }

  // GET a route of the hub as JSON; the failures come back as the error result of the tool.
  private async get<T>(path: string, notes: Record<number, string> = {}): Promise<T | ToolResult> {
    const key = this.deps.key();
    if (!key) return fail('El hub no responde: no hay clave de la oficina (¿se ha ejecutado bun run setup?).');
    let response: Response;
    try {
      response = await this.deps.fetch(`${this.deps.base()}${path}`, { headers: { 'X-Office-Key': key }, signal: AbortSignal.timeout(REQUEST_MS) });
    } catch {
      return fail('El hub no responde. Arráncalo con bun run hub.');
    }
    if (response.status === 401) return fail('El hub rechazó la clave de la oficina (¿se rotó? Relanza la sesión).');
    if (!response.ok) return fail(notes[response.status] ?? `El hub respondió ${response.status}.`);
    try {
      return (await response.json()) as T;
    } catch {
      return fail('El hub respondió con algo que no es JSON.');
    }
  }

  private result(id: Id, result: unknown): RpcResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private error(id: Id, code: number, message: string): RpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}

export function parseLine(line: string): { ok: true; message: unknown } | { ok: false; response: RpcResponse } {
  try {
    return { ok: true, message: JSON.parse(line) };
  } catch {
    return { ok: false, response: { jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'JSON no válido' } } };
  }
}

export function defaultDeps(env: Record<string, string | undefined> = process.env): McpDeps {
  const p = paths(env);
  const read = (file: string): string | null => {
    try {
      return readFileSync(file, 'utf8').trim() || null;
    } catch {
      return null;
    }
  };
  return {
    fetch: (url, init) => fetch(url, init),
    base: () => `http://127.0.0.1:${Number(read(p.port)) || DEFAULT_PORT}`,
    key: () => read(p.key),
    log: (text) => console.error(`Agent Office MCP: ${text}`),
  };
}

// Lines in, lines out. Every message is answered as soon as it is ready, so a slow call does not hold a ping.
export async function serve(input: AsyncIterable<string | Uint8Array>, write: (line: string) => void, server: McpServer): Promise<void> {
  const decoder = new TextDecoder();
  const pending = new Set<Promise<void>>();
  const run = (line: string): void => {
    if (line.trim() === '') return;
    const parsed = parseLine(line);
    const task = (parsed.ok ? server.handle(parsed.message) : Promise.resolve(parsed.response)).then((answer) => {
      if (answer !== null) write(`${JSON.stringify(answer)}\n`);
    });
    const tracked = task.catch(() => {}).finally(() => pending.delete(tracked));
    pending.add(tracked);
  };
  let buffer = '';
  for await (const chunk of input) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      run(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
    }
  }
  run(buffer);
  await Promise.all(pending);
}

if (import.meta.main) {
  void serve(process.stdin as unknown as AsyncIterable<Uint8Array>, (line) => process.stdout.write(line), new McpServer(defaultDeps()));
}
