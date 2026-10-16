import type { Database } from 'bun:sqlite';
import { setupOf } from './profiles';
import { encodeInbox, type deliver } from './courier';
import { isLeadRole } from './scope';
import { realPath, isInside } from './floors';
import type { OfficeBus } from './office-bus';
import type { AgentRuntime, OrderResult } from './office-state';
import { folderFailedText, folderText } from './office-texts';
import type { OrderRow, OrderStore } from './order-store';
import { BOARD_COLUMNS, doneSummary, leavesDone, manualTarget, nextStatus, orderSlug, randomSuffix, splitBrief } from './orders';
import { BRIEF_PREFIX } from './protocol';
import { validRef } from './repo-ops';
import type { SessionBook } from './session-book';
import type {
  FinishedView,
  HubText,
  OfficeConfig,
  OrderSource,
  OrderStatus,
  OrderView,
  TokenTotals,
} from './types';
import type { CreateResult } from './worktrees';

const TOUCH_WRITE_MS = 2000;
const OUTSIDE_NOTE_MS = 5 * 60_000;
const CLOSED_ON_SNAPSHOT = 100;
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 2000;

export type BoardDeskOpts = {
  db: Database;
  store: OrderStore;
  now: () => number;
  bus: OfficeBus;
  book: SessionBook;
  config: () => OfficeConfig;
  worktrees: { create(order: OrderRow): Promise<CreateResult> };
  byPath: (cwd: string | null | undefined) => OrderRow | null;
  deliver: typeof deliver;
  order: (sessionId: string, text: string) => Promise<OrderResult>;
  planTotals: () => Map<string, TokenTotals>;
  // Why a card cannot go to hecho without the user's force (checks that are red, a changed definition of them).
  doneBlock?: (order: OrderRow) => HubText | null;
  rand?: () => number;
};

export type CreateOrderRequest = { floor: string; title: string; description?: string; base?: string; via: 'lead' | 'director' };

export type BoardFailure = { ok: false; status: 400 | 404 | 409 | 502; error: HubText };

export type CreateOrderResult = { ok: true; order: OrderView } | BoardFailure;

export type MoveResult = { ok: true; order: OrderView } | BoardFailure;

type AlertRow = { id: number; ts: number; detail: string | null };

export class BoardDesk {
  private readonly lastWrite = new Map<number, number>();
  private readonly outsideNoted = new Map<string, number>();
  private readonly insertFinished;
  private readonly unseen;
  private readonly markSeenRow;

  constructor(private readonly opts: BoardDeskOpts) {
    this.insertFinished = opts.db.query(
      "INSERT OR IGNORE INTO alerts (ts, level, floor, agent_key, files, ref, cycle, detail) VALUES (?, 'fin', ?, ?, '[]', ?, ?, ?)",
    );
    this.unseen = opts.db.query<AlertRow, []>("SELECT id, ts, detail FROM alerts WHERE level = 'fin' AND seen_at IS NULL ORDER BY ts, id");
    this.markSeenRow = opts.db.query("UPDATE alerts SET seen_at = ? WHERE id = ? AND level = 'fin' AND seen_at IS NULL");
  }

  // ---- views ----------------------------------------------------------------------------------------------

  view(row: OrderRow, plans: Map<string, TokenTotals> = this.opts.planTotals()): OrderView {
    const folder = row.worktree_state ? { path: row.worktree_path ?? '', state: row.worktree_state, error: row.setup_error, stale: row.base_stale === 1 } : null;
    return {
      id: row.id,
      slug: row.slug,
      floor: row.floor,
      title: row.title,
      description: row.description,
      status: row.status,
      source: row.source,
      planSlug: row.plan_slug,
      parentId: row.parent_id,
      lead: `lead-${row.floor}`,
      branch: row.branch,
      base: row.base_ref,
      baseSha: row.base_sha,
      worktree: folder,
      checks: null,
      review: { state: row.review_state },
      pr: row.pr_url ? { url: row.pr_url, state: row.pr_state } : null,
      mergedAt: row.merged_at,
      tokens: plans.get(`encargo/${row.slug}`) ?? null,
      cycle: row.cycle,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActivity: row.last_activity,
    };
  }

