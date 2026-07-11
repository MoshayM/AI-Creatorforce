import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

const BASE = 'http://localhost:4007/api/v1';

const MOCK_NOTIFICATIONS_UNREAD = {
  items: [
    {
      id: 'notif-1',
      type: 'trial.expiring',
      title: 'Trial expiring soon',
      body: 'Your trial ends in 2 days.',
      meta: {},
      readAt: null,
      createdAt: new Date(Date.now() - 30 * 60_000).toISOString(), // 30m ago
    },
    {
      id: 'notif-2',
      type: 'offer.available',
      title: 'New offer available',
      body: 'Claim your welcome bonus.',
      meta: {},
      readAt: null,
      createdAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(), // 2h ago
    },
  ],
  unreadCount: 2,
};

const MOCK_NOTIFICATIONS_ALL_READ = {
  items: MOCK_NOTIFICATIONS_UNREAD.items.map((n) => ({
    ...n,
    readAt: new Date().toISOString(),
  })),
  unreadCount: 0,
};

async function setupNotificationMocks(page: import('@playwright/test').Page) {
  let unreadCount = 2;
  let currentItems = [...MOCK_NOTIFICATIONS_UNREAD.items];

  await page.route(`${BASE}/notifications*`, async (route) => {
    await route.fulfill({
      json: { items: currentItems, unreadCount },
    });
  });

  await page.route(`${BASE}/notifications/read-all`, async (route) => {
    if (route.request().method() === 'POST') {
      unreadCount = 0;
      currentItems = MOCK_NOTIFICATIONS_ALL_READ.items;
      await route.fulfill({ json: { ok: true } });
    }
  });

  await page.route(/\/notifications\/[^/]+\/read$/, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: { ok: true } });
    }
  });
}

test.describe('Notifications bell', () => {
  test.beforeEach(async ({ page }) => {
    await setupNotificationMocks(page);
    await setupApiMocks(page);
    await setAuthToken(page);
    // Navigate to any dash page to load the shell layout
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
  });

  test('bell button renders in the top bar', async ({ page }) => {
    const bell = page.getByRole('button', { name: /notifications/i });
    await expect(bell).toBeVisible({ timeout: 8_000 });
  });

  test('bell shows unread badge with count "2"', async ({ page }) => {
    // The badge is a <span> rendered inside the bell button when unreadCount > 0.
    // The aria-label on the button encodes the count.
    const bell = page.getByRole('button', { name: /notifications.*2 unread/i });
    await expect(bell).toBeVisible({ timeout: 8_000 });

    // Also verify the visible badge text
    // The span sits absolutely inside the button; getByText can find it
    await expect(page.getByText('2', { exact: true }).first()).toBeVisible({ timeout: 8_000 });
  });

  test('opening the dropdown lists both notification titles', async ({ page }) => {
    const bell = page.getByRole('button', { name: /notifications/i });
    await bell.click();

    const dropdown = page.getByRole('dialog', { name: 'Notifications' });
    await expect(dropdown).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Trial expiring soon')).toBeVisible();
    await expect(page.getByText('New offer available')).toBeVisible();
  });

  test('"Mark all read" button POSTs /notifications/read-all', async ({ page }) => {
    const bell = page.getByRole('button', { name: /notifications/i });
    await bell.click();
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible({ timeout: 8_000 });

    const markAllReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/notifications/read-all'),
    );
    await page.getByRole('button', { name: /mark all read/i }).click();
    await markAllReq;
  });

  test('after "Mark all read" the unread badge clears', async ({ page }) => {
    const bell = page.getByRole('button', { name: /notifications/i });
    await bell.click();
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible({ timeout: 8_000 });

    // Override notifications mock to return 0 unread after mark-all-read fires
    await page.route(`${BASE}/notifications*`, async (route) => {
      await route.fulfill({ json: MOCK_NOTIFICATIONS_ALL_READ });
    });

    await page.getByRole('button', { name: /mark all read/i }).click();

    // The DashLayout calls handleMarkAllRead which sets unreadCount to 0 in-memory
    // (no re-fetch needed). The bell aria-label loses the "(N unread)" suffix.
    await expect(
      page.getByRole('button', { name: /^Notifications$/ }),
    ).toBeVisible({ timeout: 8_000 });

    // The badge span should no longer be present (unreadCount === 0 → not rendered)
    // We assert by confirming no element now shows the badge text "2"
    // Note: we use a scoped locator to avoid matching unrelated content
    const bellWrapper = page.locator('.dash-topbar');
    await expect(bellWrapper.getByText('2', { exact: true })).toHaveCount(0, { timeout: 8_000 });
  });
});
