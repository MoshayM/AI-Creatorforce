import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

// Visual regression snapshots (docs4/22). Surfaces are chosen to be
// time-stable: no relative dates, clocks, or unmocked data. Baselines live
// in visual.spec.ts-snapshots/ and are refreshed consciously with
// `npx playwright test visual.spec.ts --update-snapshots` after reviewing
// an intended visual change.

test.describe('Visual snapshots', () => {
  test('login page', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('login.png', { fullPage: true });
  });

  test('register page', async ({ page }) => {
    await page.goto('/register');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('register.png', { fullPage: true });
  });

  test('token override retheme: data-theme swaps the brand palette', async ({ page }) => {
    await page.goto('/login');
    const brand500 = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--cf-brand-500').trim(),
      );
    expect(await brand500()).toBe('139 92 246'); // default purple
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'ocean'));
    expect(await brand500()).toBe('14 165 233'); // ocean override
  });

  test('projects list (mocked data)', async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
    await page.goto('/projects');
    // Anchor on real content, not networkidle — the dash shell polls
    await expect(page.getByText('AI Tools Deep Dive')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveScreenshot('projects.png', { fullPage: true });
  });
});
