import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // The catalog loads asynchronously; every test file gets it loaded before it is imported.
    setupFiles: ['src/data/catalogSetup.ts'],
    // Generous: the suite runs files in parallel, and heavy model tests can take several times their
    // solo time on a loaded machine. A real hang still fails.
    testTimeout: 30_000,
  },
});
