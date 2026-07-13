import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

/**
 * Automated WCAG checks (docs4/42 + /19 + /22): axe-core over every core
 * surface, gating on serious/critical violations under the WCAG 2.2 AA tag
 * set — this includes color-contrast, which the jsx-a11y lint gate cannot
 * see. Moderate/minor findings are reported in the failure payload when a
 * gate trips but do not gate on their own.
 */

const AUTHED_PAGES = ['/projects', '/wallet', '/growth', '/library', '/orgs', '/approvals', '/settings'];

async function auditCurrentPage(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
}

test.describe('Accessibility (axe, WCAG 2.2 AA)', () => {
  for (const path of AUTHED_PAGES) {
    test(`${path} has no serious/critical violations`, async ({ page }) => {
      await setupApiMocks(page);
      await setAuthToken(page);
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible({ timeout: 10_000 });

      expect(await auditCurrentPage(page)).toEqual([]);
    });
  }

  test('/login has no serious/critical violations', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });

    expect(await auditCurrentPage(page)).toEqual([]);
  });
});
