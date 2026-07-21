// dash-screenshots.cjs — headless Playwright screenshot runner for all dashboard pages
const { chromium } = require('@playwright/test');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3007';
const API  = 'http://localhost:4007/api/v1';
const OUT  = 'D:/project/creatorforce-ai/shots';

const PAGES = [
  { route: '/home',           file: 'ss-dash-home.png' },
  { route: '/projects',       file: 'ss-dash-projects.png' },
  { route: '/shorts-studio',  file: 'ss-dash-shorts-studio.png' },
  { route: '/analytics',      file: 'ss-dash-analytics.png' },
  { route: '/publishing',     file: 'ss-dash-publishing.png' },
  { route: '/library',        file: 'ss-dash-library.png' },
  { route: '/research',       file: 'ss-dash-research.png' },
  { route: '/scheduler',      file: 'ss-dash-scheduler.png' },
  { route: '/wallet',         file: 'ss-dash-wallet.png' },
  { route: '/settings',       file: 'ss-dash-settings.png' },
  { route: '/growth',         file: 'ss-dash-growth.png' },
  { route: '/discover',       file: 'ss-dash-discover.png' },
  { route: '/automation',     file: 'ss-dash-automation.png' },
  { route: '/monitor',        file: 'ss-dash-monitor.png' },
  { route: '/notifications',  file: 'ss-dash-notifications.png' },
  { route: '/strategy',       file: 'ss-dash-strategy.png' },
  { route: '/brand-kit',      file: 'ss-dash-brand-kit.png' },
  { route: '/assets',         file: 'ss-dash-assets.png' },
  { route: '/repurpose',      file: 'ss-dash-repurpose.png' },
  { route: '/orgs',           file: 'ss-dash-orgs.png' },
  { route: '/series-planner', file: 'ss-dash-series-planner.png' },
  { route: '/autonomy',       file: 'ss-dash-autonomy.png' },
  { route: '/ab-testing',     file: 'ss-dash-ab-testing.png' },
];

function apiPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = http.request(url, opts, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getToken() {
  const creds = { name: 'Screenshot Test', email: 'ss-test-2026@creatorforce.io', password: 'TestPass123!' };

  // Try register first
  console.log('Registering user...');
  const reg = await apiPost(`${API}/auth/register`, creds);
  console.log('Register status:', reg.status, JSON.stringify(reg.body).slice(0, 200));

  // If already exists (409/400/etc), just login
  console.log('Logging in...');
  const login = await apiPost(`${API}/auth/login`, { email: creds.email, password: creds.password });
  console.log('Login status:', login.status, JSON.stringify(login.body).slice(0, 200));

  // Look for token in various response shapes
  const b = login.body;
  const token =
    b?.data?.access_token ||
    b?.data?.token ||
    b?.access_token ||
    b?.token ||
    b?.data?.accessToken ||
    b?.accessToken ||
    (reg.body?.data?.access_token) ||
    (reg.body?.data?.token) ||
    (reg.body?.access_token) ||
    (reg.body?.token) ||
    null;

  if (!token) {
    console.warn('WARNING: Could not extract token from API response. Will proceed without auth injection.');
    console.warn('Full login body:', JSON.stringify(b, null, 2));
  }
  return token;
}

async function main() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const token = await getToken();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Inject token into localStorage / cookies on every page load
  if (token) {
    await context.addInitScript((t) => {
      localStorage.setItem('cf_token', t);
      // Also set common alternatives
      localStorage.setItem('token', t);
      localStorage.setItem('accessToken', t);
      localStorage.setItem('access_token', t);
    }, token);

    // Also set a cookie in case the app reads from there
    await context.addCookies([
      { name: 'cf_token', value: token, domain: 'localhost', path: '/' },
      { name: 'token',    value: token, domain: 'localhost', path: '/' },
    ]);
  }

  const results = [];

  for (const { route, file } of PAGES) {
    const url = `${BASE}${route}`;
    const outFile = path.join(OUT, file);
    const result = { route, file, loaded: false, content: 'unknown', errors: [], visual: 'unknown' };

    console.log(`\n→ ${url}`);

    const page = await context.newPage();
    const jsErrors = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') jsErrors.push(`[console.error] ${msg.text()}`);
    });

    try {
      // Navigate with a generous timeout; fall back to domcontentloaded if networkidle times out
      let navOk = false;
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 12000 });
        navOk = true;
      } catch {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
          await page.waitForTimeout(2000);
          navOk = true;
        } catch (e2) {
          result.errors.push(`Navigation failed: ${e2.message}`);
        }
      }

      if (navOk) {
        result.loaded = true;

        // Check if redirected to login
        const finalUrl = page.url();
        if (finalUrl.includes('/login') || finalUrl.includes('/auth')) {
          result.errors.push(`Redirected to: ${finalUrl}`);
          result.content = 'auth-redirect';
          result.visual = 'login page (not authenticated)';
        } else {
          // Assess content
          const bodyText = await page.evaluate(() => document.body?.innerText || '');
          const bodyLen  = bodyText.trim().length;
          const hasSpinner = await page.evaluate(() => {
            const el = document.querySelector('[class*="spinner"], [class*="loading"], [class*="skeleton"], [data-loading]');
            return !!el;
          });
          const hasMainContent = await page.evaluate(() => {
            const el = document.querySelector('main, [role="main"], .dashboard, [class*="page"], h1, h2');
            return !!el;
          });

          if (bodyLen < 100) {
            result.content = 'empty/near-empty';
            result.visual   = 'blank or minimal content';
          } else if (hasSpinner && bodyLen < 300) {
            result.content = 'loading-state';
            result.visual   = 'spinner/skeleton only';
          } else {
            result.content = 'has-content';
            result.visual   = hasMainContent ? 'looks populated' : 'content present, structure unclear';
          }
        }
      }

      await page.screenshot({ path: outFile, fullPage: false });
      console.log(`  ✓ screenshot → ${file} (${result.content})`);

    } catch (err) {
      result.errors.push(`Unexpected: ${err.message}`);
      // Try to take screenshot anyway
      try { await page.screenshot({ path: outFile }); } catch {}
      console.log(`  ✗ error: ${err.message}`);
    }

    result.errors.push(...jsErrors.slice(0, 3)); // cap at 3 JS errors per page
    results.push(result);
    await page.close();
  }

  await browser.close();

  // Write results summary
  const summaryPath = path.join(OUT, 'results.json');
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
  console.log(`\n\nSummary written to ${summaryPath}`);

  // Print table
  console.log('\n=== RESULTS ===');
  for (const r of results) {
    const errTag = r.errors.length ? ` | ERRORS: ${r.errors.join('; ')}` : '';
    console.log(`[${r.loaded ? 'OK' : 'FAIL'}] ${r.route.padEnd(20)} | ${r.content.padEnd(22)} | ${r.visual}${errTag}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
