export const PANEL_STORAGE_KEY = 'agent-office.panel';

export type PanelStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type PanelEnv = {
  injected: string | undefined;
  search: string;
  storage: PanelStorage | null;
  replaceSearch(search: string): void;
  claim(launch: string): Promise<string | null>;
};

export function stripLaunchToken(search: string): { launch: string | null; search: string } {
  let launch: string | null = null;
  const kept: string[] = [];
  for (const part of search.replace(/^\?/, '').split('&')) {
    if (part === '') continue;
    if (part === 't' || part.startsWith('t=')) launch = new URLSearchParams(part).get('t') || null;
    else kept.push(part);
  }
  return { launch, search: kept.length > 0 ? `?${kept.join('&')}` : '' };
}

function stored(storage: PanelStorage | null): string | null {
  try {
    return storage?.getItem(PANEL_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function forgetPanelToken(storage: PanelStorage | null): void {
  try {
    storage?.removeItem(PANEL_STORAGE_KEY);
  } catch {}
}

export async function panelCredential(env: PanelEnv): Promise<string | null> {
  if (env.injected) return env.injected;
  const { launch, search } = stripLaunchToken(env.search);
  if (launch !== null) {
    env.replaceSearch(search);
    const token = await env.claim(launch);
    if (token) {
      try {
        env.storage?.setItem(PANEL_STORAGE_KEY, token);
      } catch {}
      return token;
    }
  }
  return stored(env.storage);
}

async function claimLaunch(launch: string): Promise<string | null> {
  try {
    const response = await fetch('/api/panel/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: launch }),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const token = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).token : null;
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

export function browserStorage(): PanelStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function browserPanelEnv(): PanelEnv {
  return {
    injected: window.__OFFICE_PANEL__,
    search: location.search,
    storage: browserStorage(),
    replaceSearch: (search) => history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`),
    claim: claimLaunch,
  };
}
