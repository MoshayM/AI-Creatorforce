import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

test.describe('Jobs Monitor', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
    await page.goto('/jobs');
    await page.waitForLoadState('domcontentloaded');
  });

  test('jobs page renders header', async ({ page }) => {
    await expect(page.getByText('Agent Jobs')).toBeVisible();
    await expect(page.getByText('Monitor AI processing tasks in real time')).toBeVisible();
  });

  test('shows empty state message', async ({ page }) => {
    await expect(page.getByText(/select a project/i)).toBeVisible();
  });
});
