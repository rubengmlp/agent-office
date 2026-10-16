import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RELAUNCH_RESUMES } from './office-sh';
import type { OfficeBus } from './office-bus';
import { TEAM_CACHE_MS, teamOfSession, type AgentRuntime, type SessionRuntime } from './office-state';
import type { Sql } from './office-sql';
import { inOfficeScope, canonicalRole, isOfficeRole, isVerdictRole, roleFromName, roleIdOf, roleKind } from './scope';
import { visibleKind } from './privacy';
import { idText, record, text, type SpawnCall } from './state-machine';
import type { AgentView, FloorKind, HookEvent, OfficeConfig, SessionView } from './types';

export type SessionBookOpts = {
  sql: Sql;
  now: () => number;
  bus: OfficeBus;
  config: () => OfficeConfig;
  claudeHome: string;
  tokens: (agentKey: string) => AgentView['tokens'];
  flags: (session: SessionRuntime) => { rulesPending: boolean; canRelaunch: boolean };
};

export class SessionBook {
  readonly agents = new Map<string, AgentRuntime>();
  readonly sessions = new Map<string, SessionRuntime>();
  readonly spawnCalls = new Map<string, SpawnCall>();
  readonly spawnCallsByName = new Map<string, SpawnCall>();
  readonly spawnedAgents = new Map<string, SpawnCall>();
  readonly teammateIds = new Map<string, true>();
  private readonly teamCache = new Map<string, { at: number; members: Record<string, unknown>[] }>();
  private readonly sessionFlags = new Map<string, string>();

  constructor(private readonly opts: SessionBookOpts) {}

  leadSession(team: string | null | undefined): SessionRuntime | null {
    if (!team) return null;
    const prefix = team.replace(/^session-/, '');
    if (!prefix) return null;
    for (const session of this.sessions.values()) {
      if (session.sessionId.startsWith(prefix)) return session;
    }
    return null;
  }

  directorSession(): SessionRuntime | null {
    let found: SessionRuntime | null = null;
    for (const session of this.sessions.values()) {
      if (session.endedAt !== null) continue;
      const role = session.role ?? this.agents.get(session.sessionId)?.role ?? null;
      if (canonicalRole(role) !== 'office-director') continue;
      if (!found || session.updatedAt > found.updatedAt) found = session;
    }
    return found;
  }

  // A session of the office: not in an observed floor, and with an office role of its own or a lead of the office
  // in its team, from the launcher header or from the agent_type of its main agent.
  sessionInOffice(session: SessionRuntime, team: string | null = null): boolean {
    const lead = this.leadSession(team ?? session.team);
    return inOfficeScope({
      floorKind: session.floorKind,
      sessionRole: session.role ?? this.agents.get(session.sessionId)?.role ?? null,
      leadRole: lead ? (lead.role ?? this.agents.get(lead.sessionId)?.role ?? null) : null,
    });
  }

  privacyKind(session: SessionRuntime, team: string | null = null): FloorKind {
    return visibleKind(session.floorKind, this.sessionInOffice(session, team));
  }

  privacyKindOf(agent: AgentRuntime): FloorKind {
    const session = this.sessions.get(agent.sessionId);
    return session ? this.privacyKind(session) : agent.floorKind;
  }

  recipientKey(to: string, from: AgentRuntime): string | null {
    if (this.agents.has(to)) return to;
    if (to === 'main' || to === 'team-lead') {
      if (from.parentKey) return from.parentKey;
      return from.team ? (this.leadSession(from.team)?.sessionId ?? null) : null;
    }
    const named = [...this.agents.values()].filter((a) => a.name === to && a.endedAt === null);
    const sameTeam = named.find(
      (a) => (from.team !== null && a.team === from.team) || a.sessionId === from.sessionId,
    );
    if (sameTeam) return sameTeam.key;
    if (named[0]) return named[0].key;
    for (const session of this.sessions.values()) {
      if (session.name === to && session.endedAt === null) return session.sessionId;
    }
    const at = to.indexOf('@');
    return at > 0 ? this.recipientKey(to.slice(0, at), from) : null;
  }

  roleForEvent(e: HookEvent, session: SessionRuntime): string | null {
    const key = e.agent_id ?? e.session_id;
    const known = this.agents.get(key)?.role ?? null;
    if (isOfficeRole(known)) return canonicalRole(known);
    const type = text(e.agent_type);
    if (isOfficeRole(type)) return canonicalRole(type);
    if (key === e.session_id) return canonicalRole(session.role ?? known);
    if (!type) return null;
    const team = text(e.team_name) ?? session.team ?? teamOfSession(e.session_id);
    const resolved =
      this.teamMemberType(team, type) ??
      this.spawnCallsByName.get(`${e.session_id}:${type}`)?.subagentType ??
      roleFromName(type, session.floor, session.floorKind);
    return canonicalRole(resolved);
  }

  liveTeammate(name: string | null, team: string, sessionId: string): AgentRuntime | null {
    if (!name) return null;
    for (const agent of this.agents.values()) {
      if (agent.name !== name || agent.endedAt !== null || this.isRetired(agent)) continue;
      if (agent.team === team || agent.sessionId === sessionId) return agent;
    }
    return null;
  }

