import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_DIR } from '../src/config';
import { tempDir } from './helpers';

const EMIT = join(PLUGIN_DIR, 'hooks', 'emit.sh');
const GATE = join(PLUGIN_DIR, 'hooks', 'gate.sh');
const GUARD = join(PLUGIN_DIR, 'hooks', 'guard.sh');
const KEY = 'hook-test-key';

type Seen = { path: string; headers: Record<string, string>; body: string };

async function runHook(script: string, args: string[], home: string, stdin: string, env: Record<string, string> = {}) {
  const started = Date.now();
  const proc = Bun.spawn(['sh', script, ...args], {
    stdin: new TextEncoder().encode(stdin),
    env: { ...process.env, AGENT_OFFICE_HOME: home, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr, ms: Date.now() - started };
}

describe('hook scripts', () => {
  const { dir, cleanup } = tempDir();
  const home = join(dir, 'home');
  const emptyHome = join(dir, 'empty');
  const downHome = join(dir, 'down');
  const seen: Seen[] = [];
  let gateAnswer = 'pass';
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        const path = new URL(req.url).pathname;
        seen.push({ path, headers: Object.fromEntries(req.headers.entries()), body: await req.text() });
        const body = seen.at(-1)?.body ?? '';
        if (path === '/gate' || path === '/gate-message' || path === '/guard') return new Response(gateAnswer);
        if (path === '/ask') return new Response('{"hookSpecificOutput":{"hookEventName":"PreToolUse"}}');
        if (path === '/events' && body.includes('SubagentStart')) {
          return new Response('{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"Lecciones"}}');
        }
        return new Response(null, { status: 200 });
      },
    });
    for (const d of [home, emptyHome, downHome]) mkdirSync(d, { recursive: true });
    writeFileSync(join(home, 'key'), `${KEY}\n`);
    writeFileSync(join(home, 'port'), `${server.port}\n`);
    writeFileSync(join(downHome, 'key'), `${KEY}\n`);
    writeFileSync(join(downHome, 'port'), '1\n');
  });

  afterAll(() => {
    server.stop(true);
    cleanup();
  });

  test('without a key both scripts do nothing', async () => {
    expect(await runHook(EMIT, ['events'], emptyHome, '{}')).toMatchObject({ code: 0, stdout: '' });
    expect(await runHook(GATE, [], emptyHome, '{}')).toMatchObject({ code: 0, stdout: '' });
  });

  test('with the hub down both scripts exit 0 quickly', async () => {
    const emit = await runHook(EMIT, ['events'], downHome, '{"hook_event_name":"Stop"}');
    const gate = await runHook(GATE, [], downHome, '{"hook_event_name":"TaskCompleted"}');
    expect(emit).toMatchObject({ code: 0, stdout: '' });
    expect(gate.code).toBe(0);
    expect(gate.ms).toBeLessThan(3000);
  });

  test('emit forwards the event with key, socket, token, role and name, and prints nothing', async () => {
    const event = '{"hook_event_name":"SessionStart","session_id":"s-1"}';
    const result = await runHook(EMIT, ['events'], home, event, {
      CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/cc-socks/1.sock',
      CLAUDE_CODE_MESSAGING_TOKEN: 'tok-1',
      AGENT_OFFICE_ROLE: 'office-lead-mobile',
      AGENT_OFFICE_NAME: 'lead-mobile',
    });
    expect(result).toMatchObject({ code: 0, stdout: '' });
    const request = seen.at(-1)!;
    expect(request.path).toBe('/events');
    expect(request.body).toBe(event);
    expect(request.headers['x-office-key']).toBe(KEY);
    expect(request.headers['x-office-socket']).toBe('/tmp/cc-socks/1.sock');
    expect(request.headers['x-office-token']).toBe('tok-1');
    expect(request.headers['x-office-role']).toBe('office-lead-mobile');
    expect(request.headers['x-office-name']).toBe('lead-mobile');
  });

  test('emit prints the memory the hub sends back for a starting agent', async () => {
    const result = await runHook(EMIT, ['events'], home, '{"hook_event_name":"SubagentStart","session_id":"s-1"}');
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toBe('Lecciones');
  });

  test('guard blocks with the reason and passes everything else, also with the hub down', async () => {
    gateAnswer = 'block:Guardia de Agent Office: Redacción solo escribe dentro de /docs/redaccion.';
    const blocked = await runHook(GUARD, [], home, '{"hook_event_name":"PreToolUse","tool_name":"Write"}', { AGENT_OFFICE_ROLE: 'office-lead-redaccion' });
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toContain('Redacción solo escribe');
    expect(seen.at(-1)?.path).toBe('/guard');
    expect(seen.at(-1)?.headers['x-office-role']).toBe('office-lead-redaccion');
    gateAnswer = 'pass';
    expect((await runHook(GUARD, [], home, '{"hook_event_name":"PreToolUse","tool_name":"Write"}')).code).toBe(0);
    expect((await runHook(GUARD, [], downHome, '{"hook_event_name":"PreToolUse","tool_name":"Write"}')).code).toBe(0);
    expect((await runHook(GUARD, [], emptyHome, '{}')).code).toBe(0);
  });

  test('emit ask prints the hub decision for Claude Code', async () => {
    const result = await runHook(EMIT, ['ask'], home, '{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion"}');
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('{"hookSpecificOutput":{"hookEventName":"PreToolUse"}}');
  });

  test('gate exits 2 with the reason when the hub blocks', async () => {
    gateAnswer = 'block:Falta tester: pide al tester que pruebe.';
    const result = await runHook(GATE, ['gate'], home, '{"hook_event_name":"TaskCompleted"}');
    expect(result.code).toBe(2);
    expect(result.stderr.trim()).toBe('Falta tester: pide al tester que pruebe.');
    expect(seen.at(-1)?.path).toBe('/gate');
  });

  test('gate-message blocks a HECHO message through the same script', async () => {
    gateAnswer = 'block:Falta tester';
    const result = await runHook(GATE, ['gate-message'], home, '{"hook_event_name":"PreToolUse","tool_name":"SendMessage"}');
    expect(result.code).toBe(2);
    expect(seen.at(-1)?.path).toBe('/gate-message');
  });

  test('gate exits 0 when the hub passes', async () => {
    gateAnswer = 'pass';
    expect((await runHook(GATE, [], home, '{"hook_event_name":"TaskCompleted"}')).code).toBe(0);
  });
});
