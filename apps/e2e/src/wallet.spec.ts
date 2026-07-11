import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

const BASE = 'http://localhost:4007/api/v1';

const MOCK_BALANCE = {
  balanceCredits: 1_240,
  buckets: {
    purchasedCredits: 1_000,
    trialCredits: 200,
    bonusCredits: 40,
    referralCredits: 0,
    promotionalCredits: 0,
  },
  lifetimePurchased: 2_000,
  lifetimeUsed: 760,
};

const MOCK_BUDGET_NONE = {
  status: 'NONE',
  monthlyLimit: 0,
  spent: 0,
  remaining: 0,
  willExceed: false,
  blocked: false,
  alertThreshold: 80,
  hardCap: false,
};

const MOCK_BUDGET_OK = {
  status: 'OK',
  monthlyLimit: 5_000,
  spent: 1_200,
  remaining: 3_800,
  willExceed: false,
  blocked: false,
  alertThreshold: 80,
  hardCap: false,
};

const MOCK_USAGE_SUMMARY = {
  totalSpent: 760,
  byAction: [
    { action: 'SCRIPT_GENERATION', credits: 500 },
    { action: 'TREND_ANALYSIS', credits: 260 },
  ],
};

const MOCK_TRANSACTIONS = [
  {
    id: 'tx-1',
    entryType: 'TRIAL',
    amount: 200,
    balanceAfter: 200,
    createdAt: '2026-06-01T00:00:00.000Z',
    metadata: {},
  },
  {
    id: 'tx-2',
    entryType: 'PURCHASE',
    amount: 1_000,
    balanceAfter: 1_200,
    createdAt: '2026-06-10T00:00:00.000Z',
    metadata: {},
  },
  {
    id: 'tx-3',
    entryType: 'USAGE_DEBIT',
    amount: -760,
    balanceAfter: 440,
    createdAt: '2026-06-15T00:00:00.000Z',
    metadata: {},
  },
];

async function setupWalletMocks(
  page: import('@playwright/test').Page,
  opts: { budgetStatus?: 'NONE' | 'OK' } = {},
) {
  const budget = opts.budgetStatus === 'OK' ? MOCK_BUDGET_OK : MOCK_BUDGET_NONE;
  let currentBudget = { ...budget };

  await page.route(`${BASE}/wallet/balance`, async (route) => {
    await route.fulfill({ json: MOCK_BALANCE });
  });

  await page.route(`${BASE}/wallet/budget`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: currentBudget });
    } else if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as {
        monthlyLimit?: number;
        alertThreshold?: number;
        hardCap?: boolean;
      } | null;
      currentBudget = {
        ...MOCK_BUDGET_OK,
        monthlyLimit: body?.monthlyLimit ?? MOCK_BUDGET_OK.monthlyLimit,
        alertThreshold: body?.alertThreshold ?? MOCK_BUDGET_OK.alertThreshold,
        hardCap: body?.hardCap ?? false,
      };
      await route.fulfill({ json: currentBudget });
    }
  });

  await page.route(`${BASE}/wallet/usage-summary*`, async (route) => {
    await route.fulfill({ json: MOCK_USAGE_SUMMARY });
  });

  await page.route(`${BASE}/wallet/transactions*`, async (route) => {
    await route.fulfill({ json: MOCK_TRANSACTIONS });
  });
}

test.describe('Wallet', () => {
  test.beforeEach(async ({ page }) => {
    await setupWalletMocks(page);
    await setupApiMocks(page);
    await setAuthToken(page);
    await page.goto('/wallet');
    await page.waitForLoadState('domcontentloaded');
  });

  test('page heading renders', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Wallet', level: 1 })).toBeVisible({ timeout: 8_000 });
  });

  test('renders total credit balance', async ({ page }) => {
    // Balance shown as formatted number "1,240"
    await expect(page.getByText('1,240')).toBeVisible({ timeout: 8_000 });
  });

  test('renders bucket breakdown chips (trial + purchased)', async ({ page }) => {
    // Purchased bucket label
    await expect(page.getByText(/1,000 Purchased/)).toBeVisible({ timeout: 8_000 });
    // Trial bucket label
    await expect(page.getByText(/200 Trial/)).toBeVisible();
  });

  test('NONE budget shows "No budget set" copy', async ({ page }) => {
    await expect(
      page.getByText(/No budget set/i),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('editing budget PUTs /wallet/budget with correct body', async ({ page }) => {
    // Open the edit form
    const editBtn = page.getByRole('button', { name: /edit/i }).first();
    await editBtn.click();

    // Fill in the monthly limit field
    const limitInput = page.getByPlaceholder('e.g. 10000');
    await limitInput.fill('8000');

    // Capture the PUT request body
    const putReq = page.waitForRequest(
      (r) => r.method() === 'PUT' && r.url().includes('/wallet/budget'),
    );
    await page.getByRole('button', { name: /save budget/i }).click();
    const req = await putReq;
    const body = req.postDataJSON() as { monthlyLimit?: number };
    expect(body.monthlyLimit).toBe(8000);
  });

  test('after saving budget the progress bar renders', async ({ page }) => {
    // Switch to OK budget state via the edit flow
    await page.route(`${BASE}/wallet/budget`, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: MOCK_BUDGET_OK });
      } else {
        await route.fulfill({ json: MOCK_BUDGET_OK });
      }
    });

    const editBtn = page.getByRole('button', { name: /edit/i }).first();
    await editBtn.click();
    const limitInput = page.getByPlaceholder('e.g. 10000');
    await limitInput.fill('5000');
    await page.getByRole('button', { name: /save budget/i }).click();

    // After refetch with OK status the progress bar must appear (24% used)
    await expect(page.getByText(/spent/)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/% used/)).toBeVisible({ timeout: 8_000 });
  });

  test('transaction table shows entryType badges', async ({ page }) => {
    await expect(page.getByText('TRIAL')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('PURCHASE')).toBeVisible();
    await expect(page.getByText('USAGE DEBIT')).toBeVisible();
  });

  test('transaction table shows positive and negative amounts', async ({ page }) => {
    // Positive amounts shown with + prefix
    await expect(page.getByText('+1,000')).toBeVisible({ timeout: 8_000 });
    // Negative amount — rendered without +
    await expect(page.getByText('-760')).toBeVisible();
  });
});
