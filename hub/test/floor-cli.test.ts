import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES_DIR, TEMPLATES_DIR, loadConfig, type Paths } from '../src/config';
import { FloorError, agentFile, listFloors, planFloor, regenerateAll, removeFloor, render, writeFloor } from '../src/floor-cli';
import { detectStack, loadProfiles } from '../src/profiles';
import { fakePaths, makeRepo, tempDir } from './helpers';

const profiles = loadProfiles(PROFILES_DIR);

describe('floor CLI', () => {
  let ctx: { dir: string; cleanup: () => void };
  let p: Paths;

  beforeEach(() => {
    ctx = tempDir();
    p = fakePaths(ctx.dir);
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

    expect(loadConfig(p).floors.mobile).toEqual({ path: plan.path, stack: 'flutter', managed: true });
    const launcher = readFileSync(join(p.sessionsDir, 'lead-mobile.sh'), 'utf8');
    expect(launcher).toContain("'--agent' 'office-lead-mobile'");
    expect(launcher).toContain('export CLAUDE_CODE_ENABLE_TODO_TOOLS=1');
    expect(launcher).toContain("export AGENT_OFFICE_ROLE='office-lead-mobile'");
    expect(readFileSync(p.officeSh, 'utf8')).toContain("NAMES='director lead-mobile'");
    expect(readFileSync(p.directorFloors, 'utf8')).toContain('`mobile`: Flutter');
  });

  test('a Laravel repository gets the Laravel skill and test command', () => {
    const repo = makeRepo(ctx.dir, 'backend', { 'composer.json': '{}', artisan: '' });
    writeFloor(p, profiles, planFloor(p, profiles, repo));
    const dev = readFileSync(agentFile(p, 'dev', 'backend'), 'utf8');
    expect(dev).toContain('`laravel-senior-backend`');
    expect(dev).toContain('php artisan test --filter=<Clase>');
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
    expect(readFileSync(p.officeSh, 'utf8')).toContain("NAMES='director'");
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

  test('listing shows each floor with its kind', () => {
    expect(listFloors(p, profiles)).toContain('No hay plantas');
    writeFloor(p, profiles, planFloor(p, profiles, makeRepo(ctx.dir, 'mobile', { 'pubspec.yaml': '' })));
    expect(listFloors(p, profiles)).toMatch(/mobile\s+gestionada\s+Flutter/);
  });
});

describe('templates and stacks', () => {
  test('rendering refuses unknown variables', () => {
    expect(render('hola {{slug}}', { slug: 'x' })).toBe('hola x');
    expect(() => render('hola {{nadie}}', {})).toThrow(FloorError);
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
