import { describe, expect, test } from 'bun:test';
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLog } from '../src/log';
import { tempDir } from './helpers';

describe('createLog', () => {
  test('an existing hub.log is brought to mode 600 and keeps its lines', () => {
    const t = tempDir();
    try {
      const file = join(t.dir, 'hub.log');
      writeFileSync(file, 'antes\n');
      chmodSync(file, 0o644);
      const log = createLog(t.dir);
      expect(statSync(file).mode & 0o777).toBe(0o600);
      log('después');
      expect(readFileSync(file, 'utf8')).toContain('antes\n');
      expect(readFileSync(file, 'utf8')).toContain('después');
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      t.cleanup();
    }
  });

  test('without a hub.log nothing is created until the first line', () => {
    const t = tempDir();
    try {
      const log = createLog(t.dir);
      expect(() => statSync(join(t.dir, 'hub.log'))).toThrow();
      log('primera');
      expect(statSync(join(t.dir, 'hub.log')).mode & 0o777).toBe(0o600);
    } finally {
      t.cleanup();
    }
  });
});
