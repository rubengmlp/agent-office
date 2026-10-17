export type FuzzyMatch = { score: number; indices: number[] };

const WORD_START = /[\s\-_/·:.]/;

function foldChar(char: string): string {
  const base = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return base === '' ? char.toLowerCase() : base[0];
}

// Lowercase and accent-free text that keeps the length of the original, so match indices stay valid.
export function fold(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) out += foldChar(text[index]);
  return out;
}

// Subsequence match: every letter of the query appears in order. The score favours a prefix, the start of
// words and runs of consecutive letters, and then shorter texts; null when the query does not fit.
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const needle = fold(query).replace(/\s+/g, '');
  if (needle === '') return { score: 0, indices: [] };
  const hay = fold(text);
  const indices: number[] = [];
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const letter of needle) {
    const at = hay.indexOf(letter, from);
    if (at < 0) return null;
    indices.push(at);
    score += 1;
    if (at === previous + 1) score += 4;
    if (at === 0) score += 6;
    else if (WORD_START.test(hay[at - 1])) score += 3;
    previous = at;
    from = at + 1;
  }
  if (hay.startsWith(needle)) score += 8;
  else if (hay.includes(needle)) score += 4;
  return { score: score - hay.length * 0.01, indices };
}

export type Ranked<T> = { item: T; match: FuzzyMatch };

// The items that fit the query, best first; the original order breaks ties.
export function fuzzyFilter<T>(items: readonly T[], query: string, textOf: (item: T) => string): Ranked<T>[] {
  const ranked: (Ranked<T> & { order: number })[] = [];
  items.forEach((item, order) => {
    const match = fuzzyMatch(query, textOf(item));
    if (match) ranked.push({ item, match, order });
  });
  ranked.sort((a, b) => b.match.score - a.match.score || a.order - b.order);
  return ranked.map(({ item, match }) => ({ item, match }));
}
