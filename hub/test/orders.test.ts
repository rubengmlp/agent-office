import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FloorDirtyError } from '../src/floor-data';
import { BOARD_COLUMNS, doneSummary, leavesDone, manualTarget, nextStatus, orderSlug, randomSuffix, splitBrief } from '../src/orders';
import { BRIEF_PREFIX } from '../src/protocol';
import { planSlugIn } from '../src/tokens';
import type { ActivityView, FinishedView, OrderStatus } from '../src/types';
import { DIRECTOR, LEAD, PLAN, boardOrders, brief, checksConfig, deliveryRig, eventIn, leadMessages, newOrder, orderOf, seedPlan, startDirector, startLead, write, type Rig } from './delivery-rig';
import { git } from './helpers';

let rig: Rig | undefined;
afterEach(() => {
  rig?.h.cleanup();
  rig = undefined;
});

const ALL: OrderStatus[] = ['pendiente', 'en-curso', 'revision', 'hecho', 'descartado'];

describe('transitions', () => {
  test('the first activity starts a waiting card and nothing else does', () => {
    expect(nextStatus('pendiente', 'activity')).toBe('en-curso');
    for (const from of ALL.filter((s) => s !== 'pendiente')) expect(nextStatus(from, 'activity')).toBeNull();
  });

  test('an accepted HECHO finishes any open card, or sends it to revision when a review is pending', () => {
    for (const from of ['pendiente', 'en-curso', 'revision'] as const) {
      expect(nextStatus(from, 'done')).toBe('hecho');
      expect(nextStatus(from, 'done', true)).toBe('revision');
    }
    expect(nextStatus('hecho', 'done')).toBe('hecho');
    expect(nextStatus('hecho', 'done', true)).toBe('hecho');
    expect(nextStatus('descartado', 'done')).toBeNull();
  });

  test('a discarded card does not come back and discarding is not a move by hand', () => {
    for (const from of ALL.filter((s) => s !== 'descartado')) expect(nextStatus(from, 'discard')).toBe('descartado');
    expect(nextStatus('descartado', 'discard')).toBeNull();
    for (const to of ALL) expect(manualTarget('descartado', to)).toBeNull();
    for (const from of ALL) expect(manualTarget(from, 'descartado')).toBeNull();
  });

  test('a move by hand goes where it is told, leaving hecho always reopens as en-curso', () => {
    for (const from of ['pendiente', 'en-curso', 'revision'] as const) {
      for (const to of BOARD_COLUMNS) expect(manualTarget(from, to)).toBe(from === to ? null : to);
    }
    for (const to of ['pendiente', 'en-curso', 'revision'] as const) expect(manualTarget('hecho', to)).toBe('en-curso');
    expect(manualTarget('hecho', 'hecho')).toBeNull();
    expect(leavesDone('hecho', 'en-curso')).toBe(true);
    expect(leavesDone('en-curso', 'hecho')).toBe(false);
    expect(leavesDone('hecho', 'hecho')).toBe(false);
  });

  test('slugs and briefs', () => {
    expect(orderSlug('Pantalla de login (Apple)', 'a1b2')).toBe('pantalla-de-login-apple-a1b2');
    expect(orderSlug('¡¡¡', 'a1b2')).toBe('encargo-a1b2');
    expect(orderSlug('x'.repeat(100), 'a1b2').length).toBe(45);
    expect(randomSuffix(() => 0)).toBe('aaaa');
    expect(randomSuffix(() => 0.9999)).toBe('9999');
    expect(splitBrief('ENCARGO: Login — qué se hace — criterios: x — fuera: y\nmás detalle\notra línea', BRIEF_PREFIX)).toEqual({
      title: 'Login',
      description: 'qué se hace — criterios: x — fuera: y\nmás detalle\notra línea',
    });
    expect(splitBrief('ENCARGO: Solo una frase', BRIEF_PREFIX)).toEqual({ title: 'Solo una frase', description: '' });
    expect(splitBrief('ENCARGO: Con-guion-pegado y más', BRIEF_PREFIX).title).toBe('Con-guion-pegado y más');
    const long = splitBrief(`ENCARGO: ${'a'.repeat(150)}`, BRIEF_PREFIX);
    expect(long.title).toHaveLength(100);
    expect(long.description).toBe('a'.repeat(150));
  });

  test('the summary of a HECHO drops its prefix and the encargo it names', () => {
    expect(doneSummary('HECHO: encargo/login-a1b2 — login listo — pendiente: Android')).toBe('login listo — pendiente: Android');
    expect(doneSummary('HECHO: `encargo/login-a1b2`: listo')).toBe('listo');
    expect(doneSummary('hecho: encargo/login-a1b2')).toBe('');
    expect(doneSummary('HECHO: pantalla de viajes — validado')).toBe('pantalla de viajes — validado');
    expect(doneSummary(`HECHO: ${'x'.repeat(700)}`)).toHaveLength(600);
  });

  test('encargo/<slug> labels the tokens of an order and never collides with a plan', () => {
    expect(planSlugIn('[Agent Office] CARPETA: encargo/login-a1b2 → /r/x')).toBe('encargo/login-a1b2');
    expect(planSlugIn('mira redaccion/planes/login.md y encargo/otro-1111')).toBe('login');
    expect(planSlugIn('la rama feature/encargo/x no cuenta')).toBeNull();
    expect(planSlugIn('encargo/')).toBeNull();
    expect(planSlugIn(null)).toBeNull();
  });
});