  viewOf(id: number): OrderView | null {
    const row = this.opts.store.get(id);
    return row ? this.view(row) : null;
  }

  // Everything open, and the last closed ones: the Tablero does not need the history of months.
  list(): OrderView[] {
    const plans = this.opts.planTotals();
    const rows = this.opts.store.all();
    const closed = rows.filter((row) => row.status === 'hecho' || row.status === 'descartado').sort((a, b) => b.updated_at - a.updated_at);
    const keep = new Set(closed.slice(0, CLOSED_ON_SNAPSHOT).map((row) => row.id));
    return rows.filter((row) => (row.status !== 'hecho' && row.status !== 'descartado') || keep.has(row.id)).map((row) => this.view(row, plans));
  }

  private changed(row: OrderRow): void {
    this.opts.bus.emit({ type: 'order', data: this.view(row) });
  }

  private note(summary: HubText, agentKey = 'panel'): void {
    this.opts.bus.pushActivity({ ts: this.opts.now(), agentKey, event: 'Order', tool: null, state: null, summary });
  }

  // ---- creation -------------------------------------------------------------------------------------------

  private freshSlug(title: string): string {
    for (;;) {
      const slug = orderSlug(title, randomSuffix(this.opts.rand));
      if (!this.opts.store.slugTaken(slug)) return slug;
    }
  }

  private leadOf(floor: string): { sessionId: string; socket: string | null; token: string | null } | null {
    let found: { sessionId: string; socket: string | null; token: string | null; updatedAt: number } | null = null;
    for (const session of this.opts.book.sessions.values()) {
      if (session.endedAt !== null || session.floor !== floor || session.floorKind !== 'managed') continue;
      const role = session.role ?? this.opts.book.agents.get(session.sessionId)?.role ?? null;
      if (!isLeadRole(role)) continue;
      if (!found || session.updatedAt > found.updatedAt) found = { sessionId: session.sessionId, socket: session.socket, token: session.token, updatedAt: session.updatedAt };
    }
    return found;
  }

  private managed(floor: string): boolean {
    return this.opts.config().floors[floor]?.managed === true;
  }

  // The ENCARGO of the director to lead-<floor>, once the budget gate let it through.
  briefAccepted(to: string, body: string, planSlug: string | null): OrderRow | null {
    const name = to.split('@')[0] ?? '';
    if (!name.startsWith('lead-') || !BRIEF_PREFIX.test(body)) return null;
    const floor = name.slice('lead-'.length);
    if (!this.managed(floor)) return null;
    const { title, description } = splitBrief(body, BRIEF_PREFIX);
    const lead = this.leadOf(floor);
    const adopted = this.adoptable(floor, planSlug);
    let row: OrderRow;
    if (adopted) {
      row = this.opts.store.update(adopted.id, { description: adopted.description || [title, description].filter(Boolean).join('\n'), lead_session: lead?.sessionId ?? null, updated_at: this.opts.now() }) as OrderRow;
    } else {
      row = this.opts.store.insert({
        slug: this.freshSlug(title),
        floor,
        title,
        description,
        source: 'director',
        planSlug,
        leadSession: lead?.sessionId ?? null,
        now: this.opts.now(),
      });
    }
    this.note({ key: 'hub.act.orderCreated', params: { floor, title: row.title } });
    this.changed(row);
    this.opts.bus.background(this.begin(row));
    return row;
  }

  // A card waiting for its brief: the one the plan made for this floor, or the one the user asked the director for.
  private adoptable(floor: string, planSlug: string | null): OrderRow | null {
    const waiting = this.opts.store.inFloor(floor, ['pendiente']).filter((row) => row.worktree_state === null && row.worktree_path === null);
    if (planSlug) return waiting.find((row) => row.source === 'plan' && row.plan_slug === planSlug) ?? null;
    return waiting.find((row) => row.source === 'panel-director') ?? null;
  }

