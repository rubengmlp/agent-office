import type { GateDecision } from './gate';
import { GUARDED_TOOLS } from './guard';
import type { Office } from './office';
import type { HookEvent, HookMeta } from './types';

export type HookResult = { emit: string | null; decision: GateDecision };

const NO_GATE: GateDecision = { pass: true, reason: 'sin puerta' };

export function runHook(office: Pick<Office, 'ingest' | 'guard' | 'gate'>, e: HookEvent, meta: HookMeta, onError: (error: unknown) => void): HookResult {
  if (e.hook_event_name === 'TaskCompleted') return { emit: null, decision: office.gate(e) };
  let emit: string | null = null;
  try {
    emit = office.ingest(e, meta);
  } catch (error) {
    onError(error);
  }
  const guarded = e.hook_event_name === 'PreToolUse' && GUARDED_TOOLS.has(e.tool_name ?? '');
  return { emit, decision: guarded ? office.guard(e, meta) : NO_GATE };
}

export function hookResponse(r: HookResult): string {
  if (!r.decision.pass) return `block:${r.decision.reason.replace(/\s*\n\s*/g, ' ')}`;
  return r.emit ? `pass\n${r.emit}` : 'pass';
}
