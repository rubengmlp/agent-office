import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STACKS } from './config';
import type { CheckSpec, FloorConfig, GateMode, Profile, Stack } from './types';

export { STACKS };

export type CompiledProfile = Profile & { stack: Stack; test: RegExp; check: RegExp };

export type Profiles = Map<Stack, CompiledProfile>;

const FALLBACK: Profile = {
  label: 'Genérico',
  skill: null,
  testRegex: '\\b(bun|npm|pnpm|yarn|deno)\\s+(run\\s+)?test\\b|\\bpytest\\b|\\bgo\\s+test\\b|\\bcargo\\s+test\\b|\\bmix\\s+test\\b|\\bmake\\s+test\\b|\\bctest\\b|\\b(mvn|gradle|gradlew)\\s+test\\b|\\bdotnet\\s+test\\b|\\bswift\\s+test\\b|\\b(vitest|jest|mocha|rspec|phpunit|pest)\\b|\\bphp\\s+artisan\\s+test\\b|\\bflutter\\s+test\\b|\\bdart\\s+test\\b',
  checkRegex: '\\blint\\b',
  testCommand: 'el comando de tests que documente el repositorio',
  checkFiles: [],
};

export function compileProfile(stack: Stack, profile: Profile): CompiledProfile {
  return {
    ...profile,
    stack,
    test: new RegExp(profile.testRegex),
    check: new RegExp(profile.checkRegex),
  };
}

export function loadProfiles(dir: string): Profiles {
  const profiles: Profiles = new Map();
  for (const stack of STACKS) {
    const file = join(dir, `${stack}.json`);
    if (!existsSync(file)) continue;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Profile>;
    profiles.set(
      stack,
      compileProfile(stack, {
        label: raw.label ?? stack,
        skill: raw.skill ?? null,
        testRegex: raw.testRegex ?? FALLBACK.testRegex,
        checkRegex: raw.checkRegex ?? FALLBACK.checkRegex,
        testCommand: raw.testCommand ?? FALLBACK.testCommand,
        checkFiles: Array.isArray(raw.checkFiles) ? raw.checkFiles.filter((f): f is string => typeof f === 'string') : [],
      }),
    );
  }
  if (!profiles.has('generic')) profiles.set('generic', compileProfile('generic', FALLBACK));
  return profiles;
}

export function profileFor(profiles: Profiles, stack: Stack): CompiledProfile {
  return profiles.get(stack) ?? profiles.get('generic') ?? compileProfile('generic', FALLBACK);
}

function packageScripts(dir: string): Record<string, unknown> | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const scripts = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).scripts : null;
    return scripts && typeof scripts === 'object' ? (scripts as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function packageRunner(dir: string): 'bun' | 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))) return 'bun';
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export function testCommandFor(dir: string, profile: CompiledProfile): string {
  if (profile.stack !== 'node') return profile.testCommand;
  const scripts = packageScripts(dir);
  if (!scripts || typeof scripts.test !== 'string') return profile.testCommand;
  const runner = packageRunner(dir);
  const run = (name: string) => (runner === 'npm' && name === 'test' ? 'npm test' : `${runner} run ${name}`);
  const typecheck = typeof scripts.typecheck === 'string' ? `, y ${run('typecheck')} si cambió código TypeScript` : '';
  return `${run('test')} (el script test de package.json; añade la ruta o el filtro de lo que cambió si el script lo admite)${typecheck}`;
}

function nodeRun(dir: string, name: string): string {
  const runner = packageRunner(dir);
  return runner === 'npm' && name === 'test' ? 'npm test' : `${runner} run ${name}`;
}

// What a floor runs to prepare a fresh worktree when its config says nothing: a null is "nothing to prepare".
export function defaultSetup(dir: string, stack: Stack): string | null {
  switch (stack) {
    case 'flutter':
      return 'flutter pub get';
    case 'node':
      return packageScripts(dir) ? `${packageRunner(dir)} install` : null;
    case 'laravel':
      return 'composer install --no-interaction';
    default:
      return null;
  }
}

// The checks of a stack when the floor defines none. Node reads the scripts of its package.json.
export function defaultChecks(dir: string, stack: Stack): CheckSpec[] {
  switch (stack) {
    case 'flutter':
      return [
        { name: 'analyze', command: 'flutter analyze' },
        { name: 'test', command: 'flutter test' },
      ];
    case 'node': {
      const scripts = packageScripts(dir);
      if (!scripts) return [];
      return ['test', 'typecheck', 'lint'].filter((name) => typeof scripts[name] === 'string').map((name) => ({ name, command: nodeRun(dir, name) }));
    }
    case 'laravel':
      return [
        { name: 'test', command: 'php artisan test' },
        { name: 'pint', command: 'vendor/bin/pint --test' },
      ];
    default:
      return [];
  }
}

export function checksOf(floor: Pick<FloorConfig, 'path' | 'stack' | 'checks'>): CheckSpec[] {
  return floor.checks ?? defaultChecks(floor.path, floor.stack);
}

export function setupOf(floor: Pick<FloorConfig, 'path' | 'stack' | 'setup'>): string | null {
  return floor.setup === undefined ? defaultSetup(floor.path, floor.stack) : floor.setup;
}

// 'checks' when the floor has something to run, else the tester alone as before the Tablero.
export function gateModeOf(floor: Pick<FloorConfig, 'path' | 'stack' | 'checks' | 'gateMode'>): GateMode {
  if (floor.gateMode) return floor.gateMode;
  return checksOf(floor).length > 0 ? 'checks' : 'tester';
}

// Every pattern that says "the checks changed" for a floor: its stack's and the floor's own.
export function checkFilesOf(profiles: Profiles, floor: Pick<FloorConfig, 'stack' | 'checkFiles'>): string[] {
  return [...new Set([...profileFor(profiles, floor.stack).checkFiles, ...(floor.checkFiles ?? [])])];
}

export function detectStack(dir: string): Stack {
  if (existsSync(join(dir, 'pubspec.yaml'))) return 'flutter';
  if (existsSync(join(dir, 'composer.json')) && existsSync(join(dir, 'artisan'))) return 'laravel';
  if (existsSync(join(dir, 'package.json'))) return 'node';
  return 'generic';
}
