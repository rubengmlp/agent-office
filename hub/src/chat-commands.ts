import { basename } from 'node:path';
import { CHAT_SCRIPT } from './agents';
import { tokenize } from './guard';
import { classify, record, text, type Classified, type Matchers } from './state-machine';
import type { HookEvent } from './types';

const SEPARATORS: ReadonlySet<string> = new Set(['\n', ';', '|', '&', '(', ')']);

// The raw text of each command of a shell line, split where tokenize splits (; | & newlines and parentheses)
// outside quotes; the &> and >& redirections do not split.
function shellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  const end = () => {
    if (current.trim()) segments.push(current.trim());
    current = '';
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i] ?? '';
    if (ch === '\\' && quote !== "'" && i + 1 < command.length) {
      current += ch + (command[++i] ?? '');
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    const redirect = ch === '&' && (command[i + 1] === '>' || current.endsWith('>') || current.endsWith('<'));
    if (!redirect && SEPARATORS.has(ch)) end();
    else current += ch;
  }
  end();
  return segments;
}

const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash']);

function isChatCall(segment: string): boolean {
  const words = [...(tokenize(segment)[0] ?? [])];
  while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) words.shift();
  if (SHELLS.has(basename(words[0] ?? ''))) {
    words.shift();
    while ((words[0] ?? '').startsWith('-')) words.shift();
  }
  const first = words[0];
  return !!first && (first === CHAT_SCRIPT || basename(first) === 'office-chat.sh');
}

// A shell line without its calls to the chat script, or null when it has none. Nothing is taken out of a line
// with $( or backticks: whatever they run, even inside a chat message, really runs.
export function chatFreeCommand(command: string): string | null {
  if (command.includes('$(') || command.includes('`')) return null;
  const segments = shellSegments(command);
  const rest = segments.filter((segment) => !isChatCall(segment));
  return rest.length === segments.length ? null : rest.join('; ');
}

export function isChatCommand(command: string): boolean {
  return chatFreeCommand(command) === '';
}

const CHAT_COMMAND_EVENTS: ReadonlySet<string> = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);

// A call to the chat script is talking, not testing: whatever its text says, it must not count as a test run.
// The rest of the line is classified on its own, so a real test next to it still counts.
export function withoutChatCalls(c: Classified, e: HookEvent, matchers: Matchers): Classified {
  if (c.tool !== 'Bash' || !CHAT_COMMAND_EVENTS.has(c.event)) return c;
  const input = record(e.tool_input);
  const command = text(input.command);
  const rest = command === null ? null : chatFreeCommand(command);
  if (rest === null) return c;
  if (rest !== '') return classify({ ...e, tool_input: { ...input, command: rest } }, matchers);
  c.test = null;
  c.command = null;
  c.state = 'working';
  c.summary = { key: 'hub.act.chatCommand' };
  c.detail = { key: 'hub.act.chatCommand' };
  return c;
}
