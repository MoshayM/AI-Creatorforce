import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  // One retry (was 2 on CI): a broadly-failing suite at 2 retries × 60s spent
  // 40+ min and the job was killed with no report.
  retries: 1,
  workers: 1,
  // Hard cap on the whole run so a single hanging test aborts the run cleanly
  // (with a report artifact) instead of GitHub cancelling the job at its cap.
  globalTimeout: process.env['CI'] ? 25 * 60_000 : undefined,
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
    // CI: production server against a prebuilt .next (the CI job builds it) —
    // `next dev` cold-compiles every route on a 2-core runner and blew the
    // 40-minute job cap. Local runs keep the dev server.
    command: process.env['CI']
      ? 'pnpm --filter @cf/web exec next start -p 3007'
      : 'pnpm --filter @cf/web dev',
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
