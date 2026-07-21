/**
 * Playwright test: Projects page — delete & rename features
 * Run from: D:/project/creatorforce-ai/apps/e2e
 */
const { chromium } = require('@playwright/test');

const SHOTS_DIR = 'D:/project/creatorforce-ai/shots';
const API_BASE  = 'http://localhost:4007/api/v1';
const APP_BASE  = 'http://localhost:3007';

async function shot(page, name) {
  const path = `${SHOTS_DIR}/${name}`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  📸 ${name}`);
  return path;
}

async function main() {
  // ── Step 0: Login via API ────────────────────────────────────────────────────
  console.log('\n[0] Logging in via API...');
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ss-live-test@cf.io', password: 'TestPass123!' }),
  });
  if (!loginRes.ok) {
    const body = await loginRes.text();
    throw new Error(`Login failed ${loginRes.status}: ${body}`);
  }
  const loginData = await loginRes.json();
  const token = loginData.accessToken || loginData.data?.accessToken || loginData.token;
  if (!token) throw new Error(`No token in login response: ${JSON.stringify(loginData)}`);
  console.log(`  ✅ Token: ${token.slice(0, 20)}...`);

  // ── Step 1: Check existing projects ─────────────────────────────────────────
  console.log('\n[1] Checking existing projects...');
  const projRes = await fetch(`${API_BASE}/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const projBody = await projRes.json();
  let existingProjects = Array.isArray(projBody) ? projBody
    : Array.isArray(projBody.data) ? projBody.data
    : [];
  console.log(`  Found ${existingProjects.length} existing projects`);

  // ── Step 1b: Create test projects if fewer than 2 ────────────────────────────
  const projectsToCreate = [];
  if (existingProjects.length < 2) {
    const needed = 2 - existingProjects.length;
    const templates = [
      { title: 'Test Project Alpha', niche: 'Technology' },
      { title: 'Test Project Beta',  niche: 'Finance' },
    ];
    for (let i = 0; i < needed; i++) {
      projectsToCreate.push(templates[i]);
    }
  }

  for (const proj of projectsToCreate) {
    console.log(`  Creating project: ${proj.title}`);
    const createRes = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channelId: null, ...proj }),
    });
    if (!createRes.ok) {
      const body = await createRes.text();
      console.warn(`  ⚠️  Create failed ${createRes.status}: ${body}`);
    } else {
      const created = await createRes.json();
      console.log(`  ✅ Created: ${created.title || created.data?.title || JSON.stringify(created).slice(0, 60)}`);
    }
  }

  // Re-fetch project list
  const projRes2 = await fetch(`${API_BASE}/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const projBody2 = await projRes2.json();
  existingProjects = Array.isArray(projBody2) ? projBody2
    : Array.isArray(projBody2.data) ? projBody2.data
    : [];
  console.log(`  Total projects now: ${existingProjects.length}`);
  if (existingProjects.length === 0) {
    console.warn('  ⚠️  No projects available — UI will show empty state');
  }

  // ── Playwright setup ─────────────────────────────────────────────────────────
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Inject token into localStorage BEFORE any page load, to prevent auth redirect
  console.log('\n[auth] Injecting token into browser context...');
  await ctx.addInitScript((t) => {
    localStorage.setItem('cf_token', t);
  }, token);
  await ctx.addCookies([{
    name: 'cf_token',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: false,
    secure: false,
  }]);

  const page = await ctx.newPage();

  // Collect console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // ── Step 2: Navigate to /projects ───────────────────────────────────────────
  console.log('\n[2] Navigating to /projects...');
  await page.goto(`${APP_BASE}/projects`);
  await page.waitForTimeout(3000);
  await shot(page, 'test-del-01-projects-list.png');
  const cardCount = await page.locator('.group').count();
  console.log(`  Project cards on page: ${cardCount}`);

  if (cardCount === 0) {
    console.warn('  ⚠️  No project cards visible. Checking page content...');
    const bodyText = await page.locator('body').innerText();
    console.log('  Page text (first 400 chars):', bodyText.slice(0, 400));
    await browser.close();
    throw new Error('No project cards found — cannot test rename/delete');
  }

  // ── Step 3: Hover over first card, click ⋮ menu ─────────────────────────────
  console.log('\n[3] Testing ⋮ menu on first project card...');
  const firstCard = page.locator('.group').first();
  await firstCard.hover();
  await page.waitForTimeout(500);
  await shot(page, 'test-del-02-hover-menu.png');

  // The CardMenu button has aria-label="Project options"
  const menuBtn = firstCard.locator('[aria-label="Project options"]');
  await menuBtn.waitFor({ state: 'visible', timeout: 5000 });

  // Force-click (button is opacity-0 until hover, but visible in DOM)
  await menuBtn.click({ force: true });
  await page.waitForTimeout(400);
  await shot(page, 'test-del-03-menu-open.png');

  // Verify dropdown items
  const renameBtn = page.locator('button:has-text("Rename")').first();
  const deleteBtn = page.locator('button:has-text("Delete")').first();
  const renameVisible = await renameBtn.isVisible();
  const deleteVisible = await deleteBtn.isVisible();
  console.log(`  Rename option visible: ${renameVisible}`);
  console.log(`  Delete option visible: ${deleteVisible}`);

  // ── Step 4: Rename ──────────────────────────────────────────────────────────
  console.log('\n[4] Testing Rename...');
  // Get original title for reference
  const originalTitle = await firstCard.locator('h3').innerText().catch(() => '(unknown)');
  console.log(`  Original title: "${originalTitle}"`);

  await renameBtn.click();
  await page.waitForTimeout(500);
  await shot(page, 'test-del-04-rename-modal.png');

  // Check modal is open
  const renameModal = page.locator('text=Rename project');
  const renameModalVisible = await renameModal.isVisible();
  console.log(`  Rename modal visible: ${renameModalVisible}`);

  // Check the input is pre-filled
  const renameInput = page.locator('input[placeholder="Enter a title…"]');
  const inputValue = await renameInput.inputValue();
  console.log(`  Input pre-filled with: "${inputValue}"`);

  // Clear and type new name
  await renameInput.click({ clickCount: 3 });
  await renameInput.fill('Renamed Project Alpha');
  await page.waitForTimeout(200);

  // Click Save
  const saveBtn = page.locator('button:has-text("Save")').last();
  await saveBtn.click();
  await page.waitForTimeout(2000);
  await shot(page, 'test-del-05-after-rename.png');

  // Check if project card shows new name
  const newTitle = await page.locator('h3').first().innerText().catch(() => '');
  console.log(`  Project title after rename: "${newTitle}"`);
  const renameSuccess = newTitle.includes('Renamed Project Alpha');
  console.log(`  Rename success: ${renameSuccess}`);

  // ── Step 5: Delete second project ───────────────────────────────────────────
  console.log('\n[5] Testing Delete on second project...');
  const cards = page.locator('.group');
  const cardCountNow = await cards.count();
  console.log(`  Cards visible: ${cardCountNow}`);

  // Use second card if available, otherwise first
  const targetCard = cardCountNow >= 2 ? cards.nth(1) : cards.first();
  const deleteCardTitle = await targetCard.locator('h3').innerText().catch(() => '(unknown)');
  console.log(`  Deleting project: "${deleteCardTitle}"`);

  await targetCard.hover();
  await page.waitForTimeout(400);

  const deleteMenuBtn = targetCard.locator('[aria-label="Project options"]');
  await deleteMenuBtn.click({ force: true });
  await page.waitForTimeout(400);

  // Click Delete in dropdown
  const deleteDropdownBtn = page.locator('button:has-text("Delete")').first();
  await deleteDropdownBtn.click();
  await page.waitForTimeout(500);
  await shot(page, 'test-del-06-delete-modal.png');

  // Check delete modal
  const deleteModal = page.locator('text=Delete this project?');
  const deleteModalVisible = await deleteModal.isVisible();
  console.log(`  Delete confirmation modal visible: ${deleteModalVisible}`);

  // Check modal shows project name
  const modalText = await page.locator('.fixed.inset-0').last().innerText().catch(() => '');
  console.log(`  Modal text snippet: "${modalText.slice(0, 200)}"`);

  // Click the red Delete button in the modal footer
  // The modal has two buttons: Cancel and Delete — get the last "Delete" button (in modal)
  const confirmDeleteBtn = page.locator('button:has-text("Delete")').last();
  await confirmDeleteBtn.click();
  await page.waitForTimeout(2000);
  await shot(page, 'test-del-07-after-delete.png');

  const cardsAfterDelete = await page.locator('.group').count();
  console.log(`  Cards after delete: ${cardsAfterDelete} (was ${cardCountNow})`);
  const deleteSuccess = cardsAfterDelete < cardCountNow;
  console.log(`  Delete success: ${deleteSuccess}`);

  // ── Console errors summary ──────────────────────────────────────────────────
  console.log('\n[console errors]');
  if (consoleErrors.length === 0) {
    console.log('  None');
  } else {
    consoleErrors.forEach(e => console.log(`  ❌ ${e}`));
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n━━━ RESULTS ━━━');
  console.log(`Step 2 - Projects list loaded:  ${cardCount > 0 ? 'PASS' : 'FAIL'}`);
  console.log(`Step 3 - ⋮ menu appears:        ${renameVisible && deleteVisible ? 'PASS' : 'FAIL'}`);
  console.log(`Step 4 - Rename modal opens:    ${renameModalVisible ? 'PASS' : 'FAIL'}`);
  console.log(`Step 4 - Input pre-filled:      ${inputValue.length > 0 ? 'PASS' : 'FAIL'} ("${inputValue}")`);
  console.log(`Step 4 - Rename persists:       ${renameSuccess ? 'PASS' : 'FAIL'} ("${newTitle}")`);
  console.log(`Step 5 - Delete modal opens:    ${deleteModalVisible ? 'PASS' : 'FAIL'}`);
  console.log(`Step 5 - Project removed:       ${deleteSuccess ? 'PASS' : 'FAIL'}`);
  console.log(`Console errors:                 ${consoleErrors.length === 0 ? 'PASS (none)' : `FAIL (${consoleErrors.length})`}`);

  await browser.close();
}

main().catch(err => {
  console.error('\n❌ FATAL:', err.message);
  process.exit(1);
});