describe('an ENCARGO of the director', () => {
  test('creates the card, the branch and the folder, and tells the lead where to work', async () => {
    rig = deliveryRig();
    const decision = brief(rig, 'ENCARGO: Pantalla de login — criterios: que compile — fuera: nada');
    expect(decision.pass).toBe(true);
    const [card] = boardOrders(rig);
    expect(card).toMatchObject({ title: 'Pantalla de login', description: 'criterios: que compile — fuera: nada', floor: 'mobile', status: 'pendiente', source: 'director', lead: 'lead-mobile', cycle: 1 });
    await rig.h.office.idle();
    const made = orderOf(rig, card?.slug ?? '');
    expect(made.branch).toBe(`encargo/${made.slug}`);
    expect(made.worktree).toMatchObject({ state: 'listo', stale: false });
    const folder = join(rig.repo, '.claude', 'worktrees', `office-${made.slug}`);
    expect(made.worktree?.path).toBe(folder);
    expect(git(folder, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(made.branch ?? '');
    expect(made.base).toBe('origin/develop');
    const folderMessage = rig.sent.find((m) => m.text.includes('CARPETA'));
    expect(folderMessage?.text).toBe(`[Agent Office] CARPETA: encargo/${made.slug} → ${folder} (base origin/develop@${made.baseSha?.slice(0, 7)}; dependencias: no hacen falta)`);
    expect(folderMessage?.socket).toBe(join(rig.h.root, 'lead.sock'));
    expect(rig.h.messages.filter((m) => m.type === 'order')).not.toHaveLength(0);
  });

  test('a brief that is not for a managed lead or not from the director makes no card', async () => {
    rig = deliveryRig();
    expect(brief(rig, 'ENCARGO: x', 'lead-redaccion').pass).toBe(true);
    expect(brief(rig, 'ENCARGO: x', 'lead-otra').pass).toBe(true);
    expect(brief(rig, 'Una pregunta sin prefijo').pass).toBe(true);
    rig.h.office.gateMessage({
      session_id: LEAD,
      cwd: rig.repo,
      hook_event_name: 'PreToolUse',
      tool_name: 'SendMessage',
      tool_input: { to: 'lead-mobile', message: 'ENCARGO: yo mismo' },
    });
    await rig.h.office.idle();
    expect(boardOrders(rig)).toEqual([]);
  });

  test('a brief blocked by the budget makes no card', async () => {
    rig = deliveryRig({ configure: (config) => (config.limits.maxBriefsPerOrder = 1) });
    expect(brief(rig, 'ENCARGO: primero').pass).toBe(true);
    expect(brief(rig, 'ENCARGO: segundo').pass).toBe(false);
    await rig.h.office.idle();
    expect(boardOrders(rig)).toHaveLength(1);
  });

  test('the first event inside the folder starts the card; events elsewhere do not', async () => {
    rig = deliveryRig();
    const card = await newOrder(rig);
    eventIn(rig, rig.repo);
    expect(orderOf(rig, card.slug).status).toBe('pendiente');
    const folder = card.worktree?.path ?? '';
    rig.h.clock.advance(5000);
    eventIn(rig, join(folder, 'lib'));
    const started = orderOf(rig, card.slug);
    expect(started.status).toBe('en-curso');
    expect(started.lastActivity).toBe(rig.h.clock.now);
    expect(rig.h.messages.some((m) => m.type === 'order' && m.data.slug === card.slug && m.data.status === 'en-curso')).toBe(true);
  });

  test('a folder that cannot be created leaves the card with the error and tells the lead not to start', async () => {
    rig = deliveryRig({ configure: (config) => (config.floors.mobile.baseBranch = 'no-existe') });
    brief(rig, 'ENCARGO: Algo');
    await rig.h.office.idle();
    const [card] = boardOrders(rig);
    expect(card?.worktree).toMatchObject({ state: 'error' });
    expect(card?.worktree?.error).toContain('base');
    expect(rig.sent.at(-1)?.text).toContain('sin carpeta');
    expect(rig.h.office.snapshot().activity.map((a) => a.summary)).toContainEqual(expect.objectContaining({ key: 'hub.act.worktreeFailed' }));
    expect(existsSync(join(rig.repo, '.claude', 'worktrees'))).toBe(false);
  });

  test('retrying the folder after the cause is fixed creates it', async () => {
    rig = deliveryRig({ configure: (config) => (config.floors.mobile.baseBranch = 'no-existe') });
    brief(rig, 'ENCARGO: Algo');
    await rig.h.office.idle();
    const [card] = boardOrders(rig);
    rig.h.config.floors.mobile.baseBranch = 'develop';
    const result = await rig.h.office.retryOrderFolder(card?.id ?? 0);
    expect(result.ok).toBe(true);
    await rig.h.office.idle();
    expect(orderOf(rig, card?.slug ?? '').worktree).toMatchObject({ state: 'listo' });
    expect((await rig.h.office.retryOrderFolder(card?.id ?? 0)).ok).toBe(false);
  });

  test('a brief that names another encargo does not make a plan of it', async () => {
    rig = deliveryRig();
    brief(rig, 'ENCARGO: Seguir lo de encargo/otro-1111 — y redaccion/planes/login.md');
    await rig.h.office.idle();
    expect(boardOrders(rig)[0]?.planSlug).toBe('login');
    brief(rig, 'ENCARGO: Rematar encargo/otro-2222');
    await rig.h.office.idle();
    expect(boardOrders(rig)[1]?.planSlug).toBeNull();
  });

  test('retrying a folder whose setup failed runs it again and tells the lead when it is ready', async () => {
    // The setup of the floor is a real command in the folder: it fails until the marker file exists.
    rig = deliveryRig({ configure: (config) => (config.floors.mobile!.setup = 'test -f .deps-ready') });
    brief(rig, 'ENCARGO: Algo con dependencias');
    await rig.h.office.idle();
    const [card] = boardOrders(rig);
    expect(card?.worktree).toMatchObject({ state: 'error' });
    expect(rig.sent.at(-1)?.text).toContain('dependencias: con error');
    write(card?.worktree?.path ?? '', '.deps-ready', '1');
    const retried = await rig.h.office.retryOrderFolder(card?.id ?? 0);
    expect(retried).toMatchObject({ ok: true, order: { worktree: { state: 'listo' } } });
    expect(rig.sent.at(-1)?.text).toContain('dependencias: listas');
    expect((await rig.h.office.retryOrderFolder(card?.id ?? 0)).ok).toBe(false);
  });

  test('the tokens of an order are the ones labelled encargo/<slug>', async () => {
    rig = deliveryRig();
    const card = await newOrder(rig);
    rig.h.db
      .query("INSERT INTO token_usage (day, agent_key, session_id, floor, model, plan_slug, turns, input, output, updated_at) VALUES ('2026-10-17', 'a', 's', 'mobile', 'm', ?, 2, 100, 50, 1)")
      .run(`encargo/${card.slug}`);
    expect(orderOf(rig, card.slug).tokens).toMatchObject({ turns: 2, input: 100, output: 50 });
  });
});

describe('the plan that is executed', () => {
  test('makes a pending card per managed floor of the plan, and the ENCARGO of that plan adopts it', async () => {
    rig = deliveryRig();
    seedPlan(rig, ['mobile', 'backend']);
    expect(await rig.h.office.decidePlan(PLAN, 'ejecutar')).toBe('ok');
    const cards = boardOrders(rig);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ floor: 'mobile', title: 'Login con Apple', status: 'pendiente', source: 'plan', planSlug: 'login', worktree: null });
    expect(await rig.h.office.decidePlan(PLAN, 'aparcar')).toBe('ok');
    expect(await rig.h.office.decidePlan(PLAN, 'ejecutar')).toBe('ok');
    expect(boardOrders(rig)).toHaveLength(1);

    brief(rig, `ENCARGO: parte de mobile del plan ${PLAN} — criterios: x`);
    await rig.h.office.idle();
    const after = boardOrders(rig);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: cards[0]?.id, slug: cards[0]?.slug, source: 'plan', planSlug: 'login', worktree: { state: 'listo' } });
    expect(after[0]?.description).toContain('parte de mobile');
    expect(rig.sent.some((m) => m.text.includes(`CARPETA: encargo/${cards[0]?.slug}`))).toBe(true);
  });

  test('an analysis plan makes no cards', async () => {
    rig = deliveryRig();
    seedPlan(rig);
    await Bun.write(join(rig.docs, PLAN), '# Auditoría\n> Tipo: análisis\n\n## Pasos\n1. x\n');
    rig.h.office.refreshDocuments();
    expect(await rig.h.office.decidePlan(PLAN, 'ejecutar')).toBe('ok');
    expect(boardOrders(rig)).toEqual([]);
  });
});

