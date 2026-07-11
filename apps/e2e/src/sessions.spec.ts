import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

const BASE = 'http://localhost:4007/api/v1';

const MOCK_PROVIDERS = { google: true, apple: false, facebook: false };

const MOCK_AUTH_LINKS = {
  password: true,
  links: [
    {
      provider: 'google',
      email: 'test@gmail.com',
      linkedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

function makeSessions(currentId: string) {
  return [
    {
      id: currentId,
      device: 'Chrome 126 on Windows 10',
      ip: '192.168.1.1',
      createdAt: '2026-07-01T10:00:00.000Z',
      lastUsedAt: '2026-07-11T09:00:00.000Z',
      current: true,
    },
    {
      id: 'sess-other',
      device: 'Safari 17 on macOS',
      ip: '10.0.0.2',
      createdAt: '2026-06-15T08:00:00.000Z',
      lastUsedAt: '2026-07-10T18:00:00.000Z',
      current: false,
    },
  ];
}

async function setupSessionsMocks(page: import('@playwright/test').Page) {
  const CURRENT_SESSION_ID = 'sess-current';
  let sessions = makeSessions(CURRENT_SESSION_ID);

  await page.route(`${BASE}/auth/providers`, async (route) => {
    await route.fulfill({ json: MOCK_PROVIDERS });
  });

  await page.route(`${BASE}/auth/links`, async (route) => {
    await route.fulfill({ json: MOCK_AUTH_LINKS });
  });

  await page.route(`${BASE}/auth/sessions`, async (route) => {
    await route.fulfill({ json: sessions });
  });

  // Revoke a specific session
  await page.route(/\/auth\/sessions\/[^/]+$/, async (route) => {
    if (route.request().method() === 'DELETE') {
      const url = route.request().url();
      const id = url.split('/').pop()!;
      // Remove from in-memory list so subsequent GET returns updated data
      sessions = sessions.filter((s) => s.id !== id);
      await route.fulfill({ status: 200, json: { revoked: true } });
    } else {
      await route.continue();
    }
  });
}

test.describe('Settings — Sign-in & Security', () => {
  test.beforeEach(async ({ page }) => {
    await setupSessionsMocks(page);
    await setupApiMocks(page);
    await setAuthToken(page);
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');
    // Ensure the Sign-in & Security section is visible before each test
    await expect(page.getByRole('heading', { name: /sign-in.*security/i })).toBeVisible({ timeout: 10_000 });
  });

  // ── Linked accounts ──────────────────────────────────────────────────────────

  test('linked accounts panel is visible', async ({ page }) => {
    await expect(page.getByText('Linked accounts')).toBeVisible();
  });

  test('Google shows as connected with Disconnect button', async ({ page }) => {
    // The linked Google account row shows the email and a Disconnect button
    await expect(page.getByText('test@gmail.com')).toBeVisible({ timeout: 8_000 });
    // There can be multiple Disconnect buttons (channel rows also have one);
    // scope to the Sign-in section which uses unlinkProviderMutation
    const disconnectBtns = page.getByRole('button', { name: /disconnect/i });
    await expect(disconnectBtns.first()).toBeVisible();
  });

  test('Apple shows as "Not configured" (provider disabled)', async ({ page }) => {
    // Apple provider is disabled → shows the span "Not configured"
    // The row always renders the provider label "Apple"
    await expect(page.getByText('Apple')).toBeVisible({ timeout: 8_000 });
    // Provider disabled → no Connect button, shows italic "Not configured" text
    // (distinct from "Not connected" which appears for enabled-but-unlinked providers)
    const notConfiguredSpans = page.getByText('Not configured', { exact: true });
    await expect(notConfiguredSpans.first()).toBeVisible({ timeout: 8_000 });
  });

  test('Facebook shows as "Not configured" (provider disabled)', async ({ page }) => {
    await expect(page.getByText('Facebook')).toBeVisible({ timeout: 8_000 });
    const notConfiguredSpans = page.getByText('Not configured', { exact: true });
    // At least two "Not configured" spans: Apple + Facebook
    await expect(notConfiguredSpans.nth(1)).toBeVisible({ timeout: 8_000 });
  });

  // ── Active sessions ──────────────────────────────────────────────────────────

  test('active sessions section renders two rows', async ({ page }) => {
    await expect(page.getByText('Active sessions')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Chrome 126 on Windows 10')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Safari 17 on macOS')).toBeVisible();
  });

  test('"This device" badge appears on the current session', async ({ page }) => {
    await expect(page.getByText('This device')).toBeVisible({ timeout: 8_000 });
  });

  test('Revoke on non-current session DELETEs /auth/sessions/:id', async ({ page }) => {
    await expect(page.getByText('Safari 17 on macOS')).toBeVisible({ timeout: 8_000 });

    const deleteReq = page.waitForRequest(
      (r) => r.method() === 'DELETE' && r.url().includes('/auth/sessions/sess-other'),
    );

    // There are two Revoke buttons (one per session); click the second one
    // (first belongs to the current session)
    const revokeBtns = page.getByRole('button', { name: /^revoke$/i });
    await revokeBtns.nth(1).click();

    // Confirm dialog appears — click "Yes, revoke"
    await page.getByRole('button', { name: /yes, revoke/i }).click();
    await deleteReq;

    // After the list refetch the Safari row should be gone
    await expect(page.getByText('Safari 17 on macOS')).not.toBeVisible({ timeout: 8_000 });
  });

  test('"Sign out all other sessions" triggers DELETE for non-current sessions', async ({ page }) => {
    await expect(page.getByText('Active sessions')).toBeVisible({ timeout: 8_000 });

    const deleteReq = page.waitForRequest(
      (r) => r.method() === 'DELETE' && r.url().includes('/auth/sessions/sess-other'),
    );

    await page.getByRole('button', { name: /sign out all other sessions/i }).click();
    await deleteReq;
  });
});