  planExecuting(plan: { slug: string; title: string; floors: readonly string[] }): void {
    for (const floor of new Set(plan.floors)) {
      if (!this.managed(floor)) continue;
      if (this.opts.store.byPlan(plan.slug).some((row) => row.floor === floor && row.status !== 'descartado')) continue;
      const row = this.opts.store.insert({
        slug: this.freshSlug(plan.title),
        floor,
        title: plan.title,
        source: 'plan',
        planSlug: plan.slug,
        now: this.opts.now(),
      });
      this.note({ key: 'hub.act.orderCreated', params: { floor, title: row.title } });
      this.changed(row);
    }
  }

  async createFromPanel(raw: CreateOrderRequest): Promise<CreateOrderResult> {
    const title = raw.title.trim();
    const description = (raw.description ?? '').trim();
    if (!title || title.length > MAX_TITLE || description.length > MAX_DESCRIPTION || (raw.base !== undefined && !validRef(raw.base))) {
      return { ok: false, status: 400, error: { key: 'hub.api.boardFields' } };
    }
    if (!this.managed(raw.floor)) return { ok: false, status: 404, error: { key: 'hub.api.floorNotManaged' } };
    const lead = this.leadOf(raw.floor);
    const director = this.opts.book.directorSession();
    if (raw.via === 'lead' && !lead) return { ok: false, status: 409, error: { key: 'hub.api.leadClosed' } };
    if (raw.via === 'director' && !director) return { ok: false, status: 409, error: { key: 'hub.api.directorClosed' } };
    const source: OrderSource = raw.via === 'lead' ? 'panel-lead' : 'panel-director';
    const row = this.opts.store.insert({
      slug: this.freshSlug(title),
      floor: raw.floor,
      title,
      description,
      source,
      leadSession: lead?.sessionId ?? null,
      baseRef: raw.base ?? null,
      now: this.opts.now(),
    });
    this.note({ key: 'hub.act.orderCreated', params: { floor: raw.floor, title } });
    this.changed(row);
    const text = description ? `${title}\n${description}` : title;
    if (raw.via === 'lead' && lead) {
      this.opts.bus.background(this.begin(row).then(() => this.opts.order(lead.sessionId, text)));
    } else if (director) {
      const sent = await this.opts.order(
        director.sessionId,
        `Encarga a \`lead-${raw.floor}\` (el mensaje empieza por ENCARGO:) lo que pide el usuario desde el Tablero: ${title}${description ? ` — ${description}` : ''}`,
      );
      if (sent !== 'ok') {
        const gone = this.opts.store.update(row.id, { removed_at: this.opts.now() });
        if (gone) this.opts.bus.emit({ type: 'orders', data: this.list() });
        return { ok: false, status: 502, error: { key: 'hub.api.directorUnreachable' } };
      }
    }
    return { ok: true, order: this.view(this.opts.store.get(row.id) as OrderRow) };
  }

  // Folder first, then the message that tells the lead where to work.
  private async begin(order: OrderRow): Promise<void> {
    const result = await this.opts.worktrees.create(order);
    if (!result.ok) {
      const next = this.opts.store.update(order.id, { worktree_state: 'error', setup_error: `${result.error}: ${result.detail}`, updated_at: this.opts.now() }) as OrderRow;
      this.note({ key: 'hub.act.worktreeFailed', params: { slug: order.slug, reason: `${result.error}: ${result.detail}` } });
      this.changed(next);
      await this.tellLead(next, folderFailedText(next.slug, `${result.error}: ${result.detail}`));
      return;
    }
    this.changed(result.order);
    const ready = await result.ready;
    await this.tellLead(ready, folderText({ branch: ready.branch ?? '', path: ready.worktree_path ?? '', base: ready.base_ref ?? '', sha: ready.base_sha ?? '' }, this.dependencies(ready)));
  }

  async retryFolder(id: number): Promise<MoveResult> {
    const row = this.opts.store.get(id);
    if (!row) return { ok: false, status: 404, error: { key: 'hub.api.orderNotFound' } };
    if (row.worktree_state !== 'error' || row.worktree_path) return { ok: false, status: 409, error: { key: 'hub.api.orderBadState' } };
    const reset = this.opts.store.update(id, { worktree_state: null, setup_error: null }) as OrderRow;
    await this.begin(reset);
    return { ok: true, order: this.view(this.opts.store.get(id) as OrderRow) };
  }

