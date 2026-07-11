import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

const BASE = 'http://localhost:4007/api/v1';

// Five days from now
const EXPIRES_AT = new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString();

const MOCK_TRIAL_STATUS = {
  hasTrial: true,
  status: 'ACTIVE',
  creditsGranted: 100,
  trialCreditsRemaining: 40,
  expiresAt: EXPIRES_AT,
};

const MOCK_UPGRADE_RECS = [
  {
    id: 'rec-1',
    reasonCode: 'low_trial_credits',
    recommendedPlan: 'PRO',
    confidence: 0.9,
    createdAt: new Date().toISOString(),
  },
];

// Direct-redeemable offer (no minRecharge gate)
const MOCK_OFFER_DIRECT = {
  id: 'offer-direct',
  type: 'WELCOME',
  name: 'Welcome Bonus',
  rewardType: 'CREDITS',
  rewardValue: 250,
  minRechargeMinor: null,
  validTo: null,
  redeemable: true,
};

// Auto-applied offer (minRecharge required)
const MOCK_OFFER_AUTO = {
  id: 'offer-auto',
  type: 'FIRST_RECHARGE',
  name: 'First Recharge Bonus',
  rewardType: 'CREDITS',
  rewardValue: 500,
  minRechargeMinor: 1000, // $10.00
  validTo: null,
  redeemable: false,
};

const MOCK_REFERRAL_CODE = { code: 'AB2CD3EF' };

const MOCK_REFERRAL_EARNINGS = {
  code: 'AB2CD3EF',
  totalCredits: 0,
  qualifiedCount: 0,
  pendingCount: 0,
  flaggedCount: 0,
  referrals: [],
};

const MOCK_LEADERBOARD = [
  { rank: 1, userLabel: 'TopCreator (you)', qualifiedCount: 10, totalCredits: 2000 },
  { rank: 2, userLabel: 'OtherUser', qualifiedCount: 7, totalCredits: 1400 },
];

