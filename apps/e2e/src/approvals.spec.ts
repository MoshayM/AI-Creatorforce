import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken, MOCK_APPROVALS } from './fixtures/api-mock';

const BASE = 'http://localhost:4007/api/v1';

test.describe('Approval Center', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
    await page.goto('/approvals');
    await page.waitForLoadState('domcontentloaded');
  });

  test('approvals page renders header', async ({ page }) => {
    await expect(page.getByText('Approval Center')).toBeVisible();
    await expect(page.getByText('Review AI-generated content before it goes live')).toBeVisible();
  });

  test('shows pending approval card', async ({ page }) => {
    await expect(page.getByText('AI Tools Deep Dive')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('TechReview Pro')).toBeVisible();
    // Use exact paragraph text to avoid matching JSON preview that contains "metadata"
    await expect(page.locator('p', { hasText: 'TechReview Pro' }).filter({ hasText: 'METADATA' })).toBeVisible();
  });

  test('approval card shows expiry date', async ({ page }) => {
    await expect(page.getByText(/expires/i)).toBeVisible({ timeout: 8_000 });
  });

  test('approval card shows AI result preview', async ({ page }) => {
    await expect(page.getByText(/Top 5 AI Tools/)).toBeVisible({ timeout: 8_000 });
  });

  test('approve button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible({ timeout: 8_000 });
  });

  test('reject button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /reject/i })).toBeVisible({ timeout: 8_000 });
  });

  test('notes textarea is editable', async ({ page }) => {
    const textarea = page.getByPlaceholder(/review notes/i);
    await expect(textarea).toBeVisible({ timeout: 8_000 });
    await textarea.fill('Looks great, approved for publishing');
    await expect(textarea).toHaveValue('Looks great, approved for publishing');
  });

  test('approving a request shows empty state', async ({ page }) => {
    let approved = false;
    // These new routes take priority over the ones from setupApiMocks (LIFO)
    await page.route(`${BASE}/approvals/pending`, async (route) => {
      await route.fulfill({ json: { data: approved ? [] : MOCK_APPROVALS, nextCursor: null } });
    });
    await page.route(/\/api\/v1\/approvals\/[^/]+\/approve$/, async (route) => {
      approved = true;
      await route.fulfill({ json: { id: 'appr-1', status: 'APPROVED' } });
    });

    await expect(page.getByRole('button', { name: /approve/i })).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: /approve/i }).click();
    await expect(page.getByText(/all caught up/i)).toBeVisible({ timeout: 8_000 });
  });

  test('rejecting a request shows empty state', async ({ page }) => {
    let rejected = false;
    await page.route(`${BASE}/approvals/pending`, async (route) => {
      await route.fulfill({ json: { data: rejected ? [] : MOCK_APPROVALS, nextCursor: null } });
    });
    await page.route(/\/api\/v1\/approvals\/[^/]+\/reject$/, async (route) => {
      rejected = true;
      await route.fulfill({ json: { id: 'appr-1', status: 'REJECTED' } });
    });

    await expect(page.getByRole('button', { name: /reject/i })).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: /reject/i }).click();
    await expect(page.getByText(/all caught up/i)).toBeVisible({ timeout: 8_000 });
  });
});
