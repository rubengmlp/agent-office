import { fuzzyFilter } from '../fuzzy';
import { currentLang, t } from '../i18n';
import { agentName, documentStatusLabel, floorKindLabel, floorLabel, roleLabel } from '../labels';
import type { AgentView, DocumentView, FloorView } from '../types';

export type PaletteGroup = 'action' | 'tab' | 'floor' | 'agent' | 'plan';

export const PALETTE_GROUPS: readonly PaletteGroup[] = ['action', 'tab', 'floor', 'agent', 'plan'];

export type PaletteTarget =
  | { type: 'agent'; key: string }
  | { type: 'floor'; slug: string }
  | { type: 'tab'; index: number }
  | { type: 'plan'; path: string }
  | { type: 'reply' }
  | { type: 'status'; sessionId: string }
  | { type: 'relaunch'; sessionId: string }
  | { type: 'newOrder' }
  | { type: 'lang' }
  | { type: 'history' }
  | { type: 'mute' }
  | { type: 'muteSound' };

export type PaletteEntry = { id: string; group: PaletteGroup; label: string; hint: string; target: PaletteTarget; write: boolean };

export type PaletteContext = {
  agents: readonly AgentView[];
  floors: readonly FloorView[];
  documents: readonly DocumentView[];
  tabs: readonly string[];
  // Whether there is a hub to write to: false in a replay, where the actions that change something are left out.
  live: boolean;
  reply: { name: string } | null;
  status: { sessionId: string; name: string } | null;
  relaunch: { sessionId: string; name: string } | null;
  newOrder: boolean;
  mute: boolean;
  muteSound: boolean;
};

export const EMPTY_LIMIT = 30;
export const RESULT_LIMIT = 50;

function actions(context: PaletteContext): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  const add = (id: string, label: string, hint: string, target: PaletteTarget, write: boolean): void => {
    out.push({ id: `action:${id}`, group: 'action', label, hint, target, write });
  };
  if (context.reply) add('reply', t('palette.action.reply', { name: context.reply.name }), t('palette.hint.question'), { type: 'reply' }, true);
  if (context.status) add('status', t('palette.action.status', { name: context.status.name }), t('palette.hint.session'), { type: 'status', sessionId: context.status.sessionId }, true);
  if (context.relaunch) add('relaunch', t('palette.action.relaunch', { name: context.relaunch.name }), t('palette.hint.session'), { type: 'relaunch', sessionId: context.relaunch.sessionId }, true);
  if (context.newOrder) add('newOrder', t('palette.action.newOrder'), t('palette.hint.board'), { type: 'newOrder' }, true);
  add('lang', t(currentLang() === 'es' ? 'palette.action.langEn' : 'palette.action.langEs'), t('palette.hint.lang'), { type: 'lang' }, false);
  add('history', t('palette.action.history'), '/', { type: 'history' }, false);
  if (context.mute) add('mute', t('palette.action.mute'), t('palette.hint.notifications'), { type: 'mute' }, false);
  if (context.muteSound) add('muteSound', t('palette.action.muteSound'), t('palette.hint.sound'), { type: 'muteSound' }, false);
  return out;
}

export function buildEntries(context: PaletteContext): PaletteEntry[] {
  const entries = actions(context);
  context.tabs.forEach((label, index) => {
    entries.push({ id: `tab:${index}`, group: 'tab', label, hint: String(index + 1), target: { type: 'tab', index }, write: false });
  });
  for (const floor of context.floors) {
    entries.push({ id: `floor:${floor.slug}`, group: 'floor', label: floorLabel(floor), hint: floorKindLabel(floor.kind), target: { type: 'floor', slug: floor.slug }, write: false });
  }
  const floors = new Map(context.floors.map((floor) => [floor.slug, floor]));
  for (const agent of context.agents) {
    const floor = floors.get(agent.floor);
    entries.push({
      id: `agent:${agent.key}`,
      group: 'agent',
      label: agentName(agent),
      hint: `${roleLabel(agent.roleKind)} · ${floor ? floorLabel(floor) : agent.floor}`,
      target: { type: 'agent', key: agent.key },
      write: false,
    });
  }
  for (const doc of context.documents) {
    if (doc.kind !== 'plan') continue;
    entries.push({ id: `plan:${doc.path}`, group: 'plan', label: doc.title, hint: documentStatusLabel(doc.status), target: { type: 'plan', path: doc.path }, write: false });
  }
  return context.live ? entries : entries.filter((entry) => !entry.write);
}

export type PaletteResult = { entry: PaletteEntry; indices: number[] };

// With no query, the actions and the tabs first; with one, the best matches over name and hint, whose
// highlighted letters are the ones of the name.
export function searchEntries(entries: readonly PaletteEntry[], query: string): PaletteResult[] {
  if (query.trim() === '') return entries.slice(0, EMPTY_LIMIT).map((entry) => ({ entry, indices: [] }));
  return fuzzyFilter(entries, query, (entry) => `${entry.label} ${entry.hint}`)
    .slice(0, RESULT_LIMIT)
    .map(({ item, match }) => ({ entry: item, indices: match.indices.filter((index) => index < item.label.length) }));
}
