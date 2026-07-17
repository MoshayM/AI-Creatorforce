/* One-off UI smoke: merged Media Control panel + Billing & Wallet page. */
const { chromium } = require('@playwright/test');
const path = require('path');

const WEB = 'http://localhost:3007';
const API = 'http://localhost:4007/api/v1';
const SHOTS = path.join(__dirname, '..', '..', 'logs', 'shots');
const CREDS = { email: 'scheduler-test@example.com', password: 'SchedTest!2026' };

async function main() {
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(CREDS),
  });
  const { accessToken, refreshToken } = await loginRes.json();

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, r]) => {
    localStorage.setItem('cf_token', a);
    localStorage.setItem('cf.refreshToken', r);
  }, [accessToken, refreshToken]);

  // 1. Media Control page has 3 tabs, Channel Access tab renders merged panel
  await page.goto(`${WEB}/library?tab=channels`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1:has-text("Media Control")', { timeout: 20000 });
  const tabs = {};
  for (const t of ['Videos', 'Playlists', 'Channel Access']) {
    tabs[t] = await page.locator(`button:text-is("${t}")`).count();
  }
  await page.waitForSelector('h2:has-text("YouTube Channels")', { timeout: 15000 });
  const socials = await page.locator('h2:has-text("Social Platforms")').count();
  console.log(`tabs: ${JSON.stringify(tabs)}, YouTube+socials in tab: ${socials > 0}`);
  await page.screenshot({ path: `${SHOTS}/10-media-control-merged.png`, fullPage: true });

  // 2. Old /channel-access redirects into the merged tab
  await page.goto(`${WEB}/channel-access?connected=x`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  console.log(`/channel-access redirects to: ${page.url().replace(WEB, '')}`);

  // 3. Nav has single Media Control entry, no separate Channel access
  const mcNav = await page.locator('a[href="/library"]:has-text("Media Control")').count();
  const caNav = await page.locator('a[href="/channel-access"]').count();
  console.log(`nav Media Control: ${mcNav > 0}, old Channel access entry gone: ${caNav === 0}`);

  // 4. Billing & Wallet page with subscription plans
  await page.goto(`${WEB}/wallet`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1:has-text("Billing & Wallet")', { timeout: 20000 });
  const plansSection = await page.locator('h2:has-text("Subscription & Plans")').count();
  const upgradeButtons = await page.locator('button:has-text("Upgrade")').count();
  const navLabel = await page.locator('a[href="/wallet"]:has-text("Billing & Wallet")').count();
  console.log(`wallet renamed: true, plans section: ${plansSection > 0}, plan buttons: ${upgradeButtons}, nav label: ${navLabel > 0}`);
  await page.screenshot({ path: `${SHOTS}/11-billing-wallet.png`, fullPage: true });

  // 5. Settings no longer has Billing
  await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1:has-text("Settings")', { timeout: 20000 });
  const billingOnSettings = await page.locator('h2:has-text("Billing")').count();
  console.log(`Billing removed from settings: ${billingOnSettings === 0}`);

  console.log(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  await browser.close();
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
