// Globs of the delivery cycle (skipGlobs, checkFiles): * stays inside a folder, ** crosses folders, ? is one
// character. A pattern without a slash matches the name of the file wherever it is.
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i] ?? '';
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i += 1;
        if (pattern[i + 1] === '/') {
          i += 1;
          out += '(?:.*/)?';
        } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function globMatches(pattern: string, path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  const target = pattern.includes('/') ? normalized : (normalized.split('/').pop() ?? normalized);
  return globToRegExp(pattern).test(target);
}

export function matchesAny(patterns: readonly string[], path: string): boolean {
  return patterns.some((pattern) => globMatches(pattern, path));
}
