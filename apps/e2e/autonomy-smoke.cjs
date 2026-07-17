/* One-off UI smoke test for the /autonomy page + AI-planned chips on /scheduler. */
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
    localStorage.setItem('cf.autonomy.channelId', 'cmroi6f0m0001ew8cqy8ov5zb');
    localStorage.setItem('cf.scheduler.channelId', 'cmroi6f0m0001ew8cqy8ov5zb');
  }, [accessToken, refreshToken]);

  // Autonomy page
  await page.goto(`${WEB}/autonomy`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1:has-text("Autonomy")', { timeout: 20000 });
  await page.waitForSelector('text=Uploads / week (90d)', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const navEntry = await page.locator('a[href="/autonomy"]').count();
  const profileCard = await page.locator('text=Uploads / week (90d)').count();
  const proposals = await page.locator('button:has-text("Approve")').count();
  const approvedSection = await page.locator('text=/Approved \\(\\d+\\)/').count();
  console.log(`nav: ${navEntry > 0}, profile card: ${profileCard > 0}, proposals awaiting: ${proposals}, approved section: ${approvedSection > 0}`);
  await page.screenshot({ path: `${SHOTS}/8-autonomy.png`, fullPage: true });

  // Scheduler month view — AI planned chips
  await page.goto(`${WEB}/scheduler`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1:has-text("Scheduler")', { timeout: 20000 });
  await page.waitForTimeout(2000);
  const plannedChips = await page.locator('span[title^="AI planned"]').count();
  const legend = await page.locator('text=AI planned').count();
  console.log(`planned chips on calendar: ${plannedChips}, legend: ${legend > 0}`);
  await page.screenshot({ path: `${SHOTS}/9-scheduler-planned.png` });

  console.log(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  await browser.close();
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