  isRetired(agent: AgentRuntime): boolean {
    if (agent.retiredAt !== null) return true;
    if (!isVerdictRole(agent.role)) return false;
    const row = this.opts.sql.firstVerdictOf.get(agent.key);
    if (!row || row.ts === null) return false;
    agent.retiredAt = row.ts;
    agent.retiredAwake = false;
    agent.state = 'done';
    agent.sentState = 'done';
    agent.stateSince = row.ts;
    if (agent.endedAt === null) agent.endedAt = row.ts;
    this.persistAgent(agent);
    return true;
  }

  private teamMembers(team: string): Record<string, unknown>[] {
    const now = this.opts.now();
    const cached = this.teamCache.get(team);
    if (cached && now - cached.at < TEAM_CACHE_MS) return cached.members;
    let members: Record<string, unknown>[] = [];
    const file = join(this.opts.claudeHome, 'teams', team, 'config.json');
    try {
      if (existsSync(file)) {
        const raw = record(JSON.parse(readFileSync(file, 'utf8'))).members;
        members = Array.isArray(raw) ? raw.map((m) => record(m)) : [];
      }
    } catch {
      members = [];
    }
    this.teamCache.set(team, { at: now, members });
    return members;
  }

  teamMemberIds(team: string, name: string): string[] {
    return this.teamMembers(team)
      .filter((m) => m.name === name)
      .map((m) => idText(m.agentId) ?? idText(m.agent_id) ?? idText(m.id))
      .filter((id): id is string => id !== null);
  }

  teamMemberType(team: string, name: string): string | null {
    const member = this.teamMembers(team).find((m) => m.name === name);
    const type = member ? (text(member.agentType) ?? text(member.agent_type)) : null;
    return type && type !== 'team-lead' ? type : null;
  }

  persistSession(s: SessionRuntime): void {
    s.persistedAt = this.opts.now();
    this.opts.sql.upsertSession.run(s.sessionId, s.cwd, s.floor, s.role, s.name, s.socket, s.token, s.team, s.startedAt, s.updatedAt, s.endedAt);
  }

  persistTaskOpen(a: AgentRuntime): void {
    if (a.key === a.sessionId) this.opts.sql.updateTaskOpen.run(a.taskOpenSince, a.sessionId);
  }

  persistAgent(a: AgentRuntime): void {
    this.opts.sql.upsertAgent.run(a.key, a.sessionId, a.parentKey, a.name, a.role, a.floor, a.team, a.startedAt, a.updatedAt, a.endedAt);
  }

  view(agent: AgentRuntime, now: number): AgentView {
    let state = agent.state;
    let detail = agent.detail;
    if (agent.endedAt === null && agent.blockedReason) {
      state = 'blocked';
      detail = agent.blockedReason;
    } else if (
      agent.endedAt === null &&
      agent.state === 'asking' &&
      now - agent.stateSince > this.opts.config().blockedAfterMinutes * 60_000
    ) {
      state = 'blocked';
      detail = { key: 'hub.detail.noAnswer', params: { detail: agent.detail } };
    } else if (agent.endedAt === null && agent.state === 'idle' && agent.waiting) {
      detail = { key: 'hub.detail.waitingFor', params: { who: agent.waiting.who, what: agent.waiting.what || '…' } };
    }
    return {
      key: agent.key,
      sessionId: agent.sessionId,
      parentKey: agent.parentKey,
      name: agent.name,
      role: agent.role,
      roleId: roleIdOf(agent.role),
      roleKind: roleKind(agent.role),
      floor: agent.floor,
      touchedFloor: agent.touchedFloor,
      state,
      detail,
      tool: agent.tool,
      lastTest: agent.lastTest,
      stateSince: agent.stateSince,
      updatedAt: agent.updatedAt,
      endedAt: agent.endedAt,
      file: agent.file,
      task: agent.task,
      away: agent.away || agent.endedAt !== null || agent.retiredAt !== null,
      tokens: this.opts.tokens(agent.key),
      waiting: agent.waiting,
      stalledSince: agent.stalledSince,
    };
  }

  sessionView(session: SessionRuntime): SessionView {
    const { rulesPending, canRelaunch } = this.opts.flags(session);
    return {
      sessionId: session.sessionId,
      agentKey: session.sessionId,
      name: session.name,
      role: session.role,
      floor: session.floor,
      canReceive: session.endedAt === null && !!session.socket && existsSync(session.socket),
      endedAt: session.endedAt,
      needsRelaunch: session.needsRelaunch,
      rulesPending,
      canRelaunch,
      relaunchResumes: RELAUNCH_RESUMES,
      office: this.sessionInOffice(session),
    };
  }

  emitSession(session: SessionRuntime): void {
    const view = this.sessionView(session);
    this.sessionFlags.set(session.sessionId, flagsOf(view));
    this.opts.bus.emit({ type: 'session', data: view });
  }

  emitAgent(agent: AgentRuntime, now: number): void {
    const view = this.view(agent, now);
    agent.sentState = view.state;
    this.opts.bus.emit({ type: 'agent', data: view });
  }

  refreshFlags(session: SessionRuntime): void {
    if (this.sessionFlags.get(session.sessionId) !== flagsOf(this.sessionView(session))) this.emitSession(session);
  }
}

function flagsOf(view: SessionView): string {
  return `${view.needsRelaunch}|${view.rulesPending}|${view.canRelaunch}|${view.canReceive}|${view.office}`;
}
