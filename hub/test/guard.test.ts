import { describe, expect, test } from 'bun:test';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { realPath } from '../src/floors';
import { runGit } from '../src/git';
import { GuardWatch, guardDecision, shellPaths, snapshotRepo, changedFiles, type GuardContext, type GuardFinding } from '../src/guard';
import { git, tempDir, useGitIdentity } from './helpers';

const ctx: GuardContext = {
  docsRoot: '/docs',
  claudeHome: '/uhome/u/.claude',
  floors: [
    { slug: 'mobile', path: '/p/mobile' },
    { slug: 'backend', path: '/p/backend' },
  ],
  home: '/uhome/u',
};

const write = (role: string, file: string, cwd = '/docs/redaccion') => guardDecision({ tool: 'Write', input: { file_path: file }, cwd, role }, ctx);
const bash = (role: string, command: string, cwd = '/docs/redaccion') => guardDecision({ tool: 'Bash', input: { command }, cwd, role }, ctx);

describe('write guard', () => {
  test('Redacción writes only inside redaccion and never in the sources snapshot', () => {
    expect(write('office-redactor', '/docs/redaccion/planes/login.md').pass).toBe(true);
    expect(write('office-redactor', 'planes/login.md').pass).toBe(true);
    const outside = write('office-redactor', '/p/mobile/lib/main.dart');
    expect(outside.pass).toBe(false);
    expect(outside.reason).toContain('Redacción solo escribe dentro de /docs/redaccion');
    expect(write('office-redactor', '/docs/redaccion/.fuentes/login/mobile/lib/a.dart').pass).toBe(false);
    expect(write('office-lead-redaccion', '/docs/taller/skills/x/SKILL.md').pass).toBe(false);
    expect(write('office-revisor-planes', '/docs/redaccion/planes/login.md').pass).toBe(true);
  });

  test('only the Mantenimiento lead installs skills, in the user folder or a floor folder', () => {
    expect(write('office-artesano', '/docs/taller/skills/pdf/SKILL.md', '/docs/taller').pass).toBe(true);
    expect(write('office-artesano', '/uhome/u/.claude/skills/pdf/SKILL.md', '/docs/taller').pass).toBe(false);
    expect(write('office-lead-mantenimiento', '/uhome/u/.claude/skills/pdf/SKILL.md', '/docs/taller').pass).toBe(true);
    expect(write('office-lead-mantenimiento', '/p/mobile/.claude/skills/pdf/SKILL.md', '/docs/taller').pass).toBe(true);
    expect(write('office-lead-mantenimiento', '/p/mobile/lib/main.dart', '/docs/taller').pass).toBe(false);
    expect(write('office-lead-mantenimiento', '/uhome/u/.claude/settings.json', '/docs/taller').pass).toBe(false);
  });

  test('roles outside the departments and unknown roles are never blocked', () => {
    expect(write('office-dev-mobile', '/p/backend/app/x.php').pass).toBe(true);
    expect(write('office-lead-mobile', '/anywhere').pass).toBe(true);
    expect(write('Explore', '/anywhere').pass).toBe(true);
    expect(guardDecision({ tool: 'Write', input: { file_path: '/p/mobile/x' }, cwd: null, role: null }, ctx).pass).toBe(true);
    expect(guardDecision({ tool: 'Read', input: { file_path: '/p/mobile/x' }, cwd: null, role: 'office-redactor' }, ctx).pass).toBe(true);
  });
});

describe('bash guard (partial by design)', () => {
  test('commands that name a managed floor are blocked for department roles', () => {
    expect(bash('office-lead-redaccion', 'cat /p/mobile/lib/main.dart').pass).toBe(false);
    expect(bash('office-artesano', 'cd /p/backend && ls', '/docs/taller').pass).toBe(false);
    expect(bash('office-artesano', 'git -C /p/mobile status', '/docs/taller').pass).toBe(false);
    expect(bash('office-dev-mobile', 'rm -rf /p/backend/vendor').pass).toBe(true);
  });

  test('the user Claude folder: skill scripts can run, nothing can be written except by the Mantenimiento lead', () => {
    const run = 'python3 ~/.claude/skills/synced/abc/skill-creator/scripts/init_skill.py pdf --path /docs/taller/skills';
    expect(bash('office-artesano', run, '/docs/taller').pass).toBe(true);
    expect(bash('office-artesano', 'python3 ~/.claude/skills/x/init.py pdf --path ~/.claude/skills', '/docs/taller').pass).toBe(false);
    expect(bash('office-artesano', 'cp -r skills/pdf ~/.claude/skills/pdf', '/docs/taller').pass).toBe(false);
    expect(bash('office-artesano', 'cat ~/.claude/settings.json', '/docs/taller').pass).toBe(false);
    const install = 'mkdir -p /uhome/u/.claude/skills/pdf && rsync -a --exclude evals /docs/taller/skills/pdf/ /uhome/u/.claude/skills/pdf/';
    expect(bash('office-lead-mantenimiento', install, '/docs/taller').pass).toBe(true);
    expect(bash('office-lead-mantenimiento', 'mkdir -p /p/mobile/.claude/skills/pdf', '/docs/taller').pass).toBe(true);
  });

  test('writes into the sources snapshot or another department folder are blocked, reads are not', () => {
    expect(bash('office-lead-redaccion', 'ls redaccion/.fuentes/login/mobile', '/docs').pass).toBe(true);
    expect(bash('office-lead-redaccion', 'echo x > .fuentes/login/mobile/a.txt').pass).toBe(false);
    expect(bash('office-lead-redaccion', 'touch /docs/taller/skills/x').pass).toBe(false);
    expect(bash('office-lead-redaccion', '/agent-office/plugin/scripts/office-sync.sh login mobile --ref develop').pass).toBe(true);
    expect(bash('office-lead-redaccion', 'ls -la 2>&1 | head > /dev/null').pass).toBe(true);
  });

  test('shell paths: redirects, copies, in-place edits and output flags are writes', () => {
    const paths = (cmd: string) => shellPaths(cmd).map((p) => `${p.write ? 'W' : 'R'}:${p.path}`).sort();
    expect(paths('cat a/b.txt > out/c.txt')).toEqual(['R:a/b.txt', 'W:out/c.txt']);
    expect(paths("cp 'src dir/a' dest/")).toEqual(['R:src dir/a', 'W:dest/']);
    expect(paths('sed -i "s/a/b/" conf/x.yaml')).toEqual(['W:conf/x.yaml']);
    expect(paths('curl -o /tmp/f https://x.test/a')).toEqual(['R:https://x.test/a', 'W:/tmp/f']);
    expect(paths('FOO=1 mkdir -p x/y; echo ok')).toEqual(['W:x/y']);
    expect(paths('tar -xzf a.tgz -C out/dir')).toContain('W:out/dir');
  });
});

