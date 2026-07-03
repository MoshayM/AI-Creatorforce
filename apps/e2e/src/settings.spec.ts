import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
    await page.goto('/settings');
    await page.waitForLoadState('domcontentloaded');
  });

  test('settings page renders sections', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByText('YouTube Channels')).toBeVisible();
    await expect(page.getByText('Billing')).toBeVisible();
  });

  test('shows empty state when no channel connected', async ({ page }) => {
    await expect(page.getByText('No YouTube channel connected')).toBeVisible({ timeout: 8_000 });
  });

  test('shows connect channel button in empty state', async ({ page }) => {
    await expect(page.getByRole('button', { name: /connect with google/i })).toBeVisible({ timeout: 8_000 });
  });

  test('shows current subscription plan', async ({ page }) => {
    await expect(page.getByText('Current plan: FREE')).toBeVisible({ timeout: 8_000 });
  });

  test('shows all pricing plans', async ({ page }) => {
    await expect(page.getByText('Starter')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Pro', { exact: true })).toBeVisible();
    await expect(page.getByText('Agency')).toBeVisible();
  });

  test('shows plan prices', async ({ page }) => {
    await expect(page.getByText('$29/mo')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('$79/mo')).toBeVisible();
    await expect(page.getByText('$199/mo')).toBeVisible();
  });

  test('shows plan features', async ({ page }) => {
    await expect(page.getByText('5 videos/mo')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('All 15 agents')).toBeVisible();
    await expect(page.getByText('Team seats')).toBeVisible();
  });

  test('upgrade buttons are visible for non-current plans', async ({ page }) => {
    const upgradeBtns = page.getByRole('button', { name: /upgrade/i });
    await expect(upgradeBtns.first()).toBeVisible({ timeout: 8_000 });
  });
});
