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

// Expiry timeline (Phase 6 §11): one lot expiring soon, one never-expiring.
const MOCK_LOTS = [
  {
    id: 'lot-1',
    bucket: 'promotionalCredits',
    amount: 100,
    remaining: 40,
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString(),
    createdAt: '2026-06-20T00:00:00.000Z',
  },
  {
    id: 'lot-2',
    bucket: 'purchasedCredits',
    amount: 1_000,
    remaining: 1_000,
    expiresAt: null,
    createdAt: '2026-06-10T00:00:00.000Z',
  },
];

// Marketplace (Phase 6 §12)
const MOCK_PACKS = [
  { id: 'pack-1', name: 'Starter', credits: 1_000, priceMinor: 999, currency: 'usd', region: null, sortOrder: 0 },
  { id: 'pack-2', name: 'Creator', credits: 5_000, priceMinor: 3_999, currency: 'usd', region: null, sortOrder: 1 },
];

// Error envelope (docs4/32) for a provider outage — the UI must translate
// this into actionable copy (risk R-06).
const PROVIDER_OUTAGE_ENVELOPE = {
  success: false,
  statusCode: 503,
  code: 'PROVIDER',
  message: 'Payment provider unavailable',
  correlationId: 'e2e-outage-1',
  retryable: true,
};

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

  await page.route(`${BASE}/wallet/lots`, async (route) => {
    await route.fulfill({ json: MOCK_LOTS });
  });

  await page.route(`${BASE}/marketplace/packs*`, async (route) => {
    await route.fulfill({ json: MOCK_PACKS });
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
    // Open the edit form. Exact name: /edit/i would also match "Add credits"
    // (…cr-edit-s) on the balance card, which sits earlier in the DOM.
    const editBtn = page.getByRole('button', { name: 'Edit', exact: true });
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

    const editBtn = page.getByRole('button', { name: 'Edit', exact: true });
    await editBtn.click();
    const limitInput = page.getByPlaceholder('e.g. 10000');
    await limitInput.fill('5000');
    await page.getByRole('button', { name: /save budget/i }).click();

    // After refetch with OK status the progress bar must appear (24% used)
    await expect(page.getByText(/spent/)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/% used/)).toBeVisible({ timeout: 8_000 });
  });

  test('transaction table shows entryType badges', async ({ page }) => {
    // exact: getByText is case-insensitive substring by default, so 'TRIAL'
    // would also hit the "200 Trial" bucket chip.
    await expect(page.getByText('TRIAL', { exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('PURCHASE', { exact: true })).toBeVisible();
    await expect(page.getByText('USAGE DEBIT', { exact: true })).toBeVisible();
  });

  test('transaction table shows positive and negative amounts', async ({ page }) => {
    // Positive amounts shown with + prefix
    await expect(page.getByText('+1,000')).toBeVisible({ timeout: 8_000 });
    // Negative amount — rendered without +
    await expect(page.getByText('-760')).toBeVisible();
  });

  // ── Expiry timeline (Phase 6 §11, Wave 14) ─────────────────────────────────

  test('expiry timeline lists lots soonest-first with day chip and never-expires badge', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Credit Expiry' })).toBeVisible({ timeout: 8_000 });
    // Soon-expiring promo lot: "40 of 100 promotional credits" + "3d left"
    await expect(page.getByText(/promotional credits/)).toBeVisible();
    await expect(page.getByText(/3d left/)).toBeVisible();
    // Never-expiring purchased lot
    await expect(page.getByText('never expires')).toBeVisible();
  });

  // ── Credit marketplace (Phase 6 §12, Wave 14) ──────────────────────────────

  test('marketplace renders packs with price and buying POSTs recharge with packId + Idempotency-Key', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Buy Credits' })).toBeVisible({ timeout: 8_000 });
    // Identify packs by their credits line — pack names collide with the
    // sidebar brand ("AI CreatorForce") and role badge under substring matching.
    await expect(page.getByText('1,000 credits', { exact: true })).toBeVisible();
    await expect(page.getByText('$9.99')).toBeVisible();
    await expect(page.getByText('5,000 credits', { exact: true })).toBeVisible();
    await expect(page.getByText('$39.99')).toBeVisible();

    await page.route(`${BASE}/wallet/recharge`, async (route) => {
      await route.fulfill({ json: { checkoutUrl: null } });
    });

    const postReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/wallet/recharge'),
    );
    await page.getByRole('button', { name: /buy/i }).first().click();
    const req = await postReq;
    expect((req.postDataJSON() as { packId?: string }).packId).toBe('pack-1');
    expect(req.headers()['idempotency-key']).toBeTruthy();
  });

  // ── Provider-outage copy (risk R-06, Wave 19) ──────────────────────────────

  test('a PROVIDER-coded failure shows actionable outage copy, not the raw error', async ({ page }) => {
    await page.route(`${BASE}/wallet/recharge`, async (route) => {
      await route.fulfill({ status: 503, json: PROVIDER_OUTAGE_ENVELOPE });
    });

    await page.getByRole('button', { name: /buy/i }).first().click();

    await expect(page.getByText(/temporary provider outage/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/nothing was charged/i)).toBeVisible();
  });
});
