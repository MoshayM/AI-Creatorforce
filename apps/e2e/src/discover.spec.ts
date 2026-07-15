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

  test('results show save and print buttons', async ({ page }) => {
    await page.getByPlaceholder(/enter your niche/i).fill('Technology');
    await page.getByRole('button', { name: /analyze/i }).click();
    await expect(page.getByText('AI Agents Automation 2026')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /save/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /print/i })).toBeVisible();
  });

  test('shows AI working card with elapsed timer while analyzing', async ({ page }) => {
    // Delayed route (registered after setupApiMocks, so it takes priority) keeps
    // the processing state visible long enough to assert on it
    await page.route('**/api/v1/trends/analyze', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.fulfill({ json: {
        trending: [{ topic: 'Delayed Topic', score: 90, relatedKeywords: ['kw'] }],
        recommendations: [],
        analysisDate: '2026-07-03',
      } });
    });
    await page.getByPlaceholder(/enter your niche/i).fill('Technology');
    await page.getByRole('button', { name: /analyze/i }).click();
    await expect(page.getByText('Analyzing "Technology" trends')).toBeVisible();
    await expect(page.getByText('elapsed')).toBeVisible();
    await expect(page.getByText('Delayed Topic')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/analyzed in \d+/)).toBeVisible();
  });

  test('save button downloads results as JSON', async ({ page }) => {
    await page.getByPlaceholder(/enter your niche/i).fill('Technology');
    await page.getByRole('button', { name: /analyze/i }).click();
    await expect(page.getByText('AI Agents Automation 2026')).toBeVisible({ timeout: 10_000 });
    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
    await page.getByRole('button', { name: /save/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^trends-technology-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
