import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TemplateError, agentPath } from '../src/agents';
import { DEFAULT_ROLES, PROFILES_DIR, TEMPLATES_DIR, loadConfig, saveConfig, type Paths } from '../src/config';
import { FloorError, agentFile, listFloors, planFloor, regenerateAgents, regenerateAll, removeFloor, render, writeFloor } from '../src/floor-cli';
import { detectStack, loadProfiles } from '../src/profiles';
import { fakePaths, floor, makeRepo, tempDir, testConfig } from './helpers';

const profiles = loadProfiles(PROFILES_DIR);

describe('floor CLI', () => {
  let ctx: { dir: string; cleanup: () => void };
  let p: Paths;

  beforeEach(() => {
    ctx = tempDir();
    p = fakePaths(ctx.dir);
    saveConfig(p, testConfig({ docsRepo: join(ctx.dir, 'docs'), departments: { redaccion: true, mantenimiento: true } }));
  });
  afterEach(() => ctx.cleanup());

  test('a Flutter repository becomes a managed floor with its three agents and its launcher', () => {
    const repo = makeRepo(ctx.dir, 'mobile', { 'pubspec.yaml': 'name: app\n' });
    const plan = planFloor(p, profiles, repo);
    expect(plan).toMatchObject({ slug: 'mobile', stack: 'flutter', existing: [] });
    writeFloor(p, profiles, plan);

    const lead = readFileSync(agentFile(p, 'lead', 'mobile'), 'utf8');
    expect(lead).toContain('name: office-lead-mobile');
    expect(lead).toContain('flutter test <ruta del test>');
    expect(lead).toContain(plan.path);
    expect(readFileSync(agentFile(p, 'dev', 'mobile'), 'utf8')).toContain('`senior-flutter`');
    expect(readFileSync(agentFile(p, 'tester', 'mobile'), 'utf8')).toContain('name: office-tester-mobile');
    for (const role of ['lead', 'dev', 'tester'] as const) {
      expect(readFileSync(agentFile(p, role, 'mobile'), 'utf8')).not.toContain('{{');
    }

    expect(loadConfig(p).floors.mobile).toEqual(floor(plan.path));
    const launcher = readFileSync(join(p.sessionsDir, 'lead-mobile.sh'), 'utf8');
    expect(launcher).toContain("'--agent' 'office-lead-mobile'");
    expect(launcher).toContain('export CLAUDE_CODE_ENABLE_TODO_TOOLS=1');
    expect(launcher).toContain("export AGENT_OFFICE_ROLE='office-lead-mobile'");
    expect(readFileSync(p.officeSh, 'utf8')).toContain("NAMES='director lead-mobile lead-redaccion lead-mantenimiento'");
    expect(readFileSync(p.directorFloors, 'utf8')).toContain('`mobile`: Flutter');
  });

  test('a Laravel repository gets the Laravel skill and test command', () => {
    const repo = makeRepo(ctx.dir, 'backend', { 'composer.json': '{}', artisan: '' });
    writeFloor(p, profiles, planFloor(p, profiles, repo));
    const dev = readFileSync(agentFile(p, 'dev', 'backend'), 'utf8');
    expect(dev).toContain('`laravel-senior-backend`');
    expect(dev).toContain('php artisan test --filter=<Clase>');
  });

  test('a Node floor takes its test command from the package.json scripts and its lockfile', () => {
    const bun = makeRepo(ctx.dir, 'office-dev', {
      'package.json': JSON.stringify({ scripts: { test: 'cd hub && bun test', typecheck: 'tsc --noEmit' } }),
      'bun.lock': '',
    });
    writeFloor(p, profiles, planFloor(p, profiles, bun));
    const tester = readFileSync(agentFile(p, 'tester', 'office-dev'), 'utf8');
    expect(tester).toContain('bun run test (el script test de package.json');
    expect(tester).toContain('bun run typecheck si cambió código TypeScript');
    expect(tester).not.toContain('vitest');

    const npm = makeRepo(ctx.dir, 'web', { 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) });
    writeFloor(p, profiles, planFloor(p, profiles, npm));
    expect(readFileSync(agentFile(p, 'lead', 'web'), 'utf8')).toContain('El comando de tests de esta planta es: npm test (el script test');

    const bare = makeRepo(ctx.dir, 'scripts-node', { 'package.json': '{}' });
    writeFloor(p, profiles, planFloor(p, profiles, bare));
    expect(readFileSync(agentFile(p, 'tester', 'scripts-node'), 'utf8')).toContain('npx vitest run <spec>');
  });

  test('a repository without a profile skill says so', () => {
    const repo = makeRepo(ctx.dir, 'scripts');
    writeFloor(p, profiles, planFloor(p, profiles, repo));
    expect(readFileSync(agentFile(p, 'dev', 'scripts'), 'utf8')).toContain('no tiene una skill propia');
  });

  test('two folders with the same name need --slug', () => {
    const first = makeRepo(join(ctx.dir, 'a'), 'mobile');
    const second = makeRepo(join(ctx.dir, 'b'), 'mobile');
    writeFloor(p, profiles, planFloor(p, profiles, first));
    expect(() => planFloor(p, profiles, second)).toThrow(FloorError);
    expect(planFloor(p, profiles, second, 'mobile-b').slug).toBe('mobile-b');
  });

  test('the same folder cannot be two floors and reserved names are refused', () => {
    const repo = makeRepo(ctx.dir, 'mobile');
    writeFloor(p, profiles, planFloor(p, profiles, repo));
    expect(() => planFloor(p, profiles, repo, 'otra')).toThrow(FloorError);
    expect(() => planFloor(p, profiles, repo, 'direccion')).toThrow(FloorError);
    expect(() => planFloor(p, profiles, join(ctx.dir, 'nope'))).toThrow(FloorError);
  });

  test('existing agents are reported before overwriting', () => {
    const repo = makeRepo(ctx.dir, 'mobile');
    writeFloor(p, profiles, planFloor(p, profiles, repo));
    expect(planFloor(p, profiles, repo).existing).toHaveLength(3);
  });

  test('removing a floor deletes its agents and its launcher and keeps it observed', () => {
    const repo = makeRepo(ctx.dir, 'mobile');
    writeFloor(p, profiles, planFloor(p, profiles, repo));
    expect(removeFloor(p, profiles, 'mobile')).toHaveLength(3);
    expect(existsSync(agentFile(p, 'lead', 'mobile'))).toBe(false);
    expect(existsSync(join(p.sessionsDir, 'lead-mobile.sh'))).toBe(false);
    expect(loadConfig(p).floors.mobile?.managed).toBe(false);
    expect(readFileSync(p.officeSh, 'utf8')).toContain("NAMES='director lead-redaccion lead-mantenimiento'");
    expect(() => removeFloor(p, profiles, 'nope')).toThrow(FloorError);
  });

  test('regenerating all floors applies a changed template without asking', () => {
    const repo = makeRepo(ctx.dir, 'mobile');
    writeFloor(p, profiles, planFloor(p, profiles, repo));
    const templates = join(ctx.dir, 'templates');
    cpSync(TEMPLATES_DIR, templates, { recursive: true });
    writeFileSync(join(templates, 'lead.md.tpl'), `${readFileSync(join(templates, 'lead.md.tpl'), 'utf8')}\nVERSIÓN 2\n`);
    expect(regenerateAll(p, profiles, templates)).toEqual([{ slug: 'mobile' }]);
    expect(readFileSync(agentFile(p, 'lead', 'mobile'), 'utf8')).toContain('VERSIÓN 2');
  });

  test('every agent carries the model and effort of its role', () => {
    const config = loadConfig(p);
    config.roles = { ...DEFAULT_ROLES, dev: { model: 'haiku', effort: 'low' }, redactor: { model: 'claude-opus-5-5', effort: 'max' } };
    saveConfig(p, config);
    writeFloor(p, profiles, planFloor(p, profiles, makeRepo(ctx.dir, 'mobile', { 'pubspec.yaml': '' })));
    const dev = readFileSync(agentFile(p, 'dev', 'mobile'), 'utf8');
    expect(dev).toContain('model: haiku\neffort: low');
    expect(readFileSync(agentFile(p, 'lead', 'mobile'), 'utf8')).toContain('model: sonnet\neffort: medium');
    expect(readFileSync(agentPath(p, 'office-director'), 'utf8')).toContain('model: fable\neffort: xhigh');
    expect(readFileSync(agentPath(p, 'office-redactor'), 'utf8')).toContain('model: claude-opus-5-5\neffort: max');
    expect(readFileSync(agentPath(p, 'office-revisor-planes'), 'utf8')).toContain('tools: Read, Grep, Glob, SendMessage');
    for (const name of ['office-director', 'office-reviewer', 'office-lead-redaccion', 'office-redactor', 'office-revisor-planes', 'office-lead-mantenimiento', 'office-artesano', 'office-revisor-skills']) {
      const content = readFileSync(agentPath(p, name), 'utf8');
      expect(content).toContain(`name: ${name}`);
      expect(content).not.toContain('{{');
    }
    expect(readFileSync(agentPath(p, 'office-lead-redaccion'), 'utf8')).toContain(join(ctx.dir, 'docs'));
    expect(readFileSync(agentPath(p, 'office-lead-redaccion'), 'utf8')).toContain('`mobile`: Flutter');
    expect(readFileSync(agentPath(p, 'office-lead-mantenimiento'), 'utf8')).toContain(p.skillsDir);
  });

  test('turning a department off removes its agents and its launcher', () => {
    writeFloor(p, profiles, planFloor(p, profiles, makeRepo(ctx.dir, 'mobile')));
    expect(existsSync(agentPath(p, 'office-artesano'))).toBe(true);
    const config = loadConfig(p);
    config.departments.mantenimiento = false;
    saveConfig(p, config);
    const result = regenerateAgents(p, profiles);
    expect(result.floors).toEqual([{ slug: 'mobile' }]);
    expect(result.files).toBe(3 + 5);
    for (const name of ['office-lead-mantenimiento', 'office-artesano', 'office-revisor-skills']) expect(existsSync(agentPath(p, name))).toBe(false);
    expect(existsSync(agentPath(p, 'office-redactor'))).toBe(true);
    expect(existsSync(join(p.sessionsDir, 'lead-mantenimiento.sh'))).toBe(false);
    expect(existsSync(join(p.sessionsDir, 'lead-redaccion.sh'))).toBe(true);
  });

  test('a floor whose folder disappeared is reported and the rest is regenerated', () => {
    const config = loadConfig(p);
    config.floors.gone = floor(join(ctx.dir, 'gone'));
    saveConfig(p, config);
    const result = regenerateAgents(p, profiles);
    expect(result.floors[0]?.error).toContain('No existe');
    expect(existsSync(agentPath(p, 'office-director'))).toBe(true);
  });

  test('department names are reserved', () => {
    const repo = makeRepo(ctx.dir, 'redaccion');
    expect(() => planFloor(p, profiles, repo)).toThrow(FloorError);
    expect(() => planFloor(p, profiles, makeRepo(ctx.dir, 'x'), 'mantenimiento')).toThrow(FloorError);
  });

  test('listing shows each floor with its kind', () => {
    expect(listFloors(p, profiles)).toContain('No hay plantas');
    writeFloor(p, profiles, planFloor(p, profiles, makeRepo(ctx.dir, 'mobile', { 'pubspec.yaml': '' })));
    expect(listFloors(p, profiles)).toMatch(/mobile\s+gestionada\s+Flutter/);
  });
});

describe('templates and stacks', () => {
  test('rendering refuses unknown variables', () => {
    expect(render('hola {{slug}}', { slug: 'x' })).toBe('hola x');
    expect(() => render('hola {{nadie}}', {})).toThrow(TemplateError);
  });

  test('stack detection', () => {
    const { dir, cleanup } = tempDir();
    expect(detectStack(makeRepo(dir, 'f', { 'pubspec.yaml': '' }))).toBe('flutter');
    expect(detectStack(makeRepo(dir, 'l', { 'composer.json': '{}', artisan: '' }))).toBe('laravel');
    expect(detectStack(makeRepo(dir, 'c', { 'composer.json': '{}' }))).toBe('generic');
    expect(detectStack(makeRepo(dir, 'n', { 'package.json': '{}' }))).toBe('node');
    cleanup();
  });
});
