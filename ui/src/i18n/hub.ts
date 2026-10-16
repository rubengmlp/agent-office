import type { HubText, HubTextKey, HubTextParams } from '../types';
import type { es, MessageKey } from './es';
import { t } from './index';

// typecheck fails here if the hub emits a key es.ts does not have.
type HubKeysCovered = HubTextKey extends MessageKey ? true : never;
export const hubKeysCovered: HubKeysCovered = true;

// The {markers} of each hub.* text in es.ts must be exactly the parameters the hub sends for that key;
// otherwise the error names the key. en.ts is held to the same markers by ui/test/i18n.test.ts.
type Markers<S extends string> = S extends `${string}{${infer M}}${infer R}` ? M | Markers<R> : never;
type EsText<K> = K extends keyof typeof es ? (typeof es)[K] : never;
type ParamNames<K extends HubTextKey> = HubTextParams[K] extends undefined ? never : keyof HubTextParams[K] & string;
type BadMarkers = {
  [K in HubTextKey]: [Markers<EsText<K>>] extends [ParamNames<K>] ? ([ParamNames<K>] extends [Markers<EsText<K>>] ? never : K) : K;
}[HubTextKey];
export const markersMatch: [BadMarkers] extends [never] ? true : BadMarkers = true;

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

// Pure: raw text as is, null as '', a key translated after its nested parameters. It never throws: a key this
// panel does not know (an older or newer hub, an old recording) comes out as the key itself.
export function renderHubText(tr: Translate, value: HubText | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || typeof value.key !== 'string') return '';
  const params: Record<string, string | number> = {};
  const raw: unknown = value.params;
  if (typeof raw === 'object' && raw !== null) {
    for (const [name, param] of Object.entries(raw)) {
      if (typeof param === 'object' && param !== null) params[name] = renderHubText(tr, param as HubText);
      else if (typeof param === 'string' || typeof param === 'number') params[name] = param;
    }
  }
  return tr(value.key as MessageKey, params);
}

function isHubText(value: unknown): value is HubText {
  if (typeof value === 'string') return true;
  return typeof value === 'object' && value !== null && typeof (value as { key?: unknown }).key === 'string';
}

// Pure: the error of an API body, which may be raw text, a hub text or a list of them; anything else is null.
export function errorText(tr: Translate, parsed: unknown): string | null {
  if (Array.isArray(parsed)) return parsed.every(isHubText) ? parsed.map((item) => renderHubText(tr, item)).join(' ') : null;
  return isHubText(parsed) ? renderHubText(tr, parsed) : null;
}

export function hubText(value: HubText | null | undefined): string {
  return renderHubText(t, value);
}

export function hubTexts(values: readonly HubText[]): string {
  return values.map(hubText).join(' ');
}
