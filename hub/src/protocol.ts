import { homedir } from 'node:os';
import { isAbsolute, posix, relative, resolve, sep } from 'node:path';
import { isInside, realPath } from './floors';
import type { DocumentKind } from './types';

export type ProtocolKind = 'review' | 'improve' | 'approved' | 'no-agreement' | 'done' | 'lesson' | 'blocked' | 'plan' | 'question' | 'split';

export type ProtocolMessage = {
  kind: ProtocolKind;
  target: string | null;
  round: number | null;
  score: number | null;
  rest: string;
};

export type DocRef = { path: string; kind: DocumentKind; slug: string };

const PREFIXES: readonly [ProtocolKind, RegExp][] = [
  ['review', /^\s*REVISAR\s*:\s*/i],
  ['improve', /^\s*MEJORAR\s*:\s*/i],
  ['approved', /^\s*APROBADO\s*:\s*/i],
  ['no-agreement', /^\s*SIN\s+ACUERDO\s*:\s*/i],
  ['done', /^\s*HECHO\s*:\s*/i],
  ['lesson', /^\s*LECCI[OÓ]N\s*:\s*/i],
  ['blocked', /^\s*BLOQUEADO\s*:\s*/i],
  ['plan', /^\s*PLAN\s*:\s*/],
  ['question', /^\s*PREGUNTA\s*:\s*/],
  ['split', /^\s*PARTIR\s*:\s*/i],
];

const WITH_TARGET: ReadonlySet<ProtocolKind> = new Set(['review', 'improve', 'approved', 'no-agreement', 'done', 'plan', 'split']);

function firstToken(line: string): string | null {
  const token = line.trim().split(/\s+/)[0] ?? '';
  const cleaned = token.replace(/^[`'"«“(\[]+/, '').replace(/[`'"»”)\],.;:]+$/, '');
  return cleaned || null;
}

export function parseProtocol(body: string): ProtocolMessage | null {
  for (const [kind, prefix] of PREFIXES) {
    const match = prefix.exec(body);
    if (!match) continue;
    const rest = body.slice(match[0].length);
    const firstLine = rest.split('\n')[0] ?? '';
    const round = /\bronda\s+(\d{1,3})\b/i.exec(firstLine);
    const score = /\bnota\s+(\d{1,2}(?:[.,]\d{1,2})?)\s*\/\s*10\b/i.exec(firstLine);
    return {
      kind,
      target: WITH_TARGET.has(kind) ? firstToken(firstLine) : null,
      round: round ? Number(round[1]) : null,
      score: score ? Number(score[1].replace(',', '.')) : null,
      rest: rest.trim(),
    };
  }
  return null;
}

export function docRef(raw: string | null, docsRoot: string | null, cwd: string | null): DocRef | null {
  if (!raw || !docsRoot) return null;
  const expanded = raw.startsWith('~/') ? resolve(homedir(), raw.slice(2)) : raw;
  let rel: string;
  if (isAbsolute(expanded)) {
    const abs = realPath(expanded);
    if (!isInside(abs, docsRoot)) return null;
    rel = relative(docsRoot, abs);
  } else {
    const plain = posix.normalize(expanded.replaceAll('\\', '/'));
    if (/^(redaccion|taller)\//.test(plain)) rel = plain;
    else if (cwd) {
      const abs = realPath(resolve(cwd, expanded));
      if (!isInside(abs, docsRoot)) return null;
      rel = relative(docsRoot, abs);
    } else return null;
  }
  const path = rel.split(sep).join('/');
  if (path.split('/').includes('..')) return null;
  const plan = /^redaccion\/planes\/([a-z0-9][a-z0-9_-]{0,79})\.md$/.exec(path);
  if (plan?.[1]) return { path, kind: 'plan', slug: plan[1] };
  const skill = /^taller\/skills\/([a-z0-9][a-z0-9_-]{0,79})(?:\/.*)?$/.exec(path);
  if (skill?.[1]) return { path: `taller/skills/${skill[1]}`, kind: 'skill', slug: skill[1] };
  return null;
}

export function normalizeLesson(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.;:,!¡?¿]+$/g, '')
    .trim();
}
