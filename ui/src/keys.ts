import { t, type MessageKey } from './i18n';
import { TABS } from './topbar';

export type KeyAction =
  | { type: 'palette' }
  | { type: 'tab'; index: number }
  | { type: 'need'; step: 1 | -1 }
  | { type: 'history' }
  | { type: 'orders' }
  | { type: 'help' }
  | { type: 'escape' };

export type Binding = { combo: string; action: KeyAction; label: () => string };

const tabBindings: Binding[] = TABS.map(({ labelKey }, index) => ({
  combo: String(index + 1),
  action: { type: 'tab', index },
  label: () => t('keys.tab', { tab: t(labelKey) }),
}));

const fixed = (combo: string, action: KeyAction, key: MessageKey): Binding => ({ combo, action, label: () => t(key) });

// The one table the listener, the help overlay and the palette read.
export const BINDINGS: readonly Binding[] = [
  fixed('mod+k', { type: 'palette' }, 'keys.palette'),
  ...tabBindings,
  fixed('n', { type: 'need', step: 1 }, 'keys.needNext'),
  fixed('shift+n', { type: 'need', step: -1 }, 'keys.needPrev'),
  fixed('/', { type: 'history' }, 'keys.history'),
  fixed('o', { type: 'orders' }, 'keys.orders'),
  fixed('?', { type: 'help' }, 'keys.help'),
  fixed('esc', { type: 'escape' }, 'keys.escape'),
];

export type KeyLike = { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean };

const TYPING_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!node) return false;
  if (node.isContentEditable === true) return true;
  return typeof node.tagName === 'string' && TYPING_TAGS.has(node.tagName.toUpperCase());
}

// The combo of an event as written in BINDINGS, or null when it carries a modifier no binding uses.
export function comboOf(event: KeyLike): string | null {
  if (event.altKey) return null;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key === 'Escape' ? 'esc' : event.key;
  const letter = key.length === 1 && key.toLowerCase() !== key.toUpperCase();
  const name = letter ? key.toLowerCase() : key;
  if (mod) return `mod+${name}`;
  return letter && event.shiftKey ? `shift+${name}` : name;
}

export function resolveKey(event: KeyLike): KeyAction | null {
  const combo = comboOf(event);
  return BINDINGS.find((binding) => binding.combo === combo)?.action ?? null;
}

export type KeyContext = { typing: boolean; modalOpen: boolean };

// Cmd/Ctrl+K and Esc always work; the help toggles over a dialog; the rest wait while the user types or a dialog is up.
export function shouldRun(action: KeyAction, context: KeyContext): boolean {
  if (action.type === 'palette' || action.type === 'escape') return true;
  if (context.typing) return false;
  if (action.type === 'help') return true;
  return !context.modalOpen;
}

// Closes the first layer that is open, in priority order, and says whether there was one.
export function dismissTopLayer(layers: readonly (() => boolean)[]): boolean {
  for (const close of layers) if (close()) return true;
  return false;
}

export function displayCombo(combo: string, mac: boolean): string {
  return combo
    .split('+')
    .map((part) => {
      switch (part) {
        case 'mod':
          return mac ? '⌘' : 'Ctrl';
        case 'shift':
          return mac ? '⇧' : 'Shift';
        case 'esc':
          return 'Esc';
        default:
          return part.length === 1 ? part.toUpperCase() : part;
      }
    })
    .join(mac ? '' : '+');
}

export type KeyHandlers = {
  run(action: KeyAction): void;
  layers: readonly (() => boolean)[];
  modalOpen(): boolean;
};

// The only keydown listener of the shortcuts: capture phase on the document, so the layers it closes
// never reach the Esc handler of the viewer or the dialogs underneath.
export function mountKeys(handlers: KeyHandlers): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return;
    const action = resolveKey(event);
    if (!action) return;
    if (action.type === 'escape') {
      if (!dismissTopLayer(handlers.layers)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!shouldRun(action, { typing: isTypingTarget(event.target), modalOpen: handlers.modalOpen() })) return;
    event.preventDefault();
    handlers.run(action);
  };
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}
