import type { SessionView } from '../types';

export function orderable(session: SessionView): boolean {
  return session.office && session.canReceive && session.endedAt === null;
}

export function orderableSessions(sessions: Iterable<SessionView>): SessionView[] {
  return [...sessions].filter(orderable);
}

export function statusAllowed(session: SessionView | undefined): boolean {
  return session?.office === true;
}

export function relaunchable(session: SessionView | undefined): boolean {
  return session?.office === true && session.needsRelaunch && session.endedAt === null;
}
