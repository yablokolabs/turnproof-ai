import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4180);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm run e2e:serve',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PORT: String(PORT) },
  },
});
