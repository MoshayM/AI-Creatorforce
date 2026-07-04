import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

test.describe('Projects', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
    await page.goto('/projects');
    await page.waitForLoadState('domcontentloaded');
  });

  test('projects page renders header', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(page.getByText('Manage your content campaigns')).toBeVisible();
    await expect(page.getByRole('button', { name: /new project/i })).toBeVisible();
  });

  test('lists existing projects', async ({ page }) => {
    await expect(page.getByText('AI Tools Deep Dive')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Beginner Coding Series')).toBeVisible();
  });

  test('projects show channel name', async ({ page }) => {
    const channelNames = page.getByText('TechReview Pro');
    await expect(channelNames.first()).toBeVisible({ timeout: 8_000 });
  });

  test('projects show status badge', async ({ page }) => {
    await expect(page.getByText('ACTIVE', { exact: true })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('DRAFT', { exact: true })).toBeVisible();
  });

  test('projects show job and video counts', async ({ page }) => {
    await expect(page.getByText('5 jobs')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('2 videos')).toBeVisible();
  });

  test('clicking New Project shows creation form', async ({ page }) => {
    await page.getByRole('button', { name: /new project/i }).click();
    await expect(page.getByText('Create Project')).toBeVisible();
    await expect(page.getByRole('combobox')).toBeVisible();
    await expect(page.getByPlaceholder('Project title')).toBeVisible();
    await expect(page.getByPlaceholder('Niche (optional)')).toBeVisible();
  });

  test('can cancel project creation', async ({ page }) => {
    await page.getByRole('button', { name: /new project/i }).click();
    await expect(page.getByText('Create Project')).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText('Create Project')).not.toBeVisible();
  });

  test('create button disabled when form incomplete', async ({ page }) => {
    await page.getByRole('button', { name: /new project/i }).click();
    const createBtn = page.getByRole('button', { name: /^create$/i });
    await expect(createBtn).toBeDisabled();
  });

  test('clicking project card navigates to detail', async ({ page }) => {
    await page.getByText('AI Tools Deep Dive').click();
    await page.waitForURL(/\/projects\/proj-1/, { timeout: 50_000 });
    await expect(page).toHaveURL(/\/projects\/proj-1/);
  });
});

test.describe('Project Detail', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setAuthToken(page);
    await page.goto('/projects/proj-1');
    await page.waitForLoadState('domcontentloaded');
  });

  test('shows project title and channel', async ({ page }) => {
    await expect(page.getByText('AI Tools Deep Dive')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/TechReview Pro/).first()).toBeVisible();
  });

  test('shows guided studio flow with channel header and stage tiles', async ({ page }) => {
    await expect(page.getByText('Producing for channel')).toBeVisible({ timeout: 8_000 });
    for (const tile of ['Analyse', 'Suggestion', 'Script', 'Voice over', 'Music', 'Video']) {
      await expect(page.getByText(tile, { exact: true })).toBeVisible();
    }
  });

  test('AI Video Production Studio card is dissolved into pipeline tiles', async ({ page }) => {
    await expect(page.getByText('AI Video Production Studio')).toHaveCount(0);
    // Production settings (incl. platform select) now live in the Analyse tile detail
    await page.getByLabel('Expand Analyse').click();
    await expect(page.getByRole('combobox', { name: 'Target platform' })).toBeVisible();
    await expect(page.getByText('Production settings')).toBeVisible();
  });

  test('analyse tile runs trend analysis', async ({ page }) => {
    // Mock data has a completed TREND_ANALYSIS, so the Analyse tile offers Re-run;
    // assert the click enqueues the right job type
    const jobPost = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/api/v1/jobs'));
    await page.getByRole('button', { name: /re-run/i }).first().click();
    const posted = (await jobPost).postDataJSON() as { type?: string };
    expect(posted.type).toBe('TREND_ANALYSIS');
  });

  test('shows recent jobs list', async ({ page }) => {
    await expect(page.getByText('Recent Jobs')).toBeVisible({ timeout: 8_000 });
    // Use exact: true so case-insensitive substring matching doesn't hit button labels
    await expect(page.getByText('TREND_ANALYSIS', { exact: true })).toBeVisible();
    await expect(page.getByText('RESEARCH', { exact: true })).toBeVisible();
    await expect(page.getByText('COMPLIANCE', { exact: true })).toBeVisible();
  });

  test('shows job status badges', async ({ page }) => {
    await expect(page.getByText('COMPLETED').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('WAITING_APPROVAL')).toBeVisible();
  });

  test('history entries are deletable', async ({ page }) => {
    await expect(page.getByText('Recent Jobs')).toBeVisible({ timeout: 8_000 });
    const deleteButtons = page.getByRole('button', { name: /^Delete .* run$/ });
    expect(await deleteButtons.count()).toBeGreaterThan(0);
    // Confirm flow appears on click
    await deleteButtons.first().click();
    await expect(page.getByRole('button', { name: /^delete$/i })).toBeVisible();
  });

});
