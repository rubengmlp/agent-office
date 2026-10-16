import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES_DIR } from '../src/config';
import { orderText } from '../src/courier';
import { Office, STATUS_REQUEST, isUserPrompt, taskLine } from '../src/office';
import { BRIEF_PREFIX, parseProtocol } from '../src/protocol';
import { loadProfiles } from '../src/profiles';
import type { HookMeta } from '../src/types';
import { ev, floor, harness, keyOf, type Harness } from './helpers';

const DIRECTOR = 'dddddddd-1111-4111-8111-000000000001';
const LEAD = '22222222-bbbb-4ccc-8ddd-000000000002';
const directorMeta = (socket: string | null = null): HookMeta => ({ socket, token: null, role: 'office-director', name: 'director' });
const leadMeta: HookMeta = { socket: null, token: null, role: 'office-lead-mobile', name: 'lead-mobile' };

let h: Harness;
afterEach(() => h?.cleanup());

function office(deliver = true): string {
  h = harness(deliver ? { deliverFn: async () => {} } : {});
  const socket = join(h.root, 'director.sock');
  writeFileSync(socket, '');
  h.office.ingest(ev(DIRECTOR, h.workspace, 'SessionStart', { source: 'startup' }), directorMeta(socket));
  return socket;
}

const send = (to: string, message: string) => ev(DIRECTOR, h.workspace, 'PreToolUse', { tool_name: 'SendMessage', tool_input: { to, message } });
const brief = (to = 'lead-mobile', n = 1) => h.office.gateMessage(send(to, `ENCARGO: parte ${n} — criterios: tests — fuera: nada`));
const prompt = (text: string) => h.office.ingest(ev(DIRECTOR, h.workspace, 'UserPromptSubmit', { prompt: text }));
const decisions = (decision: string) =>
  h.db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM gate_decisions WHERE scope LIKE 'encargo:%' AND decision = ?").get(decision)?.n;
const restart = (): Office =>
  new Office({
    hubId: 'hub-test',
    db: h.db,
    config: h.config,
    profiles: loadProfiles(PROFILES_DIR),
    workspaceDir: h.workspace,
    claudeHome: join(h.root, 'claude-home'),
    gitRoot: (cwd) => cwd,
    now: () => h.clock.now,
  });
const capped = () => h.office.snapshot().activity.filter((a) => keyOf(a.summary) === 'hub.act.briefsCapped');

describe('ENCARGO prefix', () => {
  test('is not a protocol message and taskLine drops it', () => {
    expect(BRIEF_PREFIX.test('  encargo: algo')).toBe(true);
    expect(parseProtocol('ENCARGO: arregla el login — criterios: tests')).toBeNull();
    expect(taskLine('ENCARGO: arregla el login — criterios: tests')).toBe('arregla el login — criterios: tests');
    expect(taskLine(orderText('ENCARGO: arregla el login'))).toBe('arregla el login');
    expect(taskLine(orderText(STATUS_REQUEST))).toBeNull();
    expect(taskLine('HECHO: login')).toBeNull();
  });

  test('a brief to a lead sets its task and keeps the prefix out of it', () => {
    office();
    const repo = join(h.root, 'mobile');
    mkdirSync(repo, { recursive: true });
    h.config.floors.mobile = floor(repo);
    h.office.ingest(ev(LEAD, repo, 'SessionStart', { source: 'startup' }), leadMeta);
    h.office.ingest(send('lead-mobile', 'ENCARGO: pantalla de viajes — criterios: tests — fuera: pagos'));
    expect(h.office.snapshot().agents.find((a) => a.key === LEAD)?.task).toBe('pantalla de viajes — criterios: tests — fuera: pagos');
  });

  test('isUserPrompt ignores cross-session messages, chat lines and the status question', () => {
    expect(isUserPrompt('Haz el login')).toBe(true);
    expect(isUserPrompt(orderText('Haz el login'))).toBe(true);
    expect(isUserPrompt('<cross-session-message from="lead-mobile">listo</cross-session-message>')).toBe(false);
    expect(isUserPrompt('<teammate-message>x</teammate-message>')).toBe(false);
    expect(isUserPrompt('[Chat de Agent Office] #global\nusuario: hola')).toBe(false);
    expect(isUserPrompt(orderText(STATUS_REQUEST))).toBe(false);
    expect(isUserPrompt('')).toBe(false);
    expect(isUserPrompt(null)).toBe(false);
  });
});

