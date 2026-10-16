import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { agentPath } from '../src/agents';
import { DEFAULT_ROLES, PROFILES_DIR, loadConfig, saveConfig } from '../src/config';
import { planFloor, writeFloor } from '../src/floor-cli';
import { loadProfiles } from '../src/profiles';
import { applySettings, createSettings, settingsView } from '../src/settings';
import type { OfficeConfig } from '../src/types';
import { fakePaths, floor, keyOf, makeRepo, tempDir, testConfig, useGitIdentity } from './helpers';

useGitIdentity();
const profiles = loadProfiles(PROFILES_DIR);

describe('settings', () => {
  test('an update changes only what it names', () => {
    const config = testConfig({ floors: { mobile: floor('/m') } });
    const result = applySettings(config, {
      roles: { dev: { model: 'haiku' }, 'revisor-planes': { effort: 'max' } },
      departments: { redaccion: true },
      review: { maxRounds: 6 },
      memory: { maxContextChars: 2000 },
      floors: { mobile: { baseBranch: 'main' } },
    });
    if ('error' in result) throw new Error(JSON.stringify(result.error));
    expect(result.changed).toBe(true);
    expect(result.config.roles.dev).toEqual({ model: 'haiku', effort: DEFAULT_ROLES.dev.effort });
    expect(result.config.roles['revisor-planes']).toEqual({ model: DEFAULT_ROLES['revisor-planes'].model, effort: 'max' });
    expect(result.config.roles.tester).toEqual(DEFAULT_ROLES.tester);
    expect(result.config.departments).toEqual({ redaccion: true, mantenimiento: false });
    expect(result.config.review.maxRounds).toBe(6);
    expect(result.config.memory.maxContextChars).toBe(2000);
    expect(result.config.floors.mobile?.baseBranch).toBe('main');
    expect(config.roles.dev.model).toBe(DEFAULT_ROLES.dev.model);
    expect(applySettings(config, {})).toMatchObject({ changed: false });
  });

  test('every invalid value is explained and nothing is applied', () => {
    const config = testConfig({ floors: { mobile: floor('/m') } });
    const result = applySettings(config, {
      roles: { dev: { model: 'opus; rm -rf /' }, tester: { effort: 'turbo' }, jefe: { model: 'opus' } },
      departments: { redaccion: 'si' },
      review: { maxRounds: 0 },
      memory: { maxLessons: 1000 },
      floors: { mobile: { baseBranch: '../main' }, nada: { baseBranch: 'main' } },
    });
    expect('error' in result).toBe(true);
    const error = 'error' in result ? result.error : [];
    expect(error.map(keyOf)).toEqual([
      'hub.settings.badModel',
      'hub.settings.badEffort',
      'hub.settings.unknownRole',
      'hub.settings.badDepartment',
      'hub.settings.badRange',
      'hub.settings.badRange',
      'hub.settings.badBranch',
      'hub.settings.noFloor',
    ]);
  });

  test('the view lists roles, departments, limits and floors with their base branch', () => {
    const view = settingsView(testConfig({ floors: { b: floor('/b', false, 'laravel'), a: floor('/a') } }));
    expect(view.floors.map((f) => [f.slug, f.managed, f.baseBranch])).toEqual([
      ['a', true, 'develop'],
      ['b', false, 'develop'],
    ]);
    expect(Object.keys(view.roles)).toHaveLength(9);
    expect(view.port).toBe(4747);
  });

  test('saving writes the config, regenerates every agent with the chosen model and creates the documents repository', () => {
    const { dir, cleanup } = tempDir();
    const p = fakePaths(dir);
    saveConfig(p, testConfig({ docsRepo: join(dir, 'docs'), departments: { redaccion: false, mantenimiento: false } }));
    writeFloor(p, profiles, planFloor(p, profiles, makeRepo(dir, 'mobile', { 'pubspec.yaml': '' })));
    const saved: OfficeConfig[] = [];
    const settings = createSettings(p, () => profiles, (config) => saved.push(config));
    expect(settings.view().departments).toEqual({ redaccion: false, mantenimiento: false });
    const result = settings.update({ roles: { dev: { model: 'haiku', effort: 'low' } }, departments: { mantenimiento: true } });
    expect(result).toMatchObject({ ok: true, regenerated: 3 + 2 + 3, note: [{ key: 'hub.settings.saved' }] });
    expect(readFileSync(agentPath(p, 'office-dev-mobile'), 'utf8')).toContain('model: haiku\neffort: low');
    expect(existsSync(agentPath(p, 'office-artesano'))).toBe(true);
    expect(existsSync(agentPath(p, 'office-redactor'))).toBe(false);
    expect(existsSync(join(dir, 'docs', '.git'))).toBe(true);
    expect(existsSync(join(dir, 'docs', 'taller', 'skills'))).toBe(true);
    expect(readFileSync(join(dir, 'docs', '.gitignore'), 'utf8')).toContain('redaccion/.fuentes/');
    expect(loadConfig(p).roles.dev).toEqual({ model: 'haiku', effort: 'low' });
    expect(saved).toHaveLength(1);
    expect(readFileSync(join(p.sessionsDir, 'lead-mantenimiento.sh'), 'utf8')).toContain('/health');
    expect(settings.update({ roles: { dev: { model: 'haiku' } } })).toMatchObject({ ok: true, regenerated: 0, note: [{ key: 'hub.settings.noChanges' }] });
    expect(settings.update({ review: { maxRounds: 50 } })).toMatchObject({ ok: false });
    expect(saved).toHaveLength(1);

    const repo = loadConfig(p).floors.mobile!.path;
    rmSync(repo, { recursive: true, force: true });
    const partial = settings.update({ roles: { dev: { effort: 'high' } } });
    expect(partial).toMatchObject({ ok: true });
    expect(partial.ok && partial.note).toContainEqual({
      key: 'hub.settings.regenerateFailed',
      params: { slug: 'mobile', error: { key: 'hub.floors.missing', params: { path: repo } } },
    });
    expect(saved).toHaveLength(2);
    cleanup();
  });
});