async function setupGrowthMocks(page: import('@playwright/test').Page) {
  await page.route(`${BASE}/trial/status`, async (route) => {
    await route.fulfill({ json: MOCK_TRIAL_STATUS });
  });

  await page.route(`${BASE}/upgrade/recommendations`, async (route) => {
    await route.fulfill({ json: MOCK_UPGRADE_RECS });
  });

  await page.route(/\/upgrade\/recommendations\/[^/]+\/dismiss$/, async (route) => {
    await route.fulfill({ json: { dismissed: true } });
  });

  await page.route(`${BASE}/offers`, async (route) => {
    await route.fulfill({ json: [MOCK_OFFER_DIRECT, MOCK_OFFER_AUTO] });
  });

  await page.route(/\/offers\/[^/]+\/redeem$/, async (route) => {
    await route.fulfill({ json: { redeemed: true, credits: 250 } });
  });

  // Referral code (POST to get-or-create)
  await page.route(`${BASE}/referral/code`, async (route) => {
    await route.fulfill({ json: MOCK_REFERRAL_CODE });
  });

  await page.route(`${BASE}/referral/earnings`, async (route) => {
    await route.fulfill({ json: MOCK_REFERRAL_EARNINGS });
  });

  await page.route(`${BASE}/referral/leaderboard`, async (route) => {
    await route.fulfill({ json: MOCK_LEADERBOARD });
  });

  await page.route(`${BASE}/referral/redeem`, async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
}

test.describe('Growth', () => {
  test.beforeEach(async ({ page }) => {
    await setupGrowthMocks(page);
    await setupApiMocks(page);
    await setAuthToken(page);
    await page.goto('/growth');
    await page.waitForLoadState('domcontentloaded');
  });

  test('page heading renders', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Growth', level: 1 })).toBeVisible({ timeout: 8_000 });
  });

  // ── Trial card ───────────────────────────────────────────────────────────────

  test('trial card shows "ACTIVE" status chip', async ({ page }) => {
    await expect(page.getByText('ACTIVE')).toBeVisible({ timeout: 8_000 });
  });

  test('trial card shows credits-remaining progress text', async ({ page }) => {
    await expect(page.getByText('40 remaining')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('100 granted')).toBeVisible();
  });

  test('trial card shows days-until-expiry text', async ({ page }) => {
    // Rendered as "Expires in N day(s) (...)"
    await expect(page.getByText(/Expires in \d+ days?/)).toBeVisible({ timeout: 8_000 });
  });

  // ── Upgrade nudge banner ─────────────────────────────────────────────────────

  test('upgrade nudge banner renders reason text', async ({ page }) => {
    await expect(page.getByText(/running low on trial credits/i)).toBeVisible({ timeout: 8_000 });
  });

  test('dismissing nudge POSTs the dismiss endpoint and banner disappears', async ({ page }) => {
    await expect(page.getByText(/running low on trial credits/i)).toBeVisible({ timeout: 8_000 });

    let dismissedId = '';
    await page.route(/\/upgrade\/recommendations\/[^/]+\/dismiss$/, async (route) => {
      dismissedId = route.request().url().split('/').slice(-2)[0]!;
      await route.fulfill({ json: { dismissed: true } });
    });

    // Mock the refetch to return empty list so the banner disappears
    await page.route(`${BASE}/upgrade/recommendations`, async (route) => {
      await route.fulfill({ json: [] });
    });

    const dismissReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/upgrade/recommendations/') && r.url().includes('/dismiss'),
    );
    await page.getByRole('button', { name: /dismiss recommendation/i }).click();
    await dismissReq;
    expect(dismissedId).toBe('rec-1');

    await expect(page.getByText(/running low on trial credits/i)).not.toBeVisible({ timeout: 8_000 });
  });

  // ── Offer Center ─────────────────────────────────────────────────────────────

  test('auto-applied offer shows "Applied automatically" text (no Redeem button)', async ({ page }) => {
    await expect(page.getByText('First Recharge Bonus')).toBeVisible({ timeout: 8_000 });
    // minRechargeMinor is non-null → shows "Applied automatically…" paragraph
    await expect(page.getByText(/Applied automatically/i)).toBeVisible({ timeout: 8_000 });
    // The offer is not redeemable so no Redeem button for it
    // (Welcome offer is redeemable; assert only one Redeem button total)
    await expect(page.getByRole('button', { name: /redeem/i })).toHaveCount(1);
  });

  test('direct offer has Redeem button and clicking it POSTs redeem endpoint', async ({ page }) => {
    await expect(page.getByText('Welcome Bonus')).toBeVisible({ timeout: 8_000 });
    const redeemReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/offers/offer-direct/redeem'),
    );
    await page.getByRole('button', { name: /redeem/i }).click();
    await redeemReq;
  });

  // ── Referral Center ──────────────────────────────────────────────────────────

  test('referral code is displayed', async ({ page }) => {
    await expect(page.getByText('AB2CD3EF')).toBeVisible({ timeout: 8_000 });
  });

  test('share URL contains ?ref=AB2CD3EF', async ({ page }) => {
    await expect(page.getByText('AB2CD3EF')).toBeVisible({ timeout: 8_000 });
    // The share link input is a read-only text field that contains the ref param
    const shareInput = page.locator('input[readonly]');
    await expect(shareInput).toHaveValue(/ref=AB2CD3EF/, { timeout: 8_000 });
  });

  test('referral leaderboard renders two entries', async ({ page }) => {
    await expect(page.getByText('Referral Leaderboard')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('TopCreator (you)')).toBeVisible();
    await expect(page.getByText('OtherUser')).toBeVisible();
  });

  test('redeem box POSTs /referral/redeem on Apply', async ({ page }) => {
    const redeemReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/referral/redeem'),
    );
    const codeInput = page.getByRole('textbox', { name: /referral code input/i });
    await codeInput.fill('FRIEND99');
    await page.getByRole('button', { name: /apply/i }).click();
    const req = await redeemReq;
    const body = req.postDataJSON() as { code?: string };
    expect(body.code).toBe('FRIEND99');
  });

  test('409 response from redeem shows inline error message', async ({ page }) => {
    // Override the redeem mock to return 409
    await page.route(`${BASE}/referral/redeem`, async (route) => {
      await route.fulfill({
        status: 409,
        json: { message: 'Code already redeemed' },
      });
    });

    const codeInput = page.getByRole('textbox', { name: /referral code input/i });
    await codeInput.fill('USED123');
    await page.getByRole('button', { name: /apply/i }).click();

    // The component sets redeemError from the response message
    await expect(page.getByText('Code already redeemed')).toBeVisible({ timeout: 8_000 });
  });
});
