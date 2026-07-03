import { Page } from '@playwright/test';

export async function loginAs(page: Page, email = 'test@creatorforce.ai', password = 'TestPass123!') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  // Wait for redirect to dashboard
  await page.waitForURL(/\/(discover|projects|approvals)/, { timeout: 10_000 });
}

export async function setAuthToken(page: Page) {
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.setItem('cf_token', 'mock-jwt-token-for-testing');
  });
}
