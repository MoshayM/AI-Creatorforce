/* One-off UI smoke test for the /channel-access page + renamed nav. */
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
  if (!loginRes.ok) throw new Error(`login failed: ${loginRes.status}`);
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

  // Open dashboard, expand Settings group so children (Media Control, Channel access) render
  await page.goto(`${WEB}/library`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1:has-text("Media Control")', { timeout: 20000 });
  console.log('library page heading renamed to Media Control: true');
  const settingsToggle = page.locator('a[href="/settings"], button:has-text("Settings")').first();
  await settingsToggle.click().catch(() => {});
  await page.waitForTimeout(800);
  const mediaControlNav = await page.locator('a[href="/library"]:has-text("Media Control")').count();
  const channelAccessNav = await page.locator('a[href="/channel-access"]:has-text("Channel access")').count();
  console.log(`nav Media Control entry: ${mediaControlNav > 0}, Channel access under it: ${channelAccessNav > 0}`);
  await page.screenshot({ path: `${SHOTS}/5-nav-media-control.png` });

  // Channel access page — one panel: YouTube + socials
  await page.goto(`${WEB}/channel-access`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1:has-text("Channel Access")', { timeout: 20000 });
  const youtube = await page.locator('h2:has-text("YouTube Channels")').count();
  const socials = {};
  for (const name of ['Facebook', 'Instagram', 'TikTok', 'Others']) {
    socials[name] = await page.locator(`p:text-is("${name}")`).count();
  }
  console.log(`YouTube section: ${youtube > 0}, socials: ${JSON.stringify(socials)}`);
  await page.screenshot({ path: `${SHOTS}/6-channel-access.png`, fullPage: true });

  // Settings page no longer shows YouTube Channels
  await page.goto(`${WEB}/settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1:has-text("Settings")', { timeout: 20000 });
  const ytOnSettings = await page.locator('h2:has-text("YouTube Channels")').count();
  console.log(`YouTube section removed from settings: ${ytOnSettings === 0}`);
  await page.screenshot({ path: `${SHOTS}/7-settings-clean.png` });

  console.log(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  await browser.close();
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
