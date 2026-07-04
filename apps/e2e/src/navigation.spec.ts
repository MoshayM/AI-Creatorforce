import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
  });

  test('sidebar renders all nav links', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('a[href="/projects"]')).toBeVisible();
    await expect(page.locator('a[href="/approvals"]')).toBeVisible();
    await expect(page.locator('a[href="/jobs"]')).toBeVisible();
    await expect(page.locator('a[href="/brand-kit"]')).toBeVisible();
    await expect(page.locator('a[href="/settings"]')).toBeVisible();
    // Removed links must not appear in the sidebar
    await expect(page.locator('a[href="/discover"]')).toHaveCount(0);
    await expect(page.locator('a[href="/analytics"]')).toHaveCount(0);
    await expect(page.locator('a[href="/assets"]')).toHaveCount(0);
  });

  test('sidebar shows brand name', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('AI CreatorForce')).toBeVisible();
    await expect(page.getByText('AI Content Platform')).toBeVisible();
  });

  test('navigate to Projects page', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('a[href="/projects"]').click();
    await page.waitForURL(/\/projects/, { timeout: 50_000 });
    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({ timeout: 8_000 });
  });

  test('navigate to Approvals page', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('a[href="/approvals"]').click();
    await page.waitForURL(/\/approvals/, { timeout: 50_000 });
    await expect(page).toHaveURL(/\/approvals/);
    await expect(page.getByText('Approval Center')).toBeVisible({ timeout: 8_000 });
  });

  test('navigate to Jobs page', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('a[href="/jobs"]').click();
    await page.waitForURL(/\/jobs/, { timeout: 50_000 });
    await expect(page).toHaveURL(/\/jobs/);
    await expect(page.getByText('Agent Jobs')).toBeVisible({ timeout: 8_000 });
  });

  test('navigate to Settings page', { timeout: 60_000 }, async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('a[href="/settings"]').click();
    // Long timeout: settings page may still be compiling in dev mode
    await page.waitForURL(/\/settings/, { timeout: 50_000 });
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible({ timeout: 10_000 });
  });

  test('root path redirects to /projects', async ({ page }) => {
    await page.goto('/');
    // Middleware redirect may take a moment; wait explicitly
    await page.waitForURL(/\/projects/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/projects/);
  });

  test('active nav link is highlighted', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    const projectLink = page.locator('a[href="/projects"]');
    await expect(projectLink).toHaveClass(/bg-white\/20/);
  });
});
