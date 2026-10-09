import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

// Standalone test pages for e2e/renderer.spec.ts and e2e/detailed.spec.ts. Built only for e2e runs
// (Playwright sets E2E_HARNESS=1) so they are never deployed.
const harnesses: Record<string, string> = process.env.E2E_HARNESS
  ? {
      'renderer-harness': page('./renderer-harness.html'),
      detailedHarness: page('./detailed-harness.html'),
    }
  : {};

function catalogOfflineNotes(): Plugin {
  return {
    name: 'catalog-offline-notes',
    apply: 'build',
    enforce: 'pre',
    // Catalog transcription notes are retained in the source files for review. No runtime
    // consumer reads them; exclude this prose from both the client and worker payloads.
    transform(code, id) {
      const path = id.split('?')[0].replaceAll('\\', '/');
      if (!path.includes('/src/data/multiblocks/') || !path.endsWith('.json')) return;
      const { notes: _notes, ...definition } = JSON.parse(code);
      return JSON.stringify(definition);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [catalogOfflineNotes(), svelte()],
  worker: { plugins: () => [catalogOfflineNotes()] },
  build: {
    // three.js alone is ~550 kB minified.
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      input: { main: page('./index.html'), ...harnesses },
    },
  },
});