describe('a new order from the panel', () => {
  test('through the lead: card, folder, CARPETA and then the order itself', async () => {
    rig = deliveryRig();
    const result = await rig.h.office.createOrder({ floor: 'mobile', title: 'Arreglar el logout', description: 'Falla al cerrar sesión', via: 'lead' });
    expect(result).toMatchObject({ ok: true, order: { source: 'panel-lead', status: 'pendiente', title: 'Arreglar el logout' } });
    await rig.h.office.idle();
    expect(rig.sent.map((m) => m.text)).toEqual([
      expect.stringContaining('CARPETA: encargo/arreglar-el-logout-'),
      '[Agent Office] Orden del usuario desde el panel de la oficina: Arreglar el logout\nFalla al cerrar sesión',
    ]);
    expect(boardOrders(rig)[0]?.worktree).toMatchObject({ state: 'listo' });
  });

  test('through the director: the director is asked and the card waits for his ENCARGO', async () => {
    rig = deliveryRig();
    const result = await rig.h.office.createOrder({ floor: 'mobile', title: 'Migrar pagos', description: 'a Stripe', via: 'director' });
    expect(result.ok).toBe(true);
    expect(rig.sent).toHaveLength(1);
    expect(rig.sent[0]?.socket).toBe(join(rig.h.root, 'director.sock'));
    expect(rig.sent[0]?.text).toContain('Encarga a `lead-mobile`');
    expect(rig.sent[0]?.text).toContain('Migrar pagos — a Stripe');
    expect(boardOrders(rig)[0]).toMatchObject({ source: 'panel-director', worktree: null });
    brief(rig, 'ENCARGO: Migrar pagos a Stripe — criterios: x');
    await rig.h.office.idle();
    const orders = boardOrders(rig);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ title: 'Migrar pagos', source: 'panel-director', worktree: { state: 'listo' } });
  });

  test('refuses what cannot be done and leaves nothing behind', async () => {
    rig = deliveryRig({ lead: false, director: false });
    const request = { floor: 'mobile', title: 'x', via: 'lead' as const };
    expect(await rig.h.office.createOrder(request)).toMatchObject({ ok: false, status: 409, error: { key: 'hub.api.leadClosed' } });
    expect(await rig.h.office.createOrder({ ...request, via: 'director' })).toMatchObject({ ok: false, status: 409, error: { key: 'hub.api.directorClosed' } });
    expect(await rig.h.office.createOrder({ ...request, floor: 'otra' })).toMatchObject({ ok: false, status: 404 });
    expect(await rig.h.office.createOrder({ ...request, title: '  ' })).toMatchObject({ ok: false, status: 400 });
    expect(await rig.h.office.createOrder({ ...request, title: 'x'.repeat(121) })).toMatchObject({ ok: false, status: 400 });
    expect(await rig.h.office.createOrder({ ...request, base: '--evil' })).toMatchObject({ ok: false, status: 400 });
    expect(boardOrders(rig)).toEqual([]);
  });

  test('an unreachable director removes the card it made', async () => {
    rig = deliveryRig();
    rig.h.office.ingest({ session_id: DIRECTOR, cwd: rig.h.workspace, hook_event_name: 'SessionEnd', reason: 'other' });
    startDirector(rig);
    const result = await rig.h.office.createOrder({ floor: 'mobile', title: 'x', via: 'director' });
    expect(result.ok).toBe(true);
    const socket = join(rig.h.root, 'director.sock');
    await Bun.$`rm ${socket}`;
    const failed = await rig.h.office.createOrder({ floor: 'mobile', title: 'y', via: 'director' });
    expect(failed).toMatchObject({ ok: false, status: 502 });
    expect(boardOrders(rig).map((o) => o.title)).toEqual(['x']);
  });
});

