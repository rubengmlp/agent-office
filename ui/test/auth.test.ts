import { describe, expect, test } from 'bun:test';
import { PANEL_STORAGE_KEY, forgetPanelToken, panelCredential, stripLaunchToken, type PanelEnv, type PanelStorage } from '../src/auth';

class MemoryStorage implements PanelStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

function env(overrides: Partial<PanelEnv> = {}): PanelEnv & { replaced: string[]; claims: string[] } {
  const replaced: string[] = [];
  const claims: string[] = [];
  return {
    injected: undefined,
    search: '',
    storage: new MemoryStorage(),
    replaceSearch: (search) => replaced.push(search),
    claim: async (launch) => {
      claims.push(launch);
      return launch === 'l1.good' ? 'p1.fresh' : null;
    },
    ...overrides,
    replaced,
    claims,
  };
}

describe('stripLaunchToken', () => {
  test('takes the launch token out and keeps view and replay as they were', () => {
    expect(stripLaunchToken('?t=l1.abc.def.ghi&view=3d')).toEqual({ launch: 'l1.abc.def.ghi', search: '?view=3d' });
    expect(stripLaunchToken('?replay=/replays/demo.json&t=l1.x&view=3d')).toEqual({ launch: 'l1.x', search: '?replay=/replays/demo.json&view=3d' });
    expect(stripLaunchToken('?t=l1.x')).toEqual({ launch: 'l1.x', search: '' });
  });

  test('without a launch token the search stays the same', () => {
    expect(stripLaunchToken('')).toEqual({ launch: null, search: '' });
    expect(stripLaunchToken('?view=3d')).toEqual({ launch: null, search: '?view=3d' });
    expect(stripLaunchToken('?t=&view=2d')).toEqual({ launch: null, search: '?view=2d' });
    expect(stripLaunchToken('?tab=plans')).toEqual({ launch: null, search: '?tab=plans' });
  });
});

describe('panelCredential', () => {
  test('the token Vite injects in dev wins and nothing is claimed', async () => {
    const e = env({ injected: 'p1.dev', search: '?t=l1.good' });
    expect(await panelCredential(e)).toBe('p1.dev');
    expect(e.claims).toEqual([]);
  });

  test('a launch link is taken out of the address, claimed and stored', async () => {
    const storage = new MemoryStorage();
    const e = env({ search: '?t=l1.good&view=3d', storage });
    expect(await panelCredential(e)).toBe('p1.fresh');
    expect(e.replaced).toEqual(['?view=3d']);
    expect(e.claims).toEqual(['l1.good']);
    expect(storage.getItem(PANEL_STORAGE_KEY)).toBe('p1.fresh');
  });

  test('a spent link falls back to the stored token, and without one the panel stays locked', async () => {
    const storage = new MemoryStorage();
    storage.setItem(PANEL_STORAGE_KEY, 'p1.old');
    const spent = env({ search: '?t=l1.used', storage });
    expect(await panelCredential(spent)).toBe('p1.old');
    expect(spent.replaced).toEqual(['']);
    expect(await panelCredential(env({ search: '?t=l1.used' }))).toBeNull();
    expect(await panelCredential(env())).toBeNull();
  });

  test('the stored token is used when there is no link, and forgetting it locks the panel', async () => {
    const storage = new MemoryStorage();
    storage.setItem(PANEL_STORAGE_KEY, 'p1.old');
    const e = env({ storage });
    expect(await panelCredential(e)).toBe('p1.old');
    expect(e.replaced).toEqual([]);
    forgetPanelToken(storage);
    expect(await panelCredential(env({ storage }))).toBeNull();
  });

  test('blocked storage never throws', async () => {
    const blocked: PanelStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(await panelCredential(env({ search: '?t=l1.good', storage: blocked }))).toBe('p1.fresh');
    expect(await panelCredential(env({ storage: blocked }))).toBeNull();
    expect(() => forgetPanelToken(blocked)).not.toThrow();
  });
});
