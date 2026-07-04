import { test, expect } from '@playwright/test';
import { setupApiMocks } from './fixtures/api-mock';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    // Navigate to a real page first before accessing localStorage
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => localStorage.removeItem('cf_token'));
  });

  test('login page renders correctly', async ({ page }) => {
    await expect(page.getByText('AI CreatorForce')).toBeVisible();
    await expect(page.getByText('Welcome Back')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^login$/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /sign up/i })).toBeVisible();
  });

  test('register page renders correctly', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByText('Create Account')).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign up/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /^login$/i })).toBeVisible();
  });

  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.getByLabel('Email').fill('test@creatorforce.ai');
    await page.getByLabel('Password', { exact: true }).fill('TestPass123!');
    await page.getByRole('button', { name: /^login$/i }).click();
    // Extended timeout: /discover may need compilation on first hit (~8s)
    await page.waitForURL(/\/discover/, { timeout: 25_000 });
    expect(page.url()).toContain('/discover');
  });

  test('login stores token in localStorage', async ({ page }) => {
    await page.getByLabel('Email').fill('test@creatorforce.ai');
    await page.getByLabel('Password', { exact: true }).fill('TestPass123!');
    await page.getByRole('button', { name: /^login$/i }).click();
    await page.waitForURL(/\/discover/, { timeout: 25_000 });
    const token = await page.evaluate(() => localStorage.getItem('cf_token'));
    expect(token).toBeTruthy();
    expect(token).toBe('mock-jwt-token-for-testing');
  });

  test('register with valid data redirects to dashboard', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel(/email/i).fill('newuser@example.com');
    await page.getByLabel('Password', { exact: true }).fill('NewPass123!');
    await page.getByRole('button', { name: /sign up/i }).click();
    await page.waitForURL(/\/discover/, { timeout: 25_000 });
    expect(page.url()).toContain('/discover');
  });

  test('login to register navigation works', async ({ page }) => {
    await page.getByRole('link', { name: /sign up/i }).click();
    await expect(page).toHaveURL(/\/register/);
  });

  test('register to login navigation works', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('link', { name: /^login$/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated user redirected from dashboard', async ({ page }) => {
    // token already removed in beforeEach
    await page.goto('/discover');
    await page.waitForURL(/\/login/, { timeout: 8_000 });
    expect(page.url()).toContain('/login');
  });

  test('logout clears token and redirects to login', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('cf_token', 'mock-jwt-token-for-testing'));
    await page.goto('/discover');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: /sign out/i }).click();
    await page.waitForURL(/\/login/, { timeout: 8_000 });
    const token = await page.evaluate(() => localStorage.getItem('cf_token'));
    expect(token).toBeNull();
  });
});
