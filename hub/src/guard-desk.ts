import { existsSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { managedFloors } from './agents';
import { chatFreeCommand } from './chat-commands';
import { realPath } from './floors';
import type { GitRunner } from './git';
import { GuardWatch, fingerprint, gitIgnored, shellWrites, zonesFor, type GuardContext, type GuardFinding } from './guard';
import type { OfficeBus } from './office-bus';
import type { AlertRow, Sql } from './office-sql';
import { FINGERPRINT_ACTIVITY, MAX_ALERTS, TURN_OVER, remember, type AgentRuntime, type SessionRuntime } from './office-state';
import { departmentOf, roleKind } from './scope';
import type { SessionBook } from './session-book';
import { record, text, type Classified, type Matchers } from './state-machine';
import { plural } from './texts';
import type { FloorKind, GuardAlert, HookEvent, OfficeConfig } from './types';

export type GuardDeskOpts = {
  git: GitRunner;
  sql: Sql;
  now: () => number;
  bus: OfficeBus;
  book: SessionBook;
  config: () => OfficeConfig;
  claudeHome: string;
  docsRoot: () => string;
};

export class GuardDesk {
  private readonly watch: GuardWatch;
  private readonly changes: GuardWatch;
  private readonly pendingWrites = new Map<string, { root: string; paths: Map<string, string>; gitTree: boolean }>();
  private readonly fingerprintEdits = new Map<string, true>();

  constructor(private readonly opts: GuardDeskOpts) {
    this.watch = new GuardWatch({
      git: opts.git,
      floors: () => this.guardFloors(),
      now: opts.now,
      attributed: (floor, from, to) => this.attributedFiles(floor, from, to, false),
      active: (floor, from, to) => this.opts.sql.floorActive.get(floor, from, to) !== null,
      exempt: (agentKey) => {
        const agent = this.opts.book.agents.get(agentKey);
        const own = agent ? (zonesFor(agent.role, this.context())?.allowed ?? []) : [];
        return [...own, ...this.installTargets().map((target) => realPath(target.dir))];
      },
      report: (finding) => this.recordAlert(finding),
    });
    this.changes = new GuardWatch({
      git: opts.git,
      headDiff: true,
      floors: () => this.guardFloors(),
      now: opts.now,
      attributed: (floor, from, to) => this.attributedFiles(floor, from, to, true),
      active: () => false,
      exempt: () => this.installTargets().map((target) => realPath(target.dir)),
      report: (finding) => this.recordBashChanges(finding),
    });
  }

  busy(floor: string): boolean {
    return this.changes.busy(floor);
  }

  finish(agentKey: string): void {
    if (this.watch.watching(agentKey)) this.opts.bus.background(this.watch.finish(agentKey));
    if (this.changes.watching(agentKey)) this.opts.bus.background(this.changes.finish(agentKey));
  }

  private guardFloors(): { slug: string; path: string }[] {
    return managedFloors(this.opts.config())
      .map(([slug, floor]) => ({ slug, path: realPath(floor.path) }))
      .filter((f) => existsSync(f.path));
  }

  context(): GuardContext {
    return { docsRoot: this.opts.docsRoot(), claudeHome: realPath(this.opts.claudeHome), floors: this.guardFloors() };
  }

  installTargets(): { label: string; dir: string }[] {
    return [
      { label: '~/.claude/skills', dir: join(this.opts.claudeHome, 'skills') },
      ...managedFloors(this.opts.config()).map(([slug, floor]) => ({ label: `${slug}: .claude/skills`, dir: join(floor.path, '.claude', 'skills') })),
    ];
  }

  // Files changed with Edit, Bash or a turn fingerprint between from and to. The department guard leaves the
  // fingerprint rows out: a file a writer changed during a developer turn is not the developer's.
  private attributedFiles(floor: string, from: number, to: number, includeFingerprints: boolean): Set<string> {
    const out = new Set<string>();
    for (const row of this.opts.sql.editsBetween.all(floor, from, to)) {
      if (!row.path) continue;
      const path = realPath(row.path);
      if (!includeFingerprints && this.fingerprintEdits.has(fingerprintKey(floor, row.ts, path))) continue;
      out.add(path);
    }
    return out;
  }

  private recordBashChanges(finding: GuardFinding): void {
    for (const file of finding.files) {
      const path = realPath(file);
      this.opts.sql.insertEdit.run(finding.ts, finding.agentKey, finding.floor, path);
      remember(this.fingerprintEdits, fingerprintKey(finding.floor, finding.ts, path), true);
    }
    for (const file of finding.files.slice(0, FINGERPRINT_ACTIVITY)) {
      this.opts.bus.pushActivity({
        ts: finding.ts,
        agentKey: finding.agentKey,
        event: 'Fingerprint',
        tool: null,
        state: null,
        summary: { key: 'hub.act.edited', params: { name: basename(file) } },
      });
    }
  }

  // Bash writes of a managed floor: the fingerprints of the candidate files before the command, compared after it.
  bashWrites(e: HookEvent, c: Classified, agent: AgentRuntime, session: SessionRuntime, kind: FloorKind, matchers: Matchers, now: number): void {
    const id = text(e.tool_use_id);
    if (c.tool !== 'Bash' || !id) return;
    if (c.event === 'PostToolUse' || c.event === 'PostToolUseFailure') {
      const entry = this.pendingWrites.get(id);
      if (!entry) return;
      this.pendingWrites.delete(id);
      if (e.is_interrupt === true) return;
      let changed = [...entry.paths].filter(([path, before]) => fingerprint(path) !== before).map(([path]) => path);
      if (changed.length > 0 && this.changes.watching(agent.key)) {
        const ignored = gitIgnored(entry.root, changed.map((path) => relative(entry.root, path)));
        changed = changed.filter((path) => !ignored.has(path));
      }
      for (const path of changed) this.opts.sql.insertEdit.run(now, agent.key, session.floor, path);
      if (entry.gitTree) this.opts.sql.insertEdit.run(now, agent.key, session.floor, entry.root);
      return;
    }
    if (c.event !== 'PreToolUse' || kind !== 'managed' || c.test !== null) return;
    const input = record(e.tool_input);
    const raw = text(input.command);
    if (!raw || input.run_in_background === true) return;
    const command = chatFreeCommand(raw) ?? raw;
    const floorPath = this.opts.config().floors[session.floor]?.path;
    if (!command.trim() || matchers.check.test(command) || !floorPath) return;
    const root = realPath(floorPath);
    const writes = shellWrites(command, text(e.cwd) ?? session.cwd, root);
    if (writes.paths.length === 0 && !writes.gitTree) return;
    remember(this.pendingWrites, id, { root, gitTree: writes.gitTree, paths: new Map(writes.paths.map((path) => [path, fingerprint(path)])) });
  }

  // The turn of a developer (or of the subagents it launches) on a managed floor: a git status fingerprint before
  // and after, for what neither Edit nor Bash declared.
  trackChanges(agent: AgentRuntime, floorKind: FloorKind, event: string, ended: boolean): void {
    const kind = roleKind(agent.role);
    if (floorKind !== 'managed' || (kind !== 'dev' && kind !== 'intern') || agent.key === agent.sessionId) return;
    if (TURN_OVER.has(event)) {
      if (this.changes.watching(agent.key)) this.opts.bus.background(this.changes.finish(agent.key));
      return;
    }
    if (event === 'SessionStart' || event === 'Notification' || ended || agent.endedAt !== null || this.changes.watching(agent.key)) return;
    const floors = this.guardFloors().filter((f) => f.slug === agent.floor);
    if (floors.length === 0) return;
    this.changes.start(agent.key, floors);
    this.opts.bus.background(this.changes.ready(agent.key));
  }

  private recordAlert(finding: GuardFinding): void {
    const id = Number(this.opts.sql.insertAlert.run(finding.ts, finding.level, finding.floor, finding.agentKey, JSON.stringify(finding.files)).lastInsertRowid);
    const alert: GuardAlert = { id, ...finding };
    this.opts.bus.emit({ type: 'alert', data: alert });
    const who = this.opts.book.agents.get(finding.agentKey)?.name ?? finding.agentKey;
    this.opts.bus.pushActivity({
      ts: finding.ts,
      agentKey: finding.agentKey,
      event: 'GuardAlert',
      tool: null,
      state: null,
      summary: plural('hub.act.guardAlert', finding.files.length, {
        level: { key: finding.level === 'alerta' ? 'hub.alertLevel.alerta' : 'hub.alertLevel.posible' },
        floor: finding.floor,
        who,
      }),
    });
  }

  alerts(): GuardAlert[] {
    return this.opts.sql.recentAlerts
      .all(MAX_ALERTS)
      .reverse()
      .map((row: AlertRow) => ({
        id: row.id,
        ts: row.ts,
        level: row.level === 'posible' ? 'posible' : 'alerta',
        floor: row.floor,
        agentKey: row.agent_key,
        files: parseList(row.files),
      }));
  }

  trackDepartment(agent: AgentRuntime, event: string, ended: boolean): void {
    if (!departmentOf(agent.role)) return;
    if (event === 'SubagentStop' || event === 'Stop' || event === 'SessionEnd') {
      if (this.watch.watching(agent.key)) this.opts.bus.background(this.watch.finish(agent.key));
      return;
    }
    if (event === 'SessionStart' || event === 'Notification' || event === 'TeammateIdle') return;
    if (!ended && agent.endedAt === null && !this.watch.watching(agent.key)) {
      this.watch.start(agent.key);
      this.opts.bus.background(this.watch.ready(agent.key));
    }
  }
}

function fingerprintKey(floor: string, ts: number, path: string): string {
  return `${floor}\0${ts}\0${path}`;
}

function parseList(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
