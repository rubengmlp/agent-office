import { beforeEach, describe, expect, test } from 'bun:test';
import type { OfficeApi } from '../src/api';
import { t } from '../src/i18n/index';
import { UNDO_MS, discardDocument } from '../src/panel/deliverables';
import type { Store, ToastKind, ToastOptions } from '../src/store';
import type { DocumentView } from '../src/types';

Object.assign(globalThis, { window: { confirm: () => true } });

type Shown = { text: string; kind: ToastKind; opts: ToastOptions };

const doc = { path: 'redaccion/planes/login.md', title: 'Login', kind: 'plan', status: 'borrador' } as DocumentView;

describe('undo of a discard', () => {
  let shown: Shown[];
  let restored: string[];
  let store: Store;
  let api: OfficeApi;
  let restoreOk = true;

  beforeEach(() => {
    shown = [];
    restored = [];
    restoreOk = true;
    store = { toast: (text: string, kind: ToastKind = 'info', opts: ToastOptions = {}) => void shown.push({ text, kind, opts }) } as unknown as Store;
    api = {
      discardDocument: async () => ({ ok: true, data: { ok: true } }),
      restoreDocument: async (path: string) => {
        restored.push(path);
        return restoreOk ? { ok: true, data: { ok: true } } : { ok: false, status: 409, message: 'no descartado' };
      },
    } as unknown as OfficeApi;
  });

  const control = () => ({ disabled: false }) as HTMLButtonElement;

  test('the toast of a discard offers Deshacer for 10 seconds and the button restores the plan', async () => {
    expect(await discardDocument(api, store, doc, control())).toBe(true);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.opts.ttlMs).toBe(UNDO_MS);
    expect(UNDO_MS).toBe(10_000);
    expect(shown[0]?.opts.action?.label).toBe(t('deliverables.undo'));
    expect(restored).toEqual([]);
    shown[0]?.opts.action?.run();
    await Bun.sleep(0);
    expect(restored).toEqual([doc.path]);
    expect(shown[1]).toMatchObject({ text: t('deliverables.restored', { title: 'Login' }), kind: 'ok' });
  });

  test('a restore that the hub refuses shows its message as an error', async () => {
    await discardDocument(api, store, doc, control());
    restoreOk = false;
    shown[0]?.opts.action?.run();
    await Bun.sleep(0);
    expect(shown[1]).toMatchObject({ text: 'no descartado', kind: 'error' });
  });

  test('a failed discard offers no undo', async () => {
    api = { discardDocument: async () => ({ ok: false, status: 409, message: 'cerrado' }) } as unknown as OfficeApi;
    expect(await discardDocument(api, store, doc, control())).toBe(false);
    expect(shown).toEqual([{ text: 'cerrado', kind: 'error', opts: {} }]);
  });
});
