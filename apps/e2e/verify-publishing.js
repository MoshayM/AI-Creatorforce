// Playwright script to screenshot /publishing after auth
const { chromium } = require('@playwright/test');
const https = require('https');
const http = require('http');

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  // Step 1: get token
  let token;
  console.log('Attempting register...');
  const reg = await post('http://localhost:4007/api/v1/auth/register', {
    name: 'Test',
    email: 'ss-live-test@cf.io',
    password: 'TestPass123!'
  });
  console.log('Register response:', reg.status, JSON.stringify(reg.body).slice(0, 300));

  if (reg.status === 201 || reg.status === 200) {
    token = reg.body?.data?.accessToken || reg.body?.accessToken || reg.body?.token;
  } else {
    console.log('Register failed or user exists, trying login...');
    const login = await post('http://localhost:4007/api/v1/auth/login', {
      email: 'ss-live-test@cf.io',
      password: 'TestPass123!'
    });
    console.log('Login response:', login.status, JSON.stringify(login.body).slice(0, 300));
    token = login.body?.data?.accessToken || login.body?.accessToken || login.body?.token;
  }

  if (!token) {
    console.error('ERROR: Could not obtain token. Full responses above.');
    process.exit(1);
  }
  console.log('Got token:', token.slice(0, 20) + '...');

  // Step 2-5: Browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  // Collect console errors
  const consoleErrors = [];
  const page = await context.newPage();
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[ERROR] ${msg.text()}`);
    }
    if (msg.type() === 'warning') {
      consoleErrors.push(`[WARN] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    consoleErrors.push(`[PAGE ERROR] ${err.message}`);
  });

  // Navigate to root first to set storage
  console.log('Navigating to http://localhost:3007 ...');
  await page.goto('http://localhost:3007', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Inject token into localStorage and cookie
  await page.evaluate((tok) => {
    localStorage.setItem('cf_token', tok);
    // Also try common key variants
    localStorage.setItem('token', tok);
    localStorage.setItem('accessToken', tok);
    localStorage.setItem('auth_token', tok);
  }, token);

  await context.addCookies([
    {
      name: 'cf_token',
      value: token,
      domain: 'localhost',
      path: '/',
    }
  ]);

  console.log('Navigating to /publishing ...');
  await page.goto('http://localhost:3007/publishing', { waitUntil: 'networkidle', timeout: 30000 });

  // Wait 4 seconds for API calls to settle
  console.log('Waiting 4 seconds...');
  await page.waitForTimeout(4000);

  const finalUrl = page.url();
  console.log('Final URL after navigation:', finalUrl);

  // Full page screenshot
  const outPath = 'D:/project/creatorforce-ai/shots/live-publishing.png';
  await page.screenshot({ path: outPath, fullPage: true });
  console.log('Screenshot saved to:', outPath);

  // Report console errors
  if (consoleErrors.length === 0) {
    console.log('No JavaScript errors in browser console.');
  } else {
    console.log('\n=== Browser Console Errors/Warnings ===');
    consoleErrors.forEach(e => console.log(e));
  }

  await browser.close();
  console.log('Done.');
})();
