import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 1,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:3007',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'pnpm --filter @cf/web dev',
    url: 'http://localhost:3007',
    reuseExistingServer: true,
    timeout: 120_000,
    cwd: '../../',
    env: {
      NEXT_PUBLIC_USE_MOCK: 'false',
      NEXT_PUBLIC_API_URL: 'http://localhost:4007/api/v1',
    },
  },
});
