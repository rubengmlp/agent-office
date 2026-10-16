import { basename } from 'node:path';
import type { Classified } from './state-machine';
import type { FloorKind, HookEvent, HubText } from './types';

export function isPrivate(kind: FloorKind): boolean {
  return kind === 'observed';
}

export function storedPayload(e: HookEvent, kind: FloorKind): string | null {
  if (isPrivate(kind)) return null;
  const { transcript_path: _transcript, agent_transcript_path: _agentTranscript, ...rest } = e;
  return JSON.stringify(rest);
}

export function publicDetail(c: Classified, kind: FloorKind): HubText {
  if (!isPrivate(kind)) return c.detail;
  if (c.filePath) return basename(c.filePath);
  if (c.state === 'testing') return { key: 'hub.detail.tests' };
  if (c.state === 'checking') return { key: 'hub.detail.checking' };
  return c.tool ?? c.event;
}

export function publicSummary(c: Classified, kind: FloorKind): HubText {
  if (!isPrivate(kind)) return c.summary;
  const target = c.filePath ? ` ${basename(c.filePath)}` : '';
  return `${c.tool ?? c.event}${target}`;
}

export function publicText(value: string | null, kind: FloorKind): string | null {
  return isPrivate(kind) ? null : value;
}
