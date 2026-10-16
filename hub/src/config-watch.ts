import { watch, type FSWatcher } from 'node:fs';

export type WatchTarget = { dir: string; match: (filename: string) => boolean };

export function watchTargets(targets: WatchTarget[], onChange: () => void, debounceMs = 200): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const watchers: FSWatcher[] = [];
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, debounceMs);
  };
  for (const target of targets) {
    try {
      const watcher = watch(target.dir, (_event, filename) => {
        if (filename && target.match(String(filename))) fire();
      });
      watcher.on('error', () => watcher.close());
      watchers.push(watcher);
    } catch {}
  }
  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}

export function configTargets(officeHome: string, profilesDir: string): WatchTarget[] {
  return [
    { dir: officeHome, match: (name) => name === 'config.json' || name.startsWith('config.json.') },
    { dir: profilesDir, match: (name) => name.endsWith('.json') },
  ];
}