function finished(rig: Rig): FinishedView[] {
  return rig.h.office.snapshot().finished;
}

const feed = (rig: Rig): ActivityView[] => rig.h.office.snapshot().activity;

describe('moves by hand and the finish alert', () => {
  test('a move to hecho by hand makes the alert marked manual, once per cycle', async () => {
    rig = deliveryRig();
    const card = await newOrder(rig);
    expect(rig.h.office.moveOrder(card.id, 'en-curso')).toMatchObject({ ok: true, order: { status: 'en-curso' } });
    expect(finished(rig)).toEqual([]);
    const done = rig.h.office.moveOrder(card.id, 'hecho');
    expect(done).toMatchObject({ ok: true, order: { status: 'hecho', cycle: 1 } });
    expect(finished(rig)).toEqual([
      expect.objectContaining({ kind: 'order', slug: card.slug, title: card.title, floors: ['mobile'], branch: card.branch, cycle: 1, manual: true, summary: '' }),
    ]);
    expect(rig.h.messages.filter((m) => m.type === 'finished')).toHaveLength(1);
    expect(feed(rig).map((a) => a.summary)).toContainEqual({ key: 'hub.act.orderFinishedManual', params: { floor: 'mobile', title: card.title } });
    expect(rig.h.office.moveOrder(card.id, 'hecho')).toMatchObject({ ok: false, status: 409 });
    expect(finished(rig)).toHaveLength(1);
  });

  test('leaving hecho reopens as en-curso with a new cycle and finishing again alerts the cycle 2', async () => {
    rig = deliveryRig();
    const card = await newOrder(rig);
    rig.h.office.moveOrder(card.id, 'hecho');
    const back = rig.h.office.moveOrder(card.id, 'revision');
    expect(back).toMatchObject({ ok: true, order: { status: 'en-curso', cycle: 2 } });
    rig.h.office.moveOrder(card.id, 'hecho');
    expect(finished(rig).map((f) => f.cycle)).toEqual([1, 2]);
    expect(rig.h.office.moveOrder(card.id, 'pendiente')).toMatchObject({ ok: true, order: { status: 'en-curso', cycle: 3 } });
    expect(finished(rig)).toHaveLength(2);
  });

  test('moves that make no sense are refused', async () => {
    rig = deliveryRig();
    const card = await newOrder(rig);
    expect(rig.h.office.moveOrder(card.id, 'pendiente')).toMatchObject({ ok: false, status: 409 });
    expect(rig.h.office.moveOrder(card.id, 'descartado')).toMatchObject({ ok: false, status: 409 });
    expect(rig.h.office.moveOrder(9999, 'hecho')).toMatchObject({ ok: false, status: 404 });
    rig.h.office.discardOrder(card.id);
    expect(rig.h.office.moveOrder(card.id, 'en-curso')).toMatchObject({ ok: false, status: 409 });
    expect(rig.h.office.discardOrder(card.id)).toMatchObject({ ok: false, status: 409 });
    expect(finished(rig)).toEqual([]);
    expect(orderOf(rig, card.slug).status).toBe('descartado');
  });

  test('a plan is finished when its last card is done, and reopening one card alerts again when all are done', async () => {
    rig = deliveryRig({ configure: (config, repo) => (config.floors.web = { ...config.floors.mobile, path: repo }) });
    seedPlan(rig, ['mobile', 'web']);
    expect(await rig.h.office.decidePlan(PLAN, 'ejecutar')).toBe('ok');
    const [first, second] = boardOrders(rig);
    expect(boardOrders(rig)).toHaveLength(2);
    rig.h.office.moveOrder(first?.id ?? 0, 'hecho');
    expect(finished(rig)).toEqual([]);
    rig.h.office.moveOrder(second?.id ?? 0, 'hecho');
    expect(finished(rig)).toEqual([expect.objectContaining({ kind: 'plan', slug: 'login', title: 'Login con Apple', floors: ['mobile', 'web'], cycle: 1, orderSlugs: [first?.slug, second?.slug] })]);
    rig.h.office.moveOrder(first?.id ?? 0, 'en-curso');
    expect(finished(rig)).toHaveLength(1);
    rig.h.office.moveOrder(first?.id ?? 0, 'hecho');
    expect(finished(rig).map((f) => [f.kind, f.cycle])).toEqual([['plan', 1], ['plan', 2]]);
    expect(feed(rig).map((a) => a.summary)).toContainEqual({ key: 'hub.act.planFinished', params: { title: 'Login con Apple', floors: 'mobile, web', cycle: 2 } });
  });

  test('seen marks the alert and the snapshot rebuilds only the unseen ones', async () => {
    rig = deliveryRig();
    const a = await newOrder(rig, 'Uno');
    const b = await newOrder(rig, 'Dos');
    rig.h.office.moveOrder(a.id, 'hecho');
    rig.h.office.moveOrder(b.id, 'hecho');
    const [one, two] = finished(rig);
    expect(finished(rig)).toHaveLength(2);
    expect(rig.h.office.markFinishedSeen(one?.id ?? 0)).toBe(true);
    expect(rig.h.office.markFinishedSeen(one?.id ?? 0)).toBe(false);
    expect(finished(rig).map((f) => f.id)).toEqual([two?.id]);
    expect(rig.h.office.markFinishedSeen(99999)).toBe(false);
    expect(rig.h.office.snapshot().alerts).toEqual([]);
  });

  test('a discarded card makes no alert and keeps its folder for the expiry', async () => {
    rig = deliveryRig();
    const card = await newOrder(rig);
    rig.h.office.discardOrder(card.id);
    expect(finished(rig)).toEqual([]);
    expect(existsSync(card.worktree?.path ?? '')).toBe(true);
    expect(readFileSync(join(card.worktree?.path ?? '', 'README.md'), 'utf8')).toContain('app');
  });
});

