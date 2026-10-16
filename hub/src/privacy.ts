import { basename } from 'node:path';
import type { Classified } from './state-machine';
import type { FloorKind, HookEvent, HubText } from './types';

export function isPrivate(kind: FloorKind): boolean {
  return kind === 'observed';
}

// A session that is not of the office is kept like one in an observed floor, wherever it runs.
export function visibleKind(kind: FloorKind, inOffice: boolean): FloorKind {
  return inOffice ? kind : 'observed';
}

export const MAX_STORED_RESPONSE = 8 * 1024;

// A tool response (a whole file, a long build log) is the bulk of the events table: past the cap only its head is kept.
export function cappedResponse(response: unknown): unknown {
  if (response === undefined || response === null) return response;
  const raw = typeof response === 'string' ? response : (JSON.stringify(response) ?? '');
  const bytes = Buffer.byteLength(raw);
  if (bytes <= MAX_STORED_RESPONSE) return response;
  return { truncated: true, bytes, head: Buffer.from(raw).subarray(0, MAX_STORED_RESPONSE).toString('utf8').replace(/\uFFFD+$/, '') };
}

export function storedPayload(e: HookEvent, kind: FloorKind): string | null {
  if (isPrivate(kind)) return null;
  const { transcript_path: _transcript, agent_transcript_path: _agentTranscript, tool_response: response, ...rest } = e;
  return JSON.stringify(response === undefined ? rest : { ...rest, tool_response: cappedResponse(response) });
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
