/**
 * Quick diagnostic run — capture console errors with full URL detail
 */
const { chromium } = require('@playwright/test');

const API_BASE  = 'http://localhost:4007/api/v1';
const APP_BASE  = 'http://localhost:3007';
const SHOTS_DIR = 'D:/project/creatorforce-ai/shots';

async function main() {
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ss-live-test@cf.io', password: 'TestPass123!' }),
  });
  const loginData = await loginRes.json();
  const token = loginData.accessToken || loginData.data?.accessToken;

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => { localStorage.setItem('cf_token', t); }, token);
  await ctx.addCookies([{ name: 'cf_token', value: token, domain: 'localhost', path: '/', httpOnly: false, secure: false }]);
  const page = await ctx.newPage();

  const allConsole = [];
  page.on('console', msg => allConsole.push({ type: msg.type(), text: msg.text() }));
  page.on('requestfailed', req => allConsole.push({ type: 'requestfailed', text: req.url() + ' — ' + req.failure()?.errorText }));
  page.on('response', resp => {
    if (resp.status() >= 400) allConsole.push({ type: 'http' + resp.status(), text: resp.url() });
  });

  await page.goto(`${APP_BASE}/projects`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS_DIR}/test-del-diag.png` });

  console.log('All console/network events:');
  allConsole.forEach(e => console.log(`  [${e.type}] ${e.text}`));

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
