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

// The catalog is a dynamic import (see src/data/catalog.ts), which the browser only discovers once the main
// script runs. Preloading it from index.html starts the fetch together with the main script.
const preloadCatalog: Plugin = {
  name: 'preload-catalog',
  transformIndexHtml: {
    order: 'post',
    handler(_html, ctx) {
      const chunk = Object.values(ctx.bundle ?? {}).find(
        (c) =>
          c.type === 'chunk' && c.facadeModuleId?.replaceAll('\\', '/').endsWith('/src/data/catalogData.ts'),
      );
      if (!chunk) {
        console.warn('preload-catalog: no catalog chunk found, so index.html does not preload it');
        return [];
      }
      return [
        {
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: '', href: `./${chunk.fileName}` },
          injectTo: 'head',
        },
      ];
    },
  },
};

export default defineConfig({
  base: './',
  plugins: [svelte(), preloadCatalog],
  // ES-module workers load the catalog as a chunk of their own; the default IIFE format would inline it into the
  // worker script. (The worker build emits its own copy of that chunk, apart from the main build's.)
  worker: { format: 'es' },
  build: {
    // three.js alone is ~550 kB minified.
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      input: { main: page('./index.html'), ...harnesses },
    },
  },
});
