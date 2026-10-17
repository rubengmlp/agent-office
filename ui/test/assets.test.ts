import { describe, expect, test } from 'bun:test';
import { AssetLibrary, DEFAULT_MANIFEST, modelKey, type LoadedModel } from '../src/scene/assets';

type Load = (url: string, custom: boolean) => Promise<LoadedModel | null>;

function library(load: Load, custom: string[] = []): AssetLibrary {
  const assets = new AssetLibrary('/assets/characters/', DEFAULT_MANIFEST);
  Object.assign(assets, { load, customNames: async () => new Set(custom) });
  return assets;
}

const model = (url: string, custom: boolean): LoadedModel => ({ url, custom } as unknown as LoadedModel);

describe('AssetLibrary.modelFor', () => {
  test('keys the cache by role and model', () => {
    expect(modelKey('dev', undefined)).toBe('dev|');
    expect(modelKey('dev', 'quaternius/punk.glb')).toBe('dev|quaternius/punk.glb');
  });

  test('without an override it loads the model of the manifest once', async () => {
    const urls: string[] = [];
    const assets = library(async (url, custom) => (urls.push(url), model(url, custom)));
    const [a, b] = await Promise.all([assets.modelFor('dev'), assets.modelFor('dev', {})]);
    expect(a).toBe(b);
    expect(urls).toEqual(['/assets/characters/quaternius/hoodie.glb']);
    expect(await assets.modelFor('dev', { furniture: { coffee: { u: 0, v: 0 } }, characters: { lead: 'quaternius/king.glb' } })).toBe(a);
  });

  test('an override loads its own model and reloads only the role it names', async () => {
    const urls: string[] = [];
    const assets = library(async (url, custom) => (urls.push(url), model(url, custom)));
    const override = { characters: { dev: 'quaternius/punk.glb' as const } };
    const original = await assets.modelFor('dev');
    const changed = await assets.modelFor('dev', override);
    expect(changed).not.toBe(original);
    expect(changed?.url).toBe('/assets/characters/quaternius/punk.glb');
    expect(await assets.modelFor('dev', override)).toBe(changed);
    await assets.modelFor('lead', override);
    await assets.modelFor('lead');
    expect(urls).toEqual([
      '/assets/characters/quaternius/hoodie.glb',
      '/assets/characters/quaternius/punk.glb',
      '/assets/characters/quaternius/casual.glb',
    ]);
  });

  test('a model of the custom folder is loaded as custom', async () => {
    const seen: [string, boolean][] = [];
    const assets = library(async (url, custom) => (seen.push([url, custom]), model(url, custom)));
    await assets.modelFor('tester', { characters: { tester: 'custom/hero.glb' } });
    expect(seen).toEqual([['/assets/characters/custom/hero.glb', true]]);
  });

  test('a model that does not load falls back to the one of the role', async () => {
    const assets = library(async (url, custom) => (url.endsWith('missing.glb') ? null : model(url, custom)));
    const result = await assets.modelFor('reviewer', { characters: { reviewer: 'custom/missing.glb' } });
    expect(result?.url).toBe('/assets/characters/quaternius/punk.glb');
  });

  test('a custom model of the role itself still wins over the pack when there is no override', async () => {
    const assets = library(async (url, custom) => model(url, custom), ['dev.glb']);
    expect((await assets.modelFor('dev'))?.custom).toBe(true);
  });
});