describe('the snapshot and the edits outside the folder', () => {
  test('the snapshot carries the open cards and at most the last hundred closed ones', async () => {
    rig = deliveryRig();
    const card = await newOrder(rig);
    expect(rig.h.office.snapshot().orders.map((o) => o.slug)).toEqual([card.slug]);
    for (let i = 0; i < 105; i += 1) {
      rig.h.db.query("INSERT INTO orders (slug, floor, title, status, source, created_at, updated_at) VALUES (?, 'mobile', 'viejo', 'hecho', 'director', 1, ?)").run(`viejo-${i}`, i + 1);
    }
    const orders = rig.h.office.snapshot().orders;
    expect(orders).toHaveLength(101);
    expect(orders.some((o) => o.slug === 'viejo-0')).toBe(false);
    expect(orders.some((o) => o.slug === 'viejo-104')).toBe(true);
  });

  test('editing the main copy while an order works in its folder is reported once in a while', async () => {
    rig = deliveryRig();
    const card = await newOrder(rig);
    const edit = (cwd: string) =>
      rig?.h.office.ingest({
        session_id: LEAD,
        agent_id: 'a-dev-1',
        agent_type: 'office-dev-mobile',
        cwd,
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: join(cwd, 'lib', 'a.dart') },
      });
    const notes = () => feed(rig as Rig).filter((a) => typeof a.summary !== 'string' && a.summary.key === 'hub.act.editOutsideWorktree');
    edit(card.worktree?.path ?? '');
    expect(notes()).toHaveLength(0);
    edit(rig.repo);
    expect(notes()).toHaveLength(1);
    expect(notes()[0]?.summary).toMatchObject({ params: { slug: card.slug, who: expect.any(String) } });
    edit(rig.repo);
    expect(notes()).toHaveLength(1);
    rig.h.clock.advance(6 * 60_000);
    edit(rig.repo);
    expect(notes()).toHaveLength(2);
  });
});

