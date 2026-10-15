import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

function officeKey(): Plugin {
  return {
    name: 'office-key',
    apply: 'serve',
    transformIndexHtml(html) {
      const home = process.env.AGENT_OFFICE_HOME ?? join(homedir(), '.config/agent-office');
      let key = '';
      try {
        key = readFileSync(join(home, 'key'), 'utf8').trim();
      } catch {
        return html;
      }
      if (!key) return html;
      const literal = JSON.stringify(key).replace(/</g, '\\u003c');
      return html.replace('</head>', `<script>window.__OFFICE_KEY__=${literal}</script></head>`);
    },
  };
}

export default defineConfig({
  root,
  plugins: [officeKey()],
  build: {
    outDir: '../hub/public',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4747', changeOrigin: true },
      '/live': { target: 'ws://127.0.0.1:4747', ws: true, changeOrigin: true },
    },
  },
});
