import { defineConfig, devices } from '@playwright/test';

// Deterministic port per checkout so parallel worktrees don't collide.
const port = 4200 + ([...process.cwd()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 700);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  // Software WebGL and routing workers share the host CPU. Keep frame-budget checks independent
  // of large imports in other browser contexts without relaxing their acceptance thresholds.
  workers: 2,
  use: { baseURL: `http://127.0.0.1:${port}/`, ...devices['Desktop Chrome'] },
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    env: { E2E_HARNESS: '1' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
