import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STACKS } from './config';
import type { Profile, Stack } from './types';

export { STACKS };

export type CompiledProfile = Profile & { stack: Stack; test: RegExp; check: RegExp };

export type Profiles = Map<Stack, CompiledProfile>;

const FALLBACK: Profile = {
  label: 'Genérico',
  skill: null,
  testRegex: '\\btest\\b',
  checkRegex: '\\blint\\b',
  testCommand: 'el comando de tests que documente el repositorio',
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
      }),
    );
  }
  if (!profiles.has('generic')) profiles.set('generic', compileProfile('generic', FALLBACK));
  return profiles;
}

export function profileFor(profiles: Profiles, stack: Stack): CompiledProfile {
  return profiles.get(stack) ?? profiles.get('generic') ?? compileProfile('generic', FALLBACK);
}

export function detectStack(dir: string): Stack {
  if (existsSync(join(dir, 'pubspec.yaml'))) return 'flutter';
  if (existsSync(join(dir, 'composer.json')) && existsSync(join(dir, 'artisan'))) return 'laravel';
  if (existsSync(join(dir, 'package.json'))) return 'node';
  return 'generic';
}