describe('fingerprint safety net', () => {
  useGitIdentity();

  function repo(): { dir: string; cleanup: () => void; floor: string } {
    const t = tempDir();
    const floor = realPath(join(t.dir, 'mobile'));
    mkdirSync(join(floor, 'lib'), { recursive: true });
    git(floor, 'init', '-q');
    writeFileSync(join(floor, 'lib', 'a.dart'), 'a');
    writeFileSync(join(floor, 'lib', 'b.dart'), 'b');
    git(floor, 'add', '.');
    git(floor, 'commit', '-q', '-m', 'inicio');
    return { ...t, floor };
  }

  function watch(floor: string, opts: { attributed?: string[]; active?: boolean; exempt?: string[] } = {}) {
    const findings: GuardFinding[] = [];
    let clock = 1_000;
    const w = new GuardWatch({
      git: runGit,
      floors: () => [{ slug: 'mobile', path: floor }],
      now: () => (clock += 1000),
      attributed: () => new Set(opts.attributed ?? []),
      active: () => opts.active ?? false,
      exempt: () => opts.exempt ?? [],
      report: (f) => findings.push(f),
    });
    return { w, findings };
  }

  test('git status lists every untracked file, also inside new folders', async () => {
    const t = repo();
    mkdirSync(join(t.floor, 'nueva', 'sub'), { recursive: true });
    writeFileSync(join(t.floor, 'nueva', 'sub', 'x.txt'), 'x');
    const snapshot = await snapshotRepo(runGit, t.floor);
    expect([...(snapshot?.keys() ?? [])]).toEqual([join(t.floor, 'nueva', 'sub', 'x.txt')]);
    t.cleanup();
  });

  test('a file that was already modified and changes again is reported as an alert when nobody of the floor worked', async () => {
    const t = repo();
    writeFileSync(join(t.floor, 'lib', 'a.dart'), 'cambio del usuario');
    const { w, findings } = watch(t.floor);
    w.start('artesano-1');
    await w.ready('artesano-1');
    writeFileSync(join(t.floor, 'lib', 'a.dart'), 'otro cambio, más largo');
    const future = Date.now() / 1000 + 60;
    utimesSync(join(t.floor, 'lib', 'a.dart'), future, future);
    writeFileSync(join(t.floor, 'lib', 'b.dart'), 'b2');
    const result = await w.finish('artesano-1');
    expect(result).toHaveLength(1);
    expect(findings[0]).toMatchObject({ level: 'alerta', floor: 'mobile', agentKey: 'artesano-1' });
    expect(findings[0]?.files).toEqual([join(t.floor, 'lib', 'a.dart'), join(t.floor, 'lib', 'b.dart')]);
    expect(w.watching('artesano-1')).toBe(false);
    t.cleanup();
  });

  test('changes made with Edit or Write by agents of the floor are not reported, and Bash activity makes it possible', async () => {
    const t = repo();
    const file = join(t.floor, 'lib', 'b.dart');
    const attributed = watch(t.floor, { attributed: [file] });
    attributed.w.start('redactor-1');
    await attributed.w.ready('redactor-1');
    writeFileSync(file, 'cambio de un desarrollador');
    expect(await attributed.w.finish('redactor-1')).toEqual([]);

    const busy = watch(t.floor, { active: true });
    busy.w.start('redactor-2');
    await busy.w.ready('redactor-2');
    writeFileSync(join(t.floor, 'generado.g.dart'), 'codegen');
    const found = await busy.w.finish('redactor-2');
    expect(found[0]).toMatchObject({ level: 'posible', files: [join(t.floor, 'generado.g.dart')] });
    t.cleanup();
  });

  test('installs by the Mantenimiento lead in the floor skills folder are exempt', async () => {
    const t = repo();
    const skills = join(t.floor, '.claude', 'skills');
    const { w } = watch(t.floor, { exempt: [skills] });
    w.start('lead-mant');
    await w.ready('lead-mant');
    mkdirSync(join(skills, 'pdf'), { recursive: true });
    writeFileSync(join(skills, 'pdf', 'SKILL.md'), '---\nname: pdf\n---\n');
    expect(await w.finish('lead-mant')).toEqual([]);
    t.cleanup();
  });

  test('changed files compare fingerprints', () => {
    const before = new Map([['/a', '1:1'], ['/b', '1:1']]);
    const after = new Map([['/a', '1:1'], ['/b', '2:1'], ['/c', '3:1']]);
    expect(changedFiles(before, after)).toEqual(['/b', '/c']);
  });
});
