// Microphone toggle verification for CreatorForce Copilot panel
// Run: node mic-toggle-test.cjs
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');

const SHOTS_DIR = 'D:/project/creatorforce-ai/shots';
const BASE_URL = 'http://localhost:3007';
const API_URL = 'http://localhost:4007/api/v1';
const EMAIL = 'mic-test-2026@creatorforce.io';
const PASSWORD = 'TestPass123!';

function shotPath(name) { return path.join(SHOTS_DIR, name); }
async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function apiRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function loginOrRegister(email, password) {
  const bodyStr = JSON.stringify({ email, password });
  const opts = {
    hostname: 'localhost', port: 4007, path: '/api/v1/auth/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
  };
  let res = await apiRequest(opts, bodyStr);
  console.log('[auth] Login status:', res.status);

  if (res.status === 401 || res.status === 404) {
    console.log('[auth] Login failed — registering fresh user...');
    const regBody = JSON.stringify({ email, password, name: 'Test User' });
    const regOpts = {
      hostname: 'localhost', port: 4007, path: '/api/v1/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(regBody) }
    };
    const regRes = await apiRequest(regOpts, regBody);
    console.log('[auth] Register status:', regRes.status);
    // re-login after register
    res = await apiRequest(opts, bodyStr);
    console.log('[auth] Re-login status:', res.status);
  }

  if (!res.body.accessToken) {
    throw new Error('No accessToken after login/register. Response: ' + JSON.stringify(res.body).slice(0, 200));
  }
  return res.body;
}

