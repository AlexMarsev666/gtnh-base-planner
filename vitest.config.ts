import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // Native fixture generation and routing both occupy a core and large geometry caches. Run files
    // serially so the existing routing deadlines measure the model, not a concurrent fixture import.
    maxWorkers: 1,
  },
});
