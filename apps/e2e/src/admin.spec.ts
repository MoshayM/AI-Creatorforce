import { test, expect, type Page } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

const BASE = 'http://localhost:4007/api/v1';

const MOCK_METRICS = {
  mrr: 250_000,
  arr: 3_000_000,
  revenueByMonth: [100_000, 120_000, 150_000, 180_000, 210_000, 250_000],
  arpu: 1_900,
  ltv: 45_000,
  churn: 0.042,
  aiCostUsd: 812.5,
  cacheSavingsUsd: 137.25,
  topModels: [
    { model: 'claude-sonnet-4-6', costUsd: 512.4, tokensIn: 9_400_000, tokensOut: 2_100_000 },
    { model: 'claude-haiku-4-5', costUsd: 300.1, tokensIn: 22_000_000, tokensOut: 4_900_000 },
  ],
};

const MOCK_FORECASTS = [
  { id: 'fc-1', metric: 'revenue', horizonDays: 30, predictedValue: 280_000, confidenceLow: 240_000, confidenceHigh: 320_000, method: 'window_average', inputPointsCount: 6, generatedAt: '2026-07-11T00:00:00.000Z' },
  { id: 'fc-2', metric: 'cost', horizonDays: 30, predictedValue: 950.0, confidenceLow: 800.0, confidenceHigh: 1_100.0, method: 'window_average', inputPointsCount: 6, generatedAt: '2026-07-11T00:00:00.000Z' },
];

const MOCK_PROVIDERS = [
  {
    id: 'prov-1', name: 'anthropic', status: 'ACTIVE', priority: 1,
    qualityScore: 0.97, failureRate: 0.004, avgHealthScore: 98,
    costRates: [{ unit: 'per_1m_tokens', inputCost: 3, outputCost: 15 }],
    healthEvents: [],
  },
  {
    id: 'prov-2', name: 'elevenlabs', status: 'DEGRADED', priority: 2,
    qualityScore: 0.91, failureRate: 0.062, avgHealthScore: 74,
    costRates: [],
    healthEvents: [],
  },
];

async function mockAdminRoutes(page: Page, opts?: { forbidden?: boolean }) {
  await page.route(`${BASE}/admin/analytics/enterprise`, (route) =>
    opts?.forbidden
      ? route.fulfill({ status: 403, json: { message: 'Forbidden' } })
      : route.fulfill({ json: MOCK_METRICS }),
  );
  await page.route(/\/api\/v1\/admin\/forecasts(\?.*)?$/, (route) =>
    opts?.forbidden
      ? route.fulfill({ status: 403, json: { message: 'Forbidden' } })
      : route.fulfill({ json: MOCK_FORECASTS }),
  );
  await page.route(`${BASE}/admin/providers`, (route) => route.fulfill({ json: MOCK_PROVIDERS }));
}

test.describe('Admin enterprise dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
  });

  test('renders KPI cards, forecasts and provider health', async ({ page }) => {
    await mockAdminRoutes(page);
    await page.goto('/admin');

    // KPI cards (minor units → dollars)
    await expect(page.getByText('Enterprise Dashboard')).toBeVisible();
    // "$2,500" appears twice (KPI + last revenue bar label) — first() avoids strict mode
    await expect(page.getByText('$2,500').first()).toBeVisible(); // MRR 250_000 cents
    await expect(page.getByText('4.2%')).toBeVisible(); // churn

    // Forecast cards with per-metric units
    await expect(page.getByText('Revenue (30d)')).toBeVisible();
    await expect(page.getByText('$2,800')).toBeVisible(); // revenue forecast, minor units
    await expect(page.getByText('$950.00')).toBeVisible(); // cost forecast, USD float

    // Provider table
    await expect(page.getByText('anthropic')).toBeVisible();
    await expect(page.getByText('DEGRADED')).toBeVisible();
    await expect(page.getByText('$3 · $15')).toBeVisible();
  });

  test('generate button POSTs /admin/forecasts/generate and reloads', async ({ page }) => {
    await mockAdminRoutes(page);
    let generated = false;
    await page.route(`${BASE}/admin/forecasts/generate`, (route) => {
      generated = true;
      return route.fulfill({ json: { ok: true, message: 'queued' } });
    });
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Generate now' }).click();
    await expect.poll(() => generated).toBe(true);
  });

  test('non-admin gets the access-required state, not an error dump', async ({ page }) => {
    await mockAdminRoutes(page, { forbidden: true });
    await page.goto('/admin');
    await expect(page.getByText('Admin access required')).toBeVisible();
    await expect(page.getByText('Enterprise Dashboard')).toHaveCount(0);
  });
});