  private dependencies(row: OrderRow): string {
    if (row.worktree_state === 'error') return `con error (${(row.setup_error ?? '').split('\n').pop() ?? ''})`.slice(0, 160);
    const floor = this.opts.config().floors[row.floor];
    return floor && setupOf(floor) ? 'listas' : 'no hacen falta';
  }

  private async tellLead(order: OrderRow, content: string): Promise<void> {
    const lead = this.leadOf(order.floor);
    if (lead?.socket) {
      try {
        await this.opts.deliver(lead.socket, encodeInbox(lead.token, content));
        if (order.lead_session !== lead.sessionId) this.opts.store.update(order.id, { lead_session: lead.sessionId });
        return;
      } catch {
        // Reported below, like a lead that is not there.
      }
    }
    this.note({ key: 'hub.act.folderUnsent', params: { slug: order.slug } });
  }

  // ---- activity -------------------------------------------------------------------------------------------

  // Every hook event asks: the first one inside the folder of a waiting card starts it.
  touch(cwd: string | null | undefined, now: number): void {
    const row = this.opts.byPath(cwd);
    if (!row || row.status === 'hecho' || row.status === 'descartado') return;
    const started = nextStatus(row.status, 'activity');
    if (started === null && now - (this.lastWrite.get(row.id) ?? 0) < TOUCH_WRITE_MS) return;
    this.lastWrite.set(row.id, now);
    const next = this.opts.store.update(row.id, started ? { status: started, last_activity: now, updated_at: now } : { last_activity: now }) as OrderRow;
    if (started) {
      this.note({ key: 'hub.act.orderMoved', params: { floor: next.floor, title: next.title, status: statusText(started) } });
      this.changed(next);
    }
  }

  // An edit in the main copy of a floor that has an order working in its own folder.
  editOutside(agent: AgentRuntime, path: string | null): void {
    if (!path || agent.floorKind !== 'managed') return;
    const floor = this.opts.config().floors[agent.floor];
    if (!floor) return;
    const root = realPath(floor.path);
    const file = realPath(path);
    if (!isInside(file, root) || isInside(file, `${root}/.claude/worktrees`)) return;
    const working = this.opts.store.inFloor(agent.floor, ['pendiente', 'en-curso', 'revision']).find((row) => row.worktree_state === 'listo' || row.worktree_state === 'preparando');
    if (!working) return;
    const now = this.opts.now();
    if (now - (this.outsideNoted.get(agent.key) ?? 0) < OUTSIDE_NOTE_MS) return;
    this.outsideNoted.set(agent.key, now);
    this.note({ key: 'hub.act.editOutsideWorktree', params: { who: agent.name ?? agent.key, slug: working.slug } }, agent.key);
  }

  // ---- moves ----------------------------------------------------------------------------------------------

  move(id: number, to: OrderStatus, force = false): MoveResult {
    const row = this.opts.store.get(id);
    if (!row) return { ok: false, status: 404, error: { key: 'hub.api.orderNotFound' } };
    const target = manualTarget(row.status, to);
    if (target === null || !BOARD_COLUMNS.includes(to)) return { ok: false, status: 409, error: { key: 'hub.api.orderBadState' } };
    if (target === 'hecho' && !force) {
      const reason = this.opts.doneBlock?.(row) ?? null;
      if (reason) return { ok: false, status: 409, error: { key: 'hub.api.moveNeedsForce', params: { reason } } };
    }
    const next = target === 'hecho' ? this.enterDone(row, '', true) : this.setStatus(row, target);
    return { ok: true, order: this.view(next) };
  }

  discard(id: number): MoveResult {
    const row = this.opts.store.get(id);
    if (!row) return { ok: false, status: 404, error: { key: 'hub.api.orderNotFound' } };
    if (nextStatus(row.status, 'discard') === null) return { ok: false, status: 409, error: { key: 'hub.api.orderBadState' } };
    const next = this.opts.store.update(id, { status: 'descartado', updated_at: this.opts.now() }) as OrderRow;
    this.note({ key: 'hub.act.orderDiscarded', params: { floor: next.floor, title: next.title } });
    this.changed(next);
    return { ok: true, order: this.view(next) };
  }

