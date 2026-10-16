import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { LAUNCH_TTL_MS, PANEL_TTL_MS, claimLaunchToken, mintLaunchToken, mintPanelToken, newNonce, verifyPanelToken } from '../src/panel-auth';
import { hubPort, panelUrl } from '../src/panel-url';
import { fakePaths, tempDir } from './helpers';

const KEY = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const NOW = 1_800_000_000_000;

describe('launch link', () => {
  test('has the l1.<ts36>.<nonce>.<mac> shape', () => {
    const nonce = newNonce();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(mintLaunchToken(KEY, NOW, nonce)).toMatch(new RegExp(`^l1\\.${NOW.toString(36)}\\.${nonce}\\.[A-Za-z0-9_-]{43}$`));
  });

  test('is claimed once, and a second claim of the same nonce fails', () => {
    const used = new Map<string, number>();
    const link = mintLaunchToken(KEY, NOW, newNonce());
    expect(claimLaunchToken(KEY, link, NOW + 1000, used)).toBe(true);
    expect(claimLaunchToken(KEY, link, NOW + 2000, used)).toBe(false);
    expect(claimLaunchToken(KEY, mintLaunchToken(KEY, NOW, newNonce()), NOW + 3000, used)).toBe(true);
  });

  test('expires after ten minutes and refuses a timestamp from the future', () => {
    const used = new Map<string, number>();
    expect(claimLaunchToken(KEY, mintLaunchToken(KEY, NOW, newNonce()), NOW + LAUNCH_TTL_MS, used)).toBe(false);
    expect(claimLaunchToken(KEY, mintLaunchToken(KEY, NOW, newNonce()), NOW + LAUNCH_TTL_MS - 1, used)).toBe(true);
    expect(claimLaunchToken(KEY, mintLaunchToken(KEY, NOW + 5000, newNonce()), NOW, used)).toBe(false);
  });

  test('a forged or tampered link is refused and spends nothing', () => {
    const used = new Map<string, number>();
    const nonce = newNonce();
    const link = mintLaunchToken(KEY, NOW, nonce);
    expect(claimLaunchToken(OTHER, link, NOW, used)).toBe(false);
    expect(claimLaunchToken(KEY, link.replace(nonce, newNonce()), NOW, used)).toBe(false);
    expect(claimLaunchToken(KEY, `${link.slice(0, -1)}${link.endsWith('A') ? 'B' : 'A'}`, NOW, used)).toBe(false);
    expect(claimLaunchToken(KEY, mintPanelToken(KEY, NOW), NOW, used)).toBe(false);
    expect(claimLaunchToken(KEY, 42, NOW, used)).toBe(false);
    expect(claimLaunchToken('', link, NOW, used)).toBe(false);
    expect(used.size).toBe(0);
    expect(claimLaunchToken(KEY, link, NOW, used)).toBe(true);
  });

  test('spent nonces are purged once their link could no longer be claimed', () => {
    const used = new Map<string, number>();
    claimLaunchToken(KEY, mintLaunchToken(KEY, NOW, newNonce()), NOW, used);
    expect(used.size).toBe(1);
    claimLaunchToken(KEY, 'nada', NOW + LAUNCH_TTL_MS, used);
    expect(used.size).toBe(0);
  });
});

describe('panel token', () => {
  test('is valid for thirty days with the key that signed it', () => {
    const token = mintPanelToken(KEY, NOW);
    expect(token).toMatch(/^p1\.[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
    expect(verifyPanelToken(KEY, token, NOW)).toBe(true);
    expect(verifyPanelToken(KEY, token, NOW + PANEL_TTL_MS - 1)).toBe(true);
    expect(verifyPanelToken(KEY, token, NOW + PANEL_TTL_MS)).toBe(false);
  });

  test('a token signed with the previous key, from the future or malformed is refused', () => {
    expect(verifyPanelToken(OTHER, mintPanelToken(KEY, NOW), NOW)).toBe(false);
    expect(verifyPanelToken(KEY, mintPanelToken(KEY, NOW + 1000), NOW)).toBe(false);
    expect(verifyPanelToken(KEY, mintLaunchToken(KEY, NOW, newNonce()), NOW)).toBe(false);
    expect(verifyPanelToken(KEY, KEY, NOW)).toBe(false);
    expect(verifyPanelToken(KEY, undefined, NOW)).toBe(false);
  });
});

describe('panel url', () => {
  test('points at the hub port with a claimable launch link', () => {
    const nonce = newNonce();
    const url = new URL(panelUrl(4799, KEY, NOW, nonce));
    expect(`${url.origin}${url.pathname}`).toBe('http://127.0.0.1:4799/');
    expect(url.searchParams.get('t')).toBe(mintLaunchToken(KEY, NOW, nonce));
    expect(claimLaunchToken(KEY, url.searchParams.get('t'), NOW, new Map())).toBe(true);
  });

  test('reads the port file the hub writes and falls back to the default port', () => {
    const { dir, cleanup } = tempDir();
    const p = fakePaths(dir);
    expect(hubPort(p)).toBe(4747);
    writeFileSync(p.port, '4799\n');
    expect(hubPort(p)).toBe(4799);
    writeFileSync(p.port, 'nada');
    expect(hubPort(p)).toBe(4747);
    cleanup();
  });
});