describe('brief budget', () => {
  test('the fourth brief to leads since the last user instruction is blocked and recorded', () => {
    office();
    for (const n of [1, 2, 3]) {
      h.clock.advance(1000);
      expect(brief('lead-mobile', n).pass).toBe(true);
    }
    h.clock.advance(1000);
    const blocked = brief('lead-backend', 4);
    expect(blocked.pass).toBe(false);
    expect(blocked.reason).toContain('Tope de encargos: ya has enviado 3 encargos');
    expect(blocked.reason).toContain('limits.maxBriefsPerOrder = 3');
    expect(blocked.reason).toContain('AskUserQuestion');
    expect(brief('lead-backend', 5).pass).toBe(false);
    expect([decisions('pass'), decisions('block')]).toEqual([3, 2]);
    expect(capped().map((a) => a.summary)).toEqual([
      { key: 'hub.act.briefsCapped', params: { n: 3, max: 3 } },
      { key: 'hub.act.briefsCapped', params: { n: 3, max: 3 } },
    ]);
  });

  test('messages without the prefix, to non-leads or from other roles do not count', () => {
    office();
    for (let n = 0; n < 6; n += 1) {
      expect(h.office.gateMessage(send('lead-mobile', `Mira esto ${n}`)).pass).toBe(true);
      expect(brief('director', n).pass).toBe(true);
      expect(brief('tester-mobile', n).pass).toBe(true);
    }
    const lead = h.office.gateMessage(ev(LEAD, h.workspace, 'PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'lead-backend', message: 'ENCARGO: x' } }));
    expect(lead.pass).toBe(true);
    expect([decisions('pass'), decisions('block')]).toEqual([0, 0]);
    for (const n of [1, 2, 3]) expect(brief('lead-mobile', n).pass).toBe(true);
  });

  test('only a pass written by the gate counts: the same message through ingest does not', () => {
    office();
    for (let n = 0; n < 5; n += 1) h.office.ingest(send('lead-mobile', `ENCARGO: parte ${n}`));
    for (const n of [1, 2, 3]) expect(brief('lead-mobile', n).pass).toBe(true);
    expect(brief().pass).toBe(false);
  });

  test('a reply from another session does not reset the count, a user prompt and an answer do', () => {
    office();
    for (const n of [1, 2, 3]) brief('lead-mobile', n);
    h.clock.advance(1000);
    prompt('<cross-session-message from="lead-mobile">HECHO: listo</cross-session-message>');
    prompt('[Chat de Agent Office] #global\nusuario: hola');
    prompt(orderText(STATUS_REQUEST));
    expect(brief().pass).toBe(false);

    h.clock.advance(1000);
    prompt('Reparte el trabajo del login');
    h.clock.advance(1000);
    for (const n of [1, 2, 3]) expect(brief('lead-mobile', n).pass).toBe(true);
    expect(brief().pass).toBe(false);

    h.clock.advance(1000);
    h.office.ingest(ev(DIRECTOR, h.workspace, 'PostToolUse', { tool_name: 'AskUserQuestion', tool_input: { questions: [] } }));
    h.clock.advance(1000);
    expect(brief().pass).toBe(true);
  });

  test('a panel order resets the count even though its text does not look like a prompt', async () => {
    office();
    for (const n of [1, 2, 3]) brief('lead-mobile', n);
    expect(brief().pass).toBe(false);
    h.clock.advance(1000);
    expect(await h.office.order(DIRECTOR, '<no parece una instrucción>')).toBe('ok');
    h.clock.advance(1000);
    expect(brief().pass).toBe(true);
  });

  test('a status request does not reset the count', async () => {
    office();
    for (const n of [1, 2, 3]) brief('lead-mobile', n);
    h.clock.advance(1000);
    expect(await h.office.requestStatus(DIRECTOR)).toBe('ok');
    expect(brief().pass).toBe(false);
  });

  test('the count survives a restart of the hub', () => {
    office();
    for (const n of [1, 2, 3]) brief('lead-mobile', n);
    h.clock.advance(1000);
    const restarted = restart();
    expect(restarted.snapshot().sessions.map((s) => s.sessionId)).toEqual([DIRECTOR]);
    expect(restarted.gateMessage(send('lead-mobile', 'ENCARGO: cuarto')).pass).toBe(false);
  });

  test('the last user instruction is read back from the stored events after a restart', () => {
    office();
    h.clock.advance(1000);
    prompt('Primera instrucción');
    for (const n of [1, 2, 3]) {
      h.clock.advance(1000);
      brief('lead-mobile', n);
    }
    h.clock.advance(1000);
    prompt('<cross-session-message>respuesta</cross-session-message>');
    const restarted = restart();
    expect(restarted.gateMessage(send('lead-mobile', 'ENCARGO: cuarto')).pass).toBe(false);
    h.clock.advance(1000);
    h.office.ingest(ev(DIRECTOR, h.workspace, 'UserPromptSubmit', { prompt: 'Otra cosa' }));
    const again = restart();
    expect(again.gateMessage(send('lead-mobile', 'ENCARGO: nuevo')).pass).toBe(true);
  });

  test('maxBriefsPerOrder 0 turns the budget off', () => {
    office();
    h.config.limits.maxBriefsPerOrder = 0;
    for (let n = 1; n <= 8; n += 1) expect(brief('lead-mobile', n).pass).toBe(true);
    expect(decisions('block')).toBe(0);
  });
});