  private setStatus(row: OrderRow, status: OrderStatus): OrderRow {
    const patch = { status, updated_at: this.opts.now() };
    const next = this.opts.store.update(row.id, leavesDone(row.status, status) ? { ...patch, cycle: row.cycle + 1 } : patch) as OrderRow;
    this.note({ key: 'hub.act.orderMoved', params: { floor: next.floor, title: next.title, status: statusText(status) } });
    this.changed(next);
    return next;
  }

  // An accepted HECHO of the lead, or a move to hecho by hand.
  completed(id: number, body: string): OrderRow | null {
    const row = this.opts.store.get(id);
    if (!row || nextStatus(row.status, 'done') === null) return null;
    return this.enterDone(row, doneSummary(body), false);
  }

  private enterDone(row: OrderRow, summary: string, manual: boolean): OrderRow {
    const now = this.opts.now();
    const repeated = row.status === 'hecho';
    const next = repeated ? row : (this.opts.store.update(row.id, { status: 'hecho', updated_at: now }) as OrderRow);
    if (!repeated) {
      this.note({ key: 'hub.act.orderMoved', params: { floor: next.floor, title: next.title, status: statusText('hecho') } });
      this.changed(next);
    }
    this.announceEnd(next, summary, manual);
    return next;
  }

  // One alert per order (or plan) and cycle: the unique index drops a repeated HECHO of the same cycle.
  private announceEnd(order: OrderRow, summary: string, manual: boolean): void {
    const cards = order.plan_slug ? this.opts.store.byPlan(order.plan_slug).filter((row) => row.status !== 'descartado') : [];
    const plan = order.plan_slug !== null && cards.length > 0;
    if (plan && !cards.every((row) => row.status === 'hecho')) return;
    const now = this.opts.now();
    const cycle = plan ? Math.max(...cards.map((row) => row.cycle)) : order.cycle;
    const ref = plan ? `plan:${order.plan_slug}` : `order:${order.slug}`;
    const detail: Omit<FinishedView, 'id' | 'ts'> = {
      kind: plan ? 'plan' : 'order',
      slug: plan ? (order.plan_slug as string) : order.slug,
      title: order.title,
      floors: plan ? [...new Set(cards.map((row) => row.floor))] : [order.floor],
      branch: plan ? null : order.branch,
      summary,
      cycle,
      manual,
      checks: null,
      touched: [],
      prUrl: order.pr_url,
      orderSlugs: plan ? cards.map((row) => row.slug) : [order.slug],
    };
    const result = this.insertFinished.run(now, order.floor, order.lead_session ?? 'panel', ref, cycle, JSON.stringify(detail));
    if (result.changes === 0) return;
    const view: FinishedView = { id: Number(result.lastInsertRowid), ts: now, ...detail };
    this.opts.bus.emit({ type: 'finished', data: view });
    this.note(
      plan
        ? { key: 'hub.act.planFinished', params: { title: order.title, floors: view.floors.join(', '), cycle } }
        : manual
          ? { key: 'hub.act.orderFinishedManual', params: { floor: order.floor, title: order.title } }
          : { key: 'hub.act.orderFinished', params: { floor: order.floor, title: order.title, cycle } },
    );
  }

  finishedAlerts(): FinishedView[] {
    const out: FinishedView[] = [];
    for (const row of this.unseen.all()) {
      try {
        const detail = JSON.parse(row.detail ?? '{}') as Omit<FinishedView, 'id' | 'ts'>;
        if (typeof detail.slug === 'string') out.push({ id: row.id, ts: row.ts, ...detail });
      } catch {
        // An alert whose detail cannot be read has nothing to show.
      }
    }
    return out;
  }

  markSeen(id: number): boolean {
    return this.markSeenRow.run(this.opts.now(), id).changes > 0;
  }
}

function statusText(status: OrderStatus): HubText {
  return { key: `hub.orderStatus.${status}` } as HubText;
}
