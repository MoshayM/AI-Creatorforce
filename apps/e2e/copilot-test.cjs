// Copilot panel verification script — precise selectors from source
// Run with: node copilot-test.cjs
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');

const SHOTS_DIR = 'D:/project/creatorforce-ai/shots';
const BASE_URL = 'http://localhost:3007';
const API_URL = 'http://localhost:4007/api/v1';
const EMAIL = 'playwright-test-cf@example.com';
const PASSWORD = 'TestPass123!';

function shotPath(name) {
  return path.join(SHOTS_DIR, name);
}

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Login via API and get tokens
async function apiLogin(email, password) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ email, password });
    const options = {
      hostname: 'localhost',
      port: 4007,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Parse error: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

  // ── Get auth tokens first ──────────────────────────────────────────────────
  console.log('[0] Logging in via API to get tokens...');
  let tokens;
  try {
    tokens = await apiLogin(EMAIL, PASSWORD);
    console.log('[0] Login result keys:', Object.keys(tokens));
    if (!tokens.accessToken) {
      console.error('[0] No accessToken in response:', JSON.stringify(tokens).slice(0, 200));
      process.exit(1);
    }
    console.log('[0] Got accessToken');
  } catch (err) {
    console.error('[0] API login failed:', err.message);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  // Capture console errors and network failures
  const consoleErrors = [];
  const networkErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('requestfailed', req => networkErrors.push(`${req.method()} ${req.url()} → ${req.failure()?.errorText}`));

  try {
    // ── STEP 1: Inject auth tokens and navigate to dashboard ──────────────────
    console.log('[1] Injecting auth tokens via localStorage...');

    // First navigate to the app to establish the origin
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Inject tokens into localStorage (matching how the frontend stores them)
    await page.evaluate(({ accessToken, refreshToken }) => {
      localStorage.setItem('cf_access_token', accessToken);
      if (refreshToken) localStorage.setItem('cf_refresh_token', refreshToken);
    }, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });

    // Also set as cookie for httpOnly alternatives
    await context.addCookies([
      { name: 'cf_access_token', value: tokens.accessToken, domain: 'localhost', path: '/' },
    ]);

    // Navigate to dashboard
    console.log('[1] Navigating to /home');
    await page.goto(`${BASE_URL}/home`, { waitUntil: 'networkidle', timeout: 30000 });
    await wait(2000);
    await page.screenshot({ path: shotPath('cp-01-dashboard.png') });
    console.log('[1] URL:', page.url());

    // Check if we're on the dashboard or got redirected to login
    if (page.url().includes('/login')) {
      console.log('[1] Still on login — trying to log in via form with test user');
      await page.fill('input[type="email"], input[aria-label="Email"]', EMAIL);
      await page.fill('input[type="password"], input[aria-label="Password"]', PASSWORD);
      await page.screenshot({ path: shotPath('cp-01b-login-form.png') });
      await page.locator('button[type="submit"]').first().click();
      await wait(5000);
      await page.screenshot({ path: shotPath('cp-01c-after-submit.png') });
      console.log('[1] URL after form submit:', page.url());

      // If still on login, try navigating directly
      if (page.url().includes('/login')) {
        await page.goto(`${BASE_URL}/home`, { waitUntil: 'networkidle', timeout: 20000 });
        await wait(2000);
        await page.screenshot({ path: shotPath('cp-01d-home-direct.png') });
        console.log('[1] URL after direct nav:', page.url());
      }
    }

    const currentUrl = page.url();
    const onDash = !currentUrl.includes('/login');
    console.log('[1] On dashboard:', onDash, '| URL:', currentUrl);

    // ── STEP 2: Open Copilot panel ─────────────────────────────────────────────
    console.log('[2] Looking for Copilot button (title="Ask Copilot")...');
    const copilotBtn = page.locator('button[title="Ask Copilot"]').first();
    const btnVisible = await copilotBtn.isVisible().catch(() => false);
    console.log('[2] Button visible:', btnVisible);

    if (btnVisible) {
      await copilotBtn.click();
      console.log('[2] Clicked Ask Copilot button');
    } else {
      console.log('[2] Button not found by title, trying to dispatch cf:open-copilot event');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('cf:open-copilot')));
    }

    await wait(1500);
    await page.screenshot({ path: shotPath('cp-02-copilot-open.png') });

    // Verify the orb overlay appeared
    const overlayEl = await page.locator('div.fixed.inset-0.z-50').first();
    const overlayVisible = await overlayEl.isVisible().catch(() => false);
    console.log('[2] Overlay (fixed inset-0 z-50) visible:', overlayVisible);

    // Status badge
    const statusText = await page.locator('text=Copilot ready').first().textContent().catch(() => null);
    console.log('[2] Status badge text:', statusText);

    // ── STEP 3: STT badge ──────────────────────────────────────────────────────
    // Wait a moment for serverStt to resolve
    await wait(2000);
    await page.screenshot({ path: shotPath('cp-03-copilot-with-stt.png') });

    const sttBadge = await page.locator('text=/Server STT|Browser STT/').first().textContent().catch(() => null);
    console.log('[3] STT badge:', sttBadge ?? '(not visible yet - may still be checking)');

    // ── STEP 4: Click "Type a message" (MessageSquare) button ─────────────────
    console.log('[4] Clicking "Type a message" button...');
    const chatBtn = page.locator('button[title="Type a message"]').first();
    const chatBtnVisible = await chatBtn.isVisible().catch(() => false);
    console.log('[4] Chat button visible:', chatBtnVisible);

    if (chatBtnVisible) {
      await chatBtn.click();
      await wait(600);
      await page.screenshot({ path: shotPath('cp-04-chat-panel-open.png') });
      console.log('[4] Chat panel opened');
    } else {
      console.log('[4] Chat button NOT visible — panel may not be open. Retrying open...');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('cf:open-copilot')));
      await wait(1500);
      const chatBtn2 = page.locator('button[title="Type a message"]').first();
      if (await chatBtn2.isVisible().catch(() => false)) {
        await chatBtn2.click();
        await wait(600);
        await page.screenshot({ path: shotPath('cp-04-chat-panel-open.png') });
      } else {
        await page.screenshot({ path: shotPath('cp-04-no-chat-btn.png') });
        console.log('[4] Chat button still not visible');
      }
    }

    // ── STEP 5: Type and send "list my projects" ────────────────────────────────
    const inputSel = 'input[placeholder="Ask anything about your content…"]';
    const inputEl = page.locator(inputSel).first();
    const inputVisible = await inputEl.isVisible().catch(() => false);
    console.log('[5] Input visible:', inputVisible);

    if (inputVisible) {
      await inputEl.fill('list my projects');
      await page.screenshot({ path: shotPath('cp-05-typed-list-projects.png') });
      await page.keyboard.press('Enter');
      console.log('[5] Sent "list my projects" — waiting up to 15s for response...');

      // Wait for busy state (Processing… dot) to disappear
      await wait(15000);
      await page.screenshot({ path: shotPath('cp-06-response-list-projects.png') });

      // Capture response messages from the activity panel
      const msgTexts = await page.evaluate(() => {
        // Messages in agent activity panel have color rgba(255,255,255,.8)
        const all = document.querySelectorAll('div');
        const msgs = [];
        for (const d of all) {
          if (d.style.color === 'rgba(255,255,255,.8)' || d.style.color === 'rgba(255, 255, 255, 0.8)') {
            const t = d.textContent?.trim();
            if (t && t.length > 3) msgs.push(t);
          }
        }
        return msgs;
      });
      console.log('[5] Response messages:', msgTexts.length);
      msgTexts.forEach((m, i) => console.log(`  [msg ${i}]:`, m.substring(0, 150)));
    } else {
      console.log('[5] Input not found — check cp-04 screenshot for state');
    }

    // ── STEP 6: Task queue (Zap / lightning bolt) button ───────────────────────
    console.log('[6] Clicking Task queue button (title="Task queue")...');
    const zapBtn = page.locator('button[title="Task queue"]').first();
    const zapVisible = await zapBtn.isVisible().catch(() => false);
    console.log('[6] Task queue button visible:', zapVisible);

    if (zapVisible) {
      await zapBtn.click();
      await wait(2000); // wait for jobs to load
      await page.screenshot({ path: shotPath('cp-07-task-queue.png') });

      const noJobsText = await page.locator('text=No jobs yet').first().isVisible().catch(() => false);
      console.log('[6] "No jobs yet" shown:', noJobsText);

      const jobRows = await page.locator('div[style*="rgba(255,255,255,.05)"]').count();
      console.log('[6] Job row count:', jobRows);
    } else {
      console.log('[6] Task queue button not visible');
      await page.screenshot({ path: shotPath('cp-07-no-zapbtn.png') });
    }

    // ── STEP 7: Type "analyze my video and create shorts" ──────────────────────
    console.log('[7] Switching back to chat for second message...');

    // Click chat btn again (switching from jobs tab)
    const chatBtnAgain = page.locator('button[title="Type a message"]').first();
    if (await chatBtnAgain.isVisible().catch(() => false)) {
      await chatBtnAgain.click();
      await wait(400);
    }

    const input2Visible = await page.locator(inputSel).first().isVisible().catch(() => false);
    if (input2Visible) {
      await page.fill(inputSel, 'analyze my video and create shorts');
      await page.screenshot({ path: shotPath('cp-08-typed-shorts.png') });
      await page.keyboard.press('Enter');
      console.log('[7] Sent "analyze my video and create shorts" — waiting 15s...');
      await wait(15000);
      await page.screenshot({ path: shotPath('cp-09-shorts-response.png') });

      // Check for task plan card
      const planVisible = await page.locator('text=TASK PLAN').first().isVisible().catch(() => false);
      console.log('[7] TASK PLAN card visible:', planVisible);

      if (planVisible) {
        // Get all plan steps
        const planData = await page.evaluate(() => {
          const spans = Array.from(document.querySelectorAll('span'));
          const planSpan = spans.find(s => s.textContent?.trim() === 'TASK PLAN');
          if (!planSpan) return null;
          const container = planSpan.closest('div[style]');
          if (!container) return null;
          return {
            goal: container.querySelector('p')?.textContent?.trim(),
            steps: Array.from(container.querySelectorAll('span[style*="font-size: 12px"]'))
              .map(s => s.textContent?.trim())
              .filter(Boolean)
          };
        });
        console.log('[7] Plan data:', JSON.stringify(planData, null, 2));
      }

      // Scroll down to see full response
      await page.evaluate(() => {
        document.querySelectorAll('[style*="overflow"]').forEach(el => {
          el.scrollTop = el.scrollHeight;
        });
      });
      await wait(300);
      await page.screenshot({ path: shotPath('cp-10-shorts-scrolled.png') });
    } else {
      console.log('[7] Input not available for second message');
    }

    // ── FINAL: full-panel capture ──────────────────────────────────────────────
    await page.screenshot({ path: shotPath('cp-11-final.png') });
    console.log('\n[done] All screenshots saved to', SHOTS_DIR);

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    console.log('\n=== SUMMARY ===');
    const relevantErrors = consoleErrors.filter(e => !e.includes('hydration') && !e.includes('caret-color'));
    console.log('Console errors (excl. hydration):', relevantErrors.length ? relevantErrors : 'none');
    console.log('Network errors:', networkErrors.filter(e => !e.includes('ERR_ABORTED')).slice(0, 5));

  } catch (err) {
    console.error('[FATAL ERROR]', err.message);
    console.error(err.stack?.split('\n').slice(0, 8).join('\n'));
    await page.screenshot({ path: shotPath('cp-fatal-error.png') }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
