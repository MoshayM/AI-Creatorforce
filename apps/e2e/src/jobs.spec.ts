import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

// Job monitoring now lives on the project detail page (the standalone
// /jobs page was removed and merged into "Recent Jobs").
test.describe('Job History (project page)', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
    await page.goto('/projects/proj-1');
    await page.waitForLoadState('domcontentloaded');
  });

  test('renders the Recent Jobs section', async ({ page }) => {
    await expect(page.getByText('Recent Jobs')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('All AI agent runs for this project')).toBeVisible();
  });

  test('lists job runs with status badges', async ({ page }) => {
    await expect(page.getByText('TREND_ANALYSIS')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('RESEARCH', { exact: true })).toBeVisible();
    await expect(page.getByText('COMPLIANCE', { exact: true })).toBeVisible();
    await expect(page.getByText('Awaiting Review')).toBeVisible();
  });

  test('standalone /jobs route no longer exists', async ({ page }) => {
    const response = await page.goto('/jobs');
    expect(response?.status()).toBe(404);
  });
});
