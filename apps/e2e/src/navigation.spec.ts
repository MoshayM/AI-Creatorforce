import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
  });

  test('sidebar renders top-level nav links', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    // Top-level items always visible
    await expect(page.locator('a[href="/projects"]')).toBeVisible();
    await expect(page.locator('a[href="/approvals"]')).toBeVisible();
    await expect(page.locator('a[href="/settings"]')).toBeVisible();
    await expect(page.locator('a[href="/editor"]')).toBeVisible();
    // brand-kit is now a sub-link nested under Settings (collapsed by default
    // when not on a Settings sub-route). Do NOT assert it is visible here.
    // Removed links must not appear in the sidebar
    await expect(page.locator('a[href="/discover"]')).toHaveCount(0);
    await expect(page.locator('a[href="/analytics"]')).toHaveCount(0);
    await expect(page.locator('a[href="/assets"]')).toHaveCount(0);
    await expect(page.locator('a[href="/jobs"]')).toHaveCount(0);
  });

  test('Settings sub-links expand when Settings group is opened', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    // Settings group starts collapsed when not on a sub-route — expand it
    await page.getByRole('button', { name: /expand settings menu/i }).click();
    // Sub-links are now visible
    await expect(page.locator('a[href="/library"]')).toBeVisible();
    await expect(page.locator('a[href="/wallet"]')).toBeVisible();
    await expect(page.locator('a[href="/orgs"]')).toBeVisible();
    await expect(page.locator('a[href="/growth"]')).toBeVisible();
    await expect(page.locator('a[href="/brand-kit"]')).toBeVisible();
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

  test('navigate to Settings page', { timeout: 60_000 }, async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('a[href="/settings"]').click();
    // Long timeout: settings page may still be compiling in dev mode
    await page.waitForURL(/\/settings/, { timeout: 50_000 });
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to Video Editor page via sidebar', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('a[href="/editor"]').click();
    await page.waitForURL(/\/editor/, { timeout: 50_000 });
    await expect(page).toHaveURL(/\/editor/);
  });

  // Root (/) now shows the public landing page — it does NOT redirect to /projects.
  // An unauthenticated visit should see the marketing page with Log in / Get started CTA.
  test('root path shows landing page with Log in and Get started buttons', async ({ page }) => {
    // Visit as unauthenticated (no token set)
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => localStorage.removeItem('cf_token'));
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // The landing page is a marketing page — not the dashboard.
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('link', { name: 'Get started' })).toBeVisible({ timeout: 8_000 });
    // Must NOT be redirected to /projects
    await expect(page).toHaveURL('/');
  });

  test('active nav link is highlighted', async ({ page }) => {
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    const projectLink = page.locator('a[href="/projects"]');
    await expect(projectLink).toHaveClass(/bg-white\/20/);
  });

  // Mobile: sidebar is hidden behind an off-canvas drawer below lg breakpoint
  test('mobile hamburger opens the navigation drawer', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
    const hamburger = page.getByRole('button', { name: 'Open navigation menu' });
    await expect(hamburger).toBeVisible();
    await hamburger.click();
    // Sidebar drawer should now be visible
    await expect(page.locator('a[href="/projects"]')).toBeVisible({ timeout: 5_000 });
  });
});