describe('removing a floor with order folders', () => {
  test('dirty folders stop it unless forced, clean ones are retired with it', async () => {
    rig = deliveryRig({ lead: false, director: false });
    const card = await rig.h.office.createOrder({ floor: 'mobile', title: 'Uno', via: 'lead' }).catch(() => null);
    expect(card).toMatchObject({ ok: false });
    startLead(rig);
    const made = await newOrderFromPanel(rig, 'Uno');
    const path = made.worktree?.path ?? '';
    write(path, 'sin-guardar.txt', 'x');
    await expect(rig.h.office.forgetFloor('mobile', rig.repo)).rejects.toBeInstanceOf(FloorDirtyError);
    expect(existsSync(path)).toBe(true);
    expect(boardOrders(rig)).toHaveLength(1);
    await rig.h.office.idle();
    rig.h.office.ingest({ session_id: LEAD, cwd: rig.repo, hook_event_name: 'SessionEnd', reason: 'other' });
    const result = await rig.h.office.forgetFloor('mobile', rig.repo, true);
    expect(result.rows).toBeGreaterThan(0);
    expect(existsSync(path)).toBe(false);
    expect(boardOrders(rig)).toEqual([]);
  });
});

async function newOrderFromPanel(r: Rig, title: string) {
  const created = await r.h.office.createOrder({ floor: 'mobile', title, via: 'lead' });
  if (!created.ok) throw new Error('create');
  await r.h.office.idle();
  return orderOf(r, created.order.slug);
}

