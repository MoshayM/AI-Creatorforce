import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

test.describe('Discover / Trend Analysis', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');
  });

  test('discover page renders', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Discover Trends' })).toBeVisible();
    await expect(page.getByText('Find trending YouTube topics in your niche')).toBeVisible();
    await expect(page.getByPlaceholder(/enter your niche/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /analyze/i })).toBeVisible();
  });

  test('analyze button disabled with empty niche', async ({ page }) => {
    const btn = page.getByRole('button', { name: /analyze/i });
    await expect(btn).toBeDisabled();
  });

  test('analyze button enabled after typing niche', async ({ page }) => {
    await page.getByPlaceholder(/enter your niche/i).fill('Technology');
    const btn = page.getByRole('button', { name: /analyze/i });
    await expect(btn).toBeEnabled();
  });

  test('clicking analyze shows trending results', async ({ page }) => {
    await page.getByPlaceholder(/enter your niche/i).fill('Technology');
    await page.getByRole('button', { name: /analyze/i }).click();
    await expect(page.getByText('AI Agents Automation 2026')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Local LLMs vs Cloud AI')).toBeVisible();
    await expect(page.getByText('Vibe Coding with AI')).toBeVisible();
  });

  test('trend results show score badges', async ({ page }) => {
    await page.getByPlaceholder(/enter your niche/i).fill('Technology');
    await page.getByRole('button', { name: /analyze/i }).click();
    await expect(page.getByText('Score: 94')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Score: 87')).toBeVisible();
  });

  test('trend results show related keywords', async ({ page }) => {
    await page.getByPlaceholder(/enter your niche/i).fill('Technology');
    await page.getByRole('button', { name: /analyze/i }).click();
    await expect(page.getByText('n8n')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Ollama')).toBeVisible();
  });

  test('pressing Enter in niche input triggers analyze', async ({ page }) => {
    await page.getByPlaceholder(/enter your niche/i).fill('Finance');
    await page.getByPlaceholder(/enter your niche/i).press('Enter');
    await expect(page.getByText('AI Agents Automation 2026')).toBeVisible({ timeout: 10_000 });
  });

  test('empty state shows placeholder when no analysis run', async ({ page }) => {
    await expect(page.getByText(/enter a niche and click analyze/i)).toBeVisible();
  });
});
