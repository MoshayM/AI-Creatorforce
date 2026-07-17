/* One-off UI smoke test for the /scheduler page. Run: node scheduler-smoke.cjs */
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  // Inject tokens before the dashboard loads
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([a, r]) => {
    localStorage.setItem('cf_token', a);
    localStorage.setItem('cf.refreshToken', r);
  }, [accessToken, refreshToken]);

  // 1. Scheduler page — month view
  await page.goto(`${WEB}/scheduler`, { waitUntil: 'networkidle' });
  await page.waitForSelector('h1:has-text("Scheduler")', { timeout: 20000 });
  const navEntry = await page.locator('nav a[href="/scheduler"], aside a[href="/scheduler"]').count();
  console.log(`nav entry present: ${navEntry > 0}`);

  await page.waitForSelector('text=Upcoming: Top 5 Editing Tricks', { timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/1-month-view.png` });
  console.log('month view rendered with seeded chips');

  // 2. Chip click -> detail modal
  await page.click('button:has-text("Upcoming: AI News Weekly #12")');
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  const hasScheduledFor = await page.locator('[role="dialog"] >> text=Scheduled for').count();
  console.log(`modal shows Scheduled for: ${hasScheduledFor > 0}`);
  await page.screenshot({ path: `${SHOTS}/2-detail-modal.png` });
  await page.keyboard.press('Escape');

  // 3. List view + Published filter
  await page.click('button:has-text("List")');
  await page.waitForSelector('text=Published: How I Automate YouTube', { timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/3-list-view.png` });
  await page.click('button:has-text("Published")');
  await page.waitForTimeout(1500);
  const rowCount = await page.locator('text=/^Published: /').count();
  console.log(`published filter rows: ${rowCount}`);

  // 4. Published row -> modal with YouTube link
  await page.click('button:has-text("Published: How I Automate YouTube")');
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  const ytLink = await page.locator('[role="dialog"] a:has-text("Open on YouTube")').getAttribute('href');
  console.log(`youtube link: ${ytLink}`);
  await page.screenshot({ path: `${SHOTS}/4-published-modal.png` });
  await page.keyboard.press('Escape');

  // 5. Summary card values
  const scheduledCard = await page.locator('p:text-is("Scheduled")').locator('xpath=following-sibling::p[1]').innerText();
  console.log(`Scheduled card value: ${scheduledCard}`);

  console.log(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  await browser.close();
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
