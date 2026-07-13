import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 1,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    // Visual snapshots (docs4/22): small tolerance absorbs sub-pixel AA noise;
    // baselines are per-platform and generated on the dev machine.
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' },
  },

  use: {
    baseURL: 'http://localhost:3007',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Cross-browser projects (docs4/22) — active on CI (matrix-sharded per
    // browser) or locally via CROSS_BROWSER=1 so the default local run stays
    // a single ~20-min chromium pass. Visual baselines are chromium-only.
    ...(process.env['CI'] || process.env['CROSS_BROWSER']
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: /visual\.spec\.ts/ },
          { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: /visual\.spec\.ts/ },
        ]
      : []),
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