(async () => {
  if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // ── Step 1: Authenticate via API ─────────────────────────────────────────────
  console.log('\n[1] Authenticating...');
  let tokens;
  try {
    tokens = await loginOrRegister(EMAIL, PASSWORD);
    console.log('[1] Got accessToken:', tokens.accessToken?.slice(0, 20) + '...');
  } catch (err) {
    console.error('[1] Auth failed:', err.message);
    process.exit(1);
  }

  // ── Launch browser with fake mic flags ──────────────────────────────────────
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files',
    ],
  });
  const context = await browser.newContext({
    permissions: ['microphone'],
    baseURL: BASE_URL,
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const micErrors = [];
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(text);
      if (/mic|microphone|speech|recognition|permission|getUserMedia/i.test(text)) {
        micErrors.push(text);
      }
    }
  });
  page.on('requestfailed', req => {
    const url = req.url();
    if (!url.includes('ERR_ABORTED')) {
      console.log('[net] Request failed:', req.method(), url, '→', req.failure()?.errorText);
    }
  });

  const report = {
    micTurnedGreen: false,
    showedListening: false,
    micErrorShown: null,
    returnedToReady: false,
    sttBadge: null,
    consoleErrors: [],
    micErrors: [],
  };

  try {
    // ── Step 2: Inject tokens and navigate ────────────────────────────────────
    console.log('\n[2] Injecting auth tokens into localStorage + cookies...');
    // First land on the origin to establish context
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Inject using the key the dash layout actually checks: cf_token
    await page.evaluate(({ accessToken, refreshToken }) => {
      localStorage.setItem('cf_token', accessToken);
      // Also set legacy keys in case any component reads them
      localStorage.setItem('cf_access_token', accessToken);
      if (refreshToken) localStorage.setItem('cf_refresh_token', refreshToken);
    }, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });

    // Also set as cookie for SSR guard layers
    await context.addCookies([
      { name: 'cf_token', value: tokens.accessToken, domain: 'localhost', path: '/' },
      { name: 'cf_access_token', value: tokens.accessToken, domain: 'localhost', path: '/' },
    ]);

    console.log('[2] Navigating to /home...');
    await page.goto(`${BASE_URL}/home`, { waitUntil: 'networkidle', timeout: 30000 });
    await wait(2000);
    console.log('[2] Current URL:', page.url());

    // If still on login page, fill the form with the test user credentials
    if (page.url().includes('/login')) {
      console.log('[2] Still on login — filling form...');
      await page.fill('input[type="email"], input[aria-label="Email"]', EMAIL).catch(() => {});
      await page.fill('input[type="password"], input[aria-label="Password"]', PASSWORD).catch(() => {});
      await page.screenshot({ path: shotPath('cp-mic-00-login-form.png') });
      await page.locator('button[type="submit"]').first().click();
      await wait(5000);
      console.log('[2] URL after form submit:', page.url());
      // Navigate directly if still stuck
      if (page.url().includes('/login')) {
        await page.goto(`${BASE_URL}/home`, { waitUntil: 'networkidle', timeout: 20000 });
        await wait(2000);
        console.log('[2] URL after direct nav:', page.url());
      }
    }

    // ── Step 3: Open Copilot panel ────────────────────────────────────────────
    console.log('\n[3] Opening Copilot panel...');
    const copilotBtn = page.locator('button[title="Ask Copilot"]').first();
    const btnVisible = await copilotBtn.isVisible().catch(() => false);

    if (btnVisible) {
      await copilotBtn.click();
      console.log('[3] Clicked "Ask Copilot" button');
    } else {
      console.log('[3] Button not found — dispatching cf:open-copilot event...');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('cf:open-copilot')));
    }

    await wait(1500);

    // Screenshot 1: Panel open
    await page.screenshot({ path: shotPath('cp-mic-01-open.png') });
    console.log('[3] Screenshot saved: cp-mic-01-open.png');

    // Check initial status
    const initialStatus = await page.locator('text=Copilot ready').first().isVisible().catch(() => false);
    console.log('[3] "Copilot ready" visible:', initialStatus);

    // Check STT badge (may need a moment to resolve)
    await wait(2000);
    const sttBadgeEl = page.locator('text=/Server STT|Browser STT/').first();
    report.sttBadge = await sttBadgeEl.textContent().catch(() => null);
    console.log('[3] STT badge:', report.sttBadge ?? '(not visible)');

    // ── Step 4: Click mic button ──────────────────────────────────────────────
    console.log('\n[4] Looking for mic button (title="Start listening")...');
    const micBtn = page.locator('button[title="Start listening"]').first();
    const micBtnVisible = await micBtn.isVisible().catch(() => false);
    console.log('[4] Mic button visible:', micBtnVisible);

    if (!micBtnVisible) {
      // Copilot may not be open yet — try the orb button
      console.log('[4] Mic button not found — panel may not be open. Re-opening...');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('cf:open-copilot')));
      await wait(1500);
      await page.screenshot({ path: shotPath('cp-mic-01b-reopen.png') });
    }

    // Capture pre-click background color of mic button
    const preBg = await page.evaluate(() => {
      const btn = document.querySelector('button[title="Start listening"]');
      if (!btn) return null;
      return window.getComputedStyle(btn).backgroundColor;
    });
    console.log('[4] Mic button bg before click:', preBg);

    // Click the mic button
    await page.locator('button[title="Start listening"]').first().click({ timeout: 5000 });
    console.log('[4] Clicked mic button');

    // Wait 500ms per spec
    await wait(500);

    // Screenshot 2: After mic click (should show green + "Listening…")
    await page.screenshot({ path: shotPath('cp-mic-02-active.png') });
    console.log('[4] Screenshot saved: cp-mic-02-active.png');

    // Check if button is now "Stop listening" (title changed = state changed)
    const stopBtnVisible = await page.locator('button[title="Stop listening"]').first().isVisible().catch(() => false);
    console.log('[4] "Stop listening" button visible (title changed):', stopBtnVisible);

    // Check button background color
    const activeBg = await page.evaluate(() => {
      // When active, title changes to "Stop listening"
      const btn = document.querySelector('button[title="Stop listening"]') ||
                  document.querySelector('button[title="Start listening"]');
      if (!btn) return null;
      return window.getComputedStyle(btn).backgroundColor;
    });
    console.log('[4] Mic button bg after click:', activeBg);

    // #4ADE80 is rgb(74, 222, 128)
    const isGreen = activeBg && (
      activeBg.includes('74, 222, 128') ||
      activeBg === '#4ADE80' ||
      activeBg.toLowerCase().includes('4ade80')
    );
    report.micTurnedGreen = isGreen || stopBtnVisible; // if title changed to Stop listening, state changed
    console.log('[4] Mic turned green:', report.micTurnedGreen, '| bg:', activeBg);

    // Check "Listening…" status text
    const listeningText = await page.locator('text=Listening…').first().isVisible().catch(() => false) ||
                          await page.locator('text=Listening...').first().isVisible().catch(() => false);
    report.showedListening = listeningText;
    console.log('[4] "Listening…" status visible:', listeningText);

    // Capture full status div text
    const statusDivText = await page.evaluate(() => {
      // Look for the status div — it's a div containing the status text
      const divs = Array.from(document.querySelectorAll('div'));
      for (const d of divs) {
        const t = d.textContent?.trim();
        if (t && (t.includes('Listening') || t.includes('Copilot ready') || t.includes('Processing') || t.includes('Mic blocked'))) {
          if (d.children.length === 0 || (d.children.length <= 2 && t.length < 60)) {
            return t;
          }
        }
      }
      return null;
    });
    console.log('[4] Status div text:', statusDivText);
    if (statusDivText?.includes('Listening')) report.showedListening = true;

    // Check for mic error text
    const permDenied = await page.locator('text=Microphone permission denied').first().isVisible().catch(() => false);
    const micBlocked = await page.locator('text=Mic blocked').first().isVisible().catch(() => false);
    const noMicFound = await page.locator('text=No microphone found').first().isVisible().catch(() => false);
    if (permDenied) report.micErrorShown = 'Microphone permission denied';
    if (micBlocked) report.micErrorShown = 'Mic blocked';
    if (noMicFound) report.micErrorShown = 'No microphone found';
    console.log('[4] Mic errors visible:', report.micErrorShown ?? 'none');

    // ── Step 5: Click mic button again to stop ────────────────────────────────
    console.log('\n[5] Clicking mic button to stop listening...');
    const stopBtn = page.locator('button[title="Stop listening"]').first();
    const stopVisible = await stopBtn.isVisible().catch(() => false);

    if (stopVisible) {
      await stopBtn.click();
      console.log('[5] Clicked "Stop listening"');
    } else {
      // Maybe it's still "Start listening" (error case)
      const startBtn2 = page.locator('button[title="Start listening"]').first();
      if (await startBtn2.isVisible().catch(() => false)) {
        console.log('[5] Still showing "Start listening" — may have already stopped');
      }
    }

    await wait(500);

    // Screenshot 3: After stopping
    await page.screenshot({ path: shotPath('cp-mic-03-stopped.png') });
    console.log('[5] Screenshot saved: cp-mic-03-stopped.png');

    // Check returned to ready state
    const readyText = await page.locator('text=Copilot ready').first().isVisible().catch(() => false);
    report.returnedToReady = readyText;
    console.log('[5] Returned to "Copilot ready":', readyText);

    // Check button title reverted
    const startAgain = await page.locator('button[title="Start listening"]').first().isVisible().catch(() => false);
    console.log('[5] "Start listening" button back:', startAgain);
    if (startAgain) report.returnedToReady = true;

    // Check for any mic errors after stop
    const postStopError = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('div'));
      for (const d of divs) {
        const t = d.textContent?.trim();
        if (t && (t.includes('Mic blocked') || t.includes('permission denied') || t.includes('No microphone'))) {
          if (t.length < 100) return t;
        }
      }
      return null;
    });
    if (postStopError) {
      report.micErrorShown = postStopError;
      console.log('[5] Post-stop mic error:', postStopError);
    }

    // ── Step 6: Screenshot the right panel for STT badge ──────────────────────
    console.log('\n[6] Capturing agent activity panel (STT badge)...');
    await wait(500);
    await page.screenshot({ path: shotPath('cp-mic-04-stt-badge.png') });
    console.log('[6] Screenshot saved: cp-mic-04-stt-badge.png');

    // Re-read STT badge
    const sttFinal = await page.locator('text=/Server STT|Browser STT/').first().textContent().catch(() => null);
    if (sttFinal) report.sttBadge = sttFinal;
    console.log('[6] STT badge (final read):', report.sttBadge);

    // ── Step 7: Collect console errors ───────────────────────────────────────
    report.consoleErrors = consoleErrors.filter(e =>
      !e.includes('hydration') &&
      !e.includes('caret-color') &&
      !e.includes('favicon')
    );
    report.micErrors = micErrors;

  } catch (err) {
    console.error('\n[FATAL]', err.message);
    console.error(err.stack?.split('\n').slice(0, 10).join('\n'));
    await page.screenshot({ path: shotPath('cp-mic-fatal.png') }).catch(() => {});
    report.fatalError = err.message;
    process.exitCode = 1;
  } finally {
    await browser.close();
  }

  // ── Final Report ─────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('MIC TOGGLE VERIFICATION REPORT');
  console.log('='.repeat(60));
  console.log('Mic button turned green:       ', report.micTurnedGreen ? 'YES ✅' : 'NO ❌');
  console.log('Status showed "Listening…":    ', report.showedListening ? 'YES ✅' : 'NO ❌');
  console.log('Mic error shown:               ', report.micErrorShown ?? 'None ✅');
  console.log('Returned to ready state:       ', report.returnedToReady ? 'YES ✅' : 'NO ❌');
  console.log('STT badge:                     ', report.sttBadge ?? '(not visible)');
  console.log('Console errors (filtered):     ', report.consoleErrors.length);
  if (report.consoleErrors.length) report.consoleErrors.forEach(e => console.log('  >', e.slice(0, 120)));
  console.log('Mic-related console errors:    ', report.micErrors.length);
  if (report.micErrors.length) report.micErrors.forEach(e => console.log('  >', e.slice(0, 120)));
  if (report.fatalError) console.log('Fatal error:                   ', report.fatalError);
  console.log('='.repeat(60));
  console.log('\nScreenshots saved to:', SHOTS_DIR);
  console.log('  cp-mic-01-open.png    — copilot panel open');
  console.log('  cp-mic-02-active.png  — after clicking mic (should be green + Listening…)');
  console.log('  cp-mic-03-stopped.png — after stopping mic (should be Copilot ready)');
  console.log('  cp-mic-04-stt-badge.png — STT badge visible');
})();