describe('the encargo script', () => {
  const lead = { socket: null, token: 'lead-token', role: 'office-lead-mobile', name: 'lead-mobile' };
  const ask = (r: Rig, order: string, extra: Partial<{ slug: string; reason: string; cwd: string }> = {}, meta = lead) =>
    r.h.office.orderScript({ order, cwd: r.repo, ...extra }, meta);

  test('estado lists the open orders with folder and checks, carpeta gives the folder', async () => {
    rig = deliveryRig({ configure: checksConfig(['uno', 'exit 0']) });
    expect(await ask(rig, 'estado')).toEqual({ status: 200, text: 'No hay encargos abiertos en esta planta.' });
    expect(await ask(rig, 'carpeta')).toMatchObject({ status: 404, text: 'ERROR: no hay ningún encargo abierto en esta planta.' });
    const card = await newOrder(rig, 'Pantalla de login');
    const folder = card.worktree?.path ?? '';
    const status = await ask(rig, 'estado');
    expect(status.status).toBe(200);
    expect(status.text).toContain(`encargo/${card.slug} [pendiente] Pantalla de login`);
    expect(status.text).toContain('comprobaciones: sin ejecutar');
    const carpeta = await ask(rig, 'carpeta');
    expect(carpeta.text).toBe(`encargo/${card.slug} → ${folder} (base origin/develop@${card.baseSha?.slice(0, 7)}; dependencias: no hacen falta)`);
    expect(await ask(rig, 'carpeta', { slug: `encargo/${card.slug}` })).toEqual(carpeta);
    write(folder, 'lib/a.txt', 'a');
    expect(await ask(rig, 'carpeta', { cwd: join(folder, 'lib') })).toEqual(carpeta);
  });

  test('with several open orders the lead has to say which, or be inside one', async () => {
    rig = deliveryRig();
    const first = await newOrder(rig, 'Uno');
    const second = await newOrder(rig, 'Dos');
    const ambiguous = await ask(rig, 'carpeta');
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.text).toContain(`encargo/${first.slug}, encargo/${second.slug}`);
    expect((await ask(rig, 'carpeta', { slug: second.slug })).text).toContain(`encargo/${second.slug} →`);
    expect((await ask(rig, 'carpeta', { cwd: second.worktree?.path ?? '' })).text).toContain(`encargo/${second.slug} →`);
    expect((await ask(rig, 'carpeta', { slug: 'no-existe' })).text).toBe('ERROR: no existe encargo/no-existe en esta planta.');
  });

  test('comprobar starts the checks and the lead hears the result', async () => {
    rig = deliveryRig({ configure: checksConfig(['uno', 'exit 0'], ['dos', 'exit 0']) });
    const card = await newOrder(rig);
    const started = await ask(rig, 'comprobar');
    expect(started).toEqual({ status: 200, text: `Comprobaciones de encargo/${card.slug} lanzadas (uno, dos). Te aviso con COMPROBACIONES cuando terminen.` });
    await rig.h.office.idle();
    expect(leadMessages(rig).at(-1)).toContain(`COMPROBACIONES encargo/${card.slug} en verde`);
    expect((await ask(rig, 'estado')).text).toContain('comprobaciones: verde 2/2');
    rig.h.config.floors.mobile!.checks = [];
    expect(await ask(rig, 'comprobar')).toMatchObject({ status: 409, text: 'ERROR: esta planta no tiene comprobaciones configuradas.' });
  });

  test('descartar needs a reason, discards the card and keeps the reason', async () => {
    rig = deliveryRig();
    const card = await newOrder(rig);
    expect(await ask(rig, 'descartar', { slug: card.slug })).toMatchObject({ status: 400 });
    expect(await ask(rig, 'descartar', { slug: card.slug, reason: 'x' })).toMatchObject({ status: 400 });
    const result = await ask(rig, 'descartar', { slug: card.slug, reason: 'ya no hace falta' });
    expect(result.status).toBe(200);
    const after = orderOf(rig, card.slug);
    expect(after.status).toBe('descartado');
    expect(after.description).toContain('Descartado: ya no hace falta');
    expect(await ask(rig, 'descartar', { slug: card.slug, reason: 'otra vez' })).toMatchObject({ status: 409 });
    expect(finishedAlerts(rig)).toEqual([]);
  });

  test('a folder outside the office, an unknown session or an unknown order is refused', async () => {
    rig = deliveryRig();
    expect(await rig.h.office.orderScript({ order: 'estado', cwd: rig.h.root }, lead)).toMatchObject({ status: 404 });
    expect(await rig.h.office.orderScript({ order: 'estado' }, lead)).toMatchObject({ status: 404 });
    expect(await ask(rig, 'estado', {}, { ...lead, token: 'otro' })).toMatchObject({ status: 403 });
    expect(await rig.h.office.orderScript({ order: 'estado', cwd: rig.repo }, { socket: null, token: null, role: null, name: null })).toMatchObject({ status: 403 });
    expect(await ask(rig, 'inventada')).toMatchObject({ status: 404 });
    await newOrder(rig);
    expect(await ask(rig, 'inventada')).toMatchObject({ status: 400, text: 'ERROR: orden desconocida.' });
  });
});

const finishedAlerts = (r: Rig) => r.h.office.snapshot().finished;
