import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_DIR } from '../src/config';
import { tempDir } from './helpers';

const EMIT = join(PLUGIN_DIR, 'hooks', 'emit.sh');
const GATE = join(PLUGIN_DIR, 'hooks', 'gate.sh');
const KEY = 'hook-test-key';

type Seen = { path: string; headers: Record<string, string>; body: string };

function runHook(script: string, args: string[], home: string, stdin: string, env: Record<string, string> = {}) {
  const started = Date.now();
  const result = Bun.spawnSync(['sh', script, ...args], {
    stdin: new TextEncoder().encode(stdin),
    env: { ...process.env, AGENT_OFFICE_HOME: home, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    ms: Date.now() - started,
  };
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
        if (path === '/gate') return new Response(gateAnswer);
        if (path === '/ask') return new Response('{"hookSpecificOutput":{"hookEventName":"PreToolUse"}}');
        return new Response('esto no debe llegar a Claude');
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

  test('without a key both scripts do nothing', () => {
    expect(runHook(EMIT, ['events'], emptyHome, '{}')).toMatchObject({ code: 0, stdout: '' });
    expect(runHook(GATE, [], emptyHome, '{}')).toMatchObject({ code: 0, stdout: '' });
  });

  test('with the hub down both scripts exit 0 quickly', () => {
    const emit = runHook(EMIT, ['events'], downHome, '{"hook_event_name":"Stop"}');
    const gate = runHook(GATE, [], downHome, '{"hook_event_name":"TaskCompleted"}');
    expect(emit).toMatchObject({ code: 0, stdout: '' });
    expect(gate.code).toBe(0);
    expect(gate.ms).toBeLessThan(3000);
  });

  test('emit forwards the event with key, socket, token, role and name, and prints nothing', () => {
    const event = '{"hook_event_name":"SessionStart","session_id":"s-1"}';
    const result = runHook(EMIT, ['events'], home, event, {
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

  test('emit ask prints the hub decision for Claude Code', () => {
    const result = runHook(EMIT, ['ask'], home, '{"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion"}');
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('{"hookSpecificOutput":{"hookEventName":"PreToolUse"}}');
  });

  test('gate exits 2 with the reason when the hub blocks', () => {
    gateAnswer = 'block:Falta tester: pide al tester que pruebe.';
    const result = runHook(GATE, [], home, '{"hook_event_name":"TaskCompleted"}');
    expect(result.code).toBe(2);
    expect(result.stderr.trim()).toBe('Falta tester: pide al tester que pruebe.');
  });

  test('gate exits 0 when the hub passes', () => {
    gateAnswer = 'pass';
    expect(runHook(GATE, [], home, '{"hook_event_name":"TaskCompleted"}').code).toBe(0);
  });
});
