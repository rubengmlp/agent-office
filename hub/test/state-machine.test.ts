import { describe, expect, test } from 'bun:test';
import { classify, type Matchers } from '../src/state-machine';
import type { HookEvent } from '../src/types';
import { loadFixture } from './helpers';

const flutter: Matchers = { test: /\bflutter\s+test\b/, check: /\bflutter\s+analyze\b|layering_guard/ };
const events = loadFixture('session-basic.json', '/repo');
const find = (hook: string, tool?: string, sub = false) =>
  events.find((e) => e.hook_event_name === hook && (tool === undefined || e.tool_name === tool) && !!e.agent_id === sub)!;
const bash = (base: HookEvent, command: string): HookEvent => ({ ...base, tool_input: { ...base.tool_input, command } });

describe('real captured payloads', () => {
  test('session start puts the main agent at rest', () => {
    const c = classify(find('SessionStart'), flutter);
    expect(c.agentKey).toBe('11111111-aaaa-4bbb-8ccc-000000000001');
    expect(c.parentKey).toBeNull();
    expect(c.state).toBe('idle');
  });

  test('summaries and details are keys and raw text stays raw', () => {
    const start = classify(find('SessionStart'), flutter);
    expect(start.summary).toEqual({ key: 'hub.act.sessionStart', params: { source: 'startup' } });
    expect(start.detail).toEqual({ key: 'hub.detail.waiting' });
    const run = classify(bash(find('PreToolUse', 'Bash'), 'ls -la'), flutter);
    expect(run.detail).toBe('ls -la');
    expect(run.summary).toEqual({ key: 'hub.act.run', params: { command: 'ls -la' } });
  });

  test('a plain bash command is work', () => {
    const c = classify(find('PreToolUse', 'Bash'), flutter);
    expect(c.state).toBe('working');
    expect(c.command).toBe('true');
    expect(c.test).toBeNull();
  });

  test('a successful test command ends green', () => {
    const c = classify(bash(find('PostToolUse', 'Bash'), 'flutter test test/a_test.dart'), flutter);
    expect(c.test).toBe('pass');
    expect(c.state).toBe('working');
  });

  test('a failing test command arrives as PostToolUseFailure and ends red', () => {
    const failure = find('PostToolUseFailure', 'Bash');
    expect(failure.error).toBe('Exit code 1');
    const c = classify(bash(failure, 'flutter test test/a_test.dart'), flutter);
    expect(c.test).toBe('fail');
  });

  test('an interrupted test run is not a result', () => {
    const c = classify({ ...bash(find('PostToolUseFailure', 'Bash'), 'flutter test'), is_interrupt: true }, flutter);
    expect(c.test).toBeNull();
  });

  test('a failure of a non-test command records nothing', () => {
    const c = classify(find('PostToolUseFailure', 'Bash'), flutter);
    expect(c.test).toBeNull();
    expect(c.state).toBeNull();
  });

  test('tool events inside a subagent belong to the subagent', () => {
    const c = classify(find('PreToolUse', 'Bash', true), flutter);
    expect(c.agentKey).toBe('a0f92699da9c839ef');
    expect(c.parentKey).toBe('11111111-aaaa-4bbb-8ccc-000000000001');
    expect(c.role).toBe('echoer');
  });

  test('the Agent tool result links the call to the spawned agent id', () => {
    const pre = classify(find('PreToolUse', 'Agent'), flutter);
    const post = classify(find('PostToolUse', 'Agent'), flutter);
    expect(pre.spawnCall?.subagentType).toBe('echoer');
    expect(post.spawned).toEqual({ toolUseId: pre.spawnCall!.toolUseId, agentId: 'a0f92699da9c839ef', teammate: false });
  });

  test('subagent stop and session end finish the agent', () => {
    expect(classify(find('SubagentStop', undefined, true), flutter)).toMatchObject({ state: 'done', ended: true });
    expect(classify(find('SessionEnd'), flutter)).toMatchObject({ state: 'done', ended: true, sessionEnded: true });
  });
});

describe('bash commands by profile', () => {
  const pre = find('PreToolUse', 'Bash');

  test('checks are not tests', () => {
    expect(classify(bash(pre, 'flutter analyze lib'), flutter).state).toBe('checking');
    expect(classify(bash(pre, 'dart run tool/layering_guard.dart'), flutter).state).toBe('checking');
  });

  test('a command with both a check and a test counts as a test', () => {
    expect(classify(bash(pre, 'flutter analyze && flutter test'), flutter).state).toBe('testing');
  });
});

describe('synthetic events from the docs', () => {
  const base = { session_id: '22222222-bbbb-4ccc-8ddd-000000000002', cwd: '/repo' };

  test('a BLOQUEADO message blocks the sender', () => {
    const c = classify(
      { ...base, hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_input: { to: 'main', message: 'BLOQUEADO: falta el contrato — necesito status de backend' } },
      flutter,
    );
    expect(c.state).toBe('blocked');
    expect(c.blocked).toContain('BLOQUEADO');
    expect(c.unblock).toBe(false);
    expect(c.message?.to).toBe('main');
  });

  test('a normal message is talking and clears a block', () => {
    const c = classify(
      { ...base, hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_input: { to: 'dev-mobile', message: 'Empieza por la tarea 1' } },
      flutter,
    );
    expect(c.state).toBe('talking');
    expect(c.unblock).toBe(true);
  });

  test('a structured protocol message has no text', () => {
    const c = classify(
      { ...base, hook_event_name: 'PreToolUse', tool_name: 'SendMessage', tool_input: { to: 'dev-mobile', message: { type: 'shutdown_request' } } },
      flutter,
    );
    expect(c.message).toEqual({ to: 'dev-mobile', text: '' });
  });

  test('AskUserQuestion is asking with the first question as detail', () => {
    const c = classify(
      {
        ...base,
        hook_event_name: 'PreToolUse',
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question: '¿Qué endpoint?', options: [{ label: 'A' }] }] },
      },
      flutter,
    );
    expect(c.state).toBe('asking');
    expect(c.detail).toBe('¿Qué endpoint?');
  });

  test('edits are recorded after the tool ran', () => {
    const input = { file_path: '/repo/lib/a.dart', old_string: 'a', new_string: 'b' };
    const pre = classify({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: input }, flutter);
    const post = classify({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: input }, flutter);
    expect(pre.edit).toBeNull();
    expect(pre.detail).toBe('a.dart');
    expect(post.edit).toBe('/repo/lib/a.dart');
  });

  test('teammate idle without agent id keys the teammate by name and team', () => {
    const c = classify({ ...base, hook_event_name: 'TeammateIdle', teammate_name: 'dev-mobile', team_name: 'session-22222222' }, flutter);
    expect(c.agentKey).toBe('dev-mobile@session-22222222');
    expect(c.parentKey).toBe(base.session_id);
    expect(c.state).toBe('idle');
  });

  test('task updates carry id, owner and status', () => {
    const c = classify(
      { ...base, hook_event_name: 'PreToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', owner: 'dev-mobile', status: 'in_progress' } },
      flutter,
    );
    expect(c.task).toEqual({ taskId: '1', subject: null, owner: 'dev-mobile', status: 'in_progress' });
  });

  test('notifications map to asking or idle', () => {
    expect(classify({ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' }, flutter).state).toBe('asking');
    expect(classify({ ...base, hook_event_name: 'Notification', notification_type: 'idle_prompt' }, flutter).state).toBe('idle');
    expect(classify({ ...base, hook_event_name: 'Notification', notification_type: 'auth_success' }, flutter).state).toBeNull();
  });
});
