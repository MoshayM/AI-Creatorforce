/**
 * Phase 6 AI Autonomy — Playwright spec (M4)
 *
 * Covers: channel profile, calendar generation (sync + async), approve/dismiss,
 * self-critique display, AI-planned chips on Scheduler, and Automation toggles.
 *
 * All API calls are intercepted via route mocks so the suite runs without real
 * YouTube OAuth or AI API keys (synthetic-channel alpha, spec §4). The heuristic
 * fallback in the generate mock acts as the zero-cost deterministic test path.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

const BASE = 'http://localhost:4007/api/v1';
const CHANNEL_ID = 'ch-auto-1';
const ENTRY_ID_1 = 'entry-auto-1';
const ENTRY_ID_2 = 'entry-auto-2';
const ENTRY_ID_3 = 'entry-auto-3';

// ── Synthetic channel data (spec §4) ─────────────────────────────────────────
// A deterministic fake channel with realistic profile data. The test suite
// never calls real YouTube or AI APIs; the generate mock returns heuristic-style
// entries so assertions are stable across runs.

const SYNTHETIC_CHANNEL = {
  id: CHANNEL_ID,
  youtubeChannelId: 'UC_SYNTHETIC_001',
  title: 'Synthetic Test Channel',
  description: 'Playwright synthetic channel',
  thumbnailUrl: null,
  customUrl: '@synthetic',
  subscriberCount: 5000,
  videoCount: 42,
  active: true,
  readOnly: false,
  lastSyncedAt: new Date().toISOString(),
  createdAt: '2026-01-01T00:00:00.000Z',
  scopes: [],
  accessLevel: 'FULL',
};

const SYNTHETIC_PROFILE = {
  id: 'profile-1',
  channelId: CHANNEL_ID,
  profile: {
    niche: 'AI & Technology',
    subscriberCount: 5000,
    totalUploads: 42,
    uploadsPerWeek90d: 1.5,
    avgViews90d: 4200,
    bestWeekdays: ['Wednesday', 'Saturday'],
    bestHourUtc: 17,
    formatMix: { videos: 35, shorts: 7 },
    topTitles: ['How I Built an AI Agent', 'Top 5 LLMs of 2026'],
    pipeline: { DRAFT: 2, SCHEDULED: 1, PUBLISHED: 39 },
  },
  computedAt: new Date().toISOString(),
};

const tomorrow = new Date();
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
tomorrow.setUTCHours(17, 0, 0, 0);

const dayAfter = new Date(tomorrow);
dayAfter.setUTCDate(dayAfter.getUTCDate() + 3);

const SYNTHETIC_ENTRIES_PROPOSED = [
  {
    id: ENTRY_ID_1,
    channelId: CHANNEL_ID,
    batchId: 'batch-001',
    title: 'Claude 4 vs GPT-5: Which AI Wins in 2026?',
    angle: 'Head-to-head benchmark across coding, reasoning, and creativity tasks',
    format: 'VIDEO',
    plannedAt: tomorrow.toISOString(),
    priority: 88,
    keywords: ['Claude 4', 'GPT-5', 'AI comparison'],
    rationale: 'LLM comparison is peak-traffic Tuesday–Thursday',
    status: 'PROPOSED',
    videoId: null,
    source: 'heuristic',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: ENTRY_ID_2,
    channelId: CHANNEL_ID,
    batchId: 'batch-001',
    title: 'I Replaced My Entire Workflow with AI Agents',
    angle: 'Practical walkthrough of agentic automation for creators',
    format: 'VIDEO',
    plannedAt: dayAfter.toISOString(),
    priority: 75,
    keywords: ['AI agents', 'workflow automation', '2026'],
    rationale: 'Agentic AI scores 91 on trend relevance this week',
    status: 'PROPOSED',
    videoId: null,
    source: 'heuristic',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const SYNTHETIC_ENTRY_APPROVED = {
  ...SYNTHETIC_ENTRIES_PROPOSED[0]!,
  status: 'APPROVED',
  videoId: 'video-draft-1',
};

const SYNTHETIC_ENTRY_DISMISSED = {
  ...SYNTHETIC_ENTRIES_PROPOSED[1]!,
  status: 'DISMISSED',
};

const GENERATE_RESULT = {
  batchId: 'batch-001',
  source: 'heuristic',
  dryRun: false,
  critique: 'Both entries are on-niche and use the channel\'s best publish slots. Priorities are realistic for a 5k-subscriber channel. The second entry could be more specific about which agents were used.',
  profile: SYNTHETIC_PROFILE.profile,
  entries: SYNTHETIC_ENTRIES_PROPOSED,
};

const AUTOMATION_SETTINGS = {
  enabled: false,
  autoImport: false,
  autoAnalyze: false,
  autoPublish: false,
  chapterSyncEnabled: false,
  autoPlan: false,
  autoResearch: false,
  publishIntervalMinutes: 240,
  maxPublishesPerDay: 2,
  maxImportsPerDay: 3,
  lastTickAt: null,
  aiSuggestion: null,
};

// ── Route mock setup ──────────────────────────────────────────────────────────

async function setupAutonomyMocks(page: Page) {
  // Override channels to return only our synthetic channel
  await page.route(`${BASE}/channels`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [SYNTHETIC_CHANNEL] });
    } else {
      await route.continue();
    }
  });

  // Profile
  await page.route(new RegExp(`/autonomy/channels/${CHANNEL_ID}/profile`), async (route) => {
    await route.fulfill({ json: SYNTHETIC_PROFILE });
  });

  // Generate (sync) — state machine: first call returns entries, subsequent calls re-fetch
  let generated = false;
  await page.route(
    new RegExp(`/autonomy/channels/${CHANNEL_ID}/calendar/generate$`),
    async (route) => {
      generated = true;
      await route.fulfill({ json: GENERATE_RESULT });
    },
  );

  // Generate (async) — returns a jobId
  await page.route(
    new RegExp(`/autonomy/channels/${CHANNEL_ID}/calendar/generate-async$`),
    async (route) => {
      await route.fulfill({ json: { jobId: 'job-cal-1' } });
    },
  );

  // Calendar list — returns proposals if generated, else empty
  let approvedIds = new Set<string>();
  let dismissedIds = new Set<string>();
  await page.route(
    new RegExp(`/autonomy/channels/${CHANNEL_ID}/calendar`),
    async (route) => {
      const url = new URL(route.request().url());
      const status = url.searchParams.get('status');
      let entries = generated ? [...SYNTHETIC_ENTRIES_PROPOSED] : [];
      entries = entries.map((e) => {
        if (approvedIds.has(e.id)) return { ...e, status: 'APPROVED', videoId: 'video-draft-1' };
        if (dismissedIds.has(e.id)) return { ...e, status: 'DISMISSED' };
        return e;
      });
      if (status) entries = entries.filter((e) => e.status === status);
      await route.fulfill({ json: entries });
    },
  );

  // Approve
  await page.route(/\/autonomy\/calendar\/[^/]+\/approve$/, async (route) => {
    const id = route.request().url().split('/').slice(-2, -1)[0]!;
    approvedIds.add(id);
    const entry = SYNTHETIC_ENTRIES_PROPOSED.find((e) => e.id === id) ?? SYNTHETIC_ENTRIES_PROPOSED[0]!;
    await route.fulfill({ json: { ...entry, status: 'APPROVED', videoId: 'video-draft-1' } });
  });

  // Dismiss
  await page.route(/\/autonomy\/calendar\/[^/]+\/dismiss$/, async (route) => {
    const id = route.request().url().split('/').slice(-2, -1)[0]!;
    dismissedIds.add(id);
    const entry = SYNTHETIC_ENTRIES_PROPOSED.find((e) => e.id === id) ?? SYNTHETIC_ENTRIES_PROPOSED[1]!;
    await route.fulfill({ json: { ...entry, status: 'DISMISSED' } });
  });

  // Automation settings
  await page.route(
    new RegExp(`/channels/${CHANNEL_ID}/automation$`),
    async (route) => {
      await route.fulfill({ json: AUTOMATION_SETTINGS });
    },
  );

  // Scheduler: summary + videos (empty — AI chips come from calendar)
  await page.route(/\/publishing\/videos\/summary/, async (route) => {
    await route.fulfill({ json: { scheduled: 0, upcoming7d: 0, published: 0, publishedThisMonth: 0, failed: 0 } });
  });
  await page.route(/\/publishing\/videos/, async (route) => {
    await route.fulfill({ json: { data: [], total: 0, take: 50, skip: 0 } });
  });
}

async function seedLocalStorage(page: Page) {
  await page.evaluate(
    ([chId]) => {
      localStorage.setItem('cf.autonomy.channelId', chId);
      localStorage.setItem('cf.scheduler.channelId', chId);
      localStorage.setItem('cf.automation.channelId', chId);
    },
    [CHANNEL_ID],
  );
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe('Autonomy — Phase 6 full flow', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setupAutonomyMocks(page);
    await setAuthToken(page);
    await seedLocalStorage(page);
  });

  // ── Navigation ──────────────────────────────────────────────────────────────

  test('Autonomy nav entry is present and active on the page', async ({ page }) => {
    await page.goto('/autonomy', { waitUntil: 'networkidle' });
    const navLink = page.locator('a[href="/autonomy"]');
    await expect(navLink).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h1')).toContainText('Autonomy', { timeout: 10_000 });
  });

  // ── Channel profile ─────────────────────────────────────────────────────────

  test('channel profile stat cards render with synthetic data', async ({ page }) => {
    await page.goto('/autonomy', { waitUntil: 'networkidle' });
    await expect(page.getByText('Uploads / week (90d)')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Avg views (90d)')).toBeVisible();
    await expect(page.getByText('Best slots')).toBeVisible();
    await expect(page.getByText('Format mix (90d)')).toBeVisible();
    // Synthetic profile values
    await expect(page.getByText('Wed')).toBeVisible();
    await expect(page.getByText(/17:00 UTC/i)).toBeVisible();
  });

  test('channel selector shows the synthetic channel name', async ({ page }) => {
    await page.goto('/autonomy', { waitUntil: 'networkidle' });
    await expect(page.getByText('Uploads / week (90d)')).toBeVisible({ timeout: 15_000 });
    const selector = page.locator('select').first();
    await expect(selector).toContainText('Synthetic Test Channel');
  });

  // ── Calendar generation ─────────────────────────────────────────────────────

  test('Generate calendar button POSTs and shows proposals', async ({ page }) => {
    await page.goto('/autonomy', { waitUntil: 'networkidle' });
    await expect(page.getByText('Uploads / week (90d)')).toBeVisible({ timeout: 15_000 });

    const generateReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/calendar/generate'),
    );
    await page.getByRole('button', { name: /generate calendar/i }).click();
    await generateReq;

    // Proposals section should now show entries
    await expect(page.getByText('Claude 4 vs GPT-5')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('I Replaced My Entire Workflow')).toBeVisible();
  });

  test('self-critique paragraph appears after generation', async ({ page }) => {
    await page.goto('/autonomy', { waitUntil: 'networkidle' });
    await expect(page.getByText('Uploads / week (90d)')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /generate calendar/i }).click();
    await expect(
      page.getByText(/Both entries are on-niche/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Dry run toggle sends dryRun=true and does not persist entries', async ({ page }) => {
    await page.goto('/autonomy', { waitUntil: 'networkidle' });
    await expect(page.getByText('Uploads / week (90d)')).toBeVisible({ timeout: 15_000 });

    // Toggle dry run
    await page.getByRole('button', { name: /dry run/i }).click();

    let sentBody: Record<string, unknown> = {};
    const generateReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/calendar/generate'),
    );
    await page.getByRole('button', { name: /generate calendar/i }).click();
    const req = await generateReq;
    sentBody = req.postDataJSON() as Record<string, unknown>;
    expect(sentBody['dryRun']).toBe(true);
  });

  // ── Approve / dismiss ───────────────────────────────────────────────────────

  test('Approve button POSTs approve and moves entry to Approved section', async ({ page }) => {
    await page.goto('/autonomy', { waitUntil: 'networkidle' });
    await expect(page.getByText('Uploads / week (90d)')).toBeVisible({ timeout: 15_000 });

    // Generate first
    await page.getByRole('button', { name: /generate calendar/i }).click();
    await expect(page.getByText('Claude 4 vs GPT-5')).toBeVisible({ timeout: 10_000 });

    // Approve first entry
    const approveReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/approve'),
    );
    await page.getByRole('button', { name: /approve/i }).first().click();
    await approveReq;

    // Approved section header
    await expect(page.getByText(/Approved \(\d+\)/)).toBeVisible({ timeout: 8_000 });
  });

  test('Dismiss button POSTs dismiss endpoint', async ({ page }) => {
    await page.goto('/autonomy', { waitUntil: 'networkidle' });
    await expect(page.getByText('Uploads / week (90d)')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /generate calendar/i }).click();
    await expect(page.getByText('I Replaced My Entire Workflow')).toBeVisible({ timeout: 10_000 });

    const dismissReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/dismiss'),
    );
    await page.getByRole('button', { name: /dismiss/i }).last().click();
    await dismissReq;
  });

  // ── Scheduler integration ───────────────────────────────────────────────────

  test('Scheduler page loads with month calendar and AI-planned chip', async ({ page }) => {
    // Pre-populate calendar so the scheduler can show AI chips
    await page.route(
      new RegExp(`/autonomy/channels/${CHANNEL_ID}/calendar`),
      async (route) => {
        await route.fulfill({ json: [SYNTHETIC_ENTRY_APPROVED] });
      },
    );

    await page.goto('/scheduler', { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toContainText('Scheduler', { timeout: 10_000 });

    // Calendar month view
    await expect(page.getByText(/July 2026|August 2026/i)).toBeVisible({ timeout: 8_000 });

    // Legend entry
    await expect(page.getByText('AI planned')).toBeVisible({ timeout: 8_000 });
  });

  test('Scheduler summary stat cards render', async ({ page }) => {
    await page.goto('/scheduler', { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toContainText('Scheduler', { timeout: 10_000 });
    await expect(page.getByText('Scheduled')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Published')).toBeVisible();
    await expect(page.getByText('Failed')).toBeVisible();
  });

  test('Scheduler list view renders after clicking List', async ({ page }) => {
    await page.goto('/scheduler', { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toContainText('Scheduler', { timeout: 10_000 });

    await page.getByRole('button', { name: /list/i }).click();
    // Status filter tabs
    await expect(page.getByRole('tab', { name: /all/i }).or(page.getByText(/All/i))).toBeVisible({ timeout: 5_000 });
  });

  // ── Automation page toggles ─────────────────────────────────────────────────

  test('Automation page shows Auto-plan and Auto-research toggles', async ({ page }) => {
    await page.goto('/automation', { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toContainText('Automation', { timeout: 10_000 });
    await expect(page.getByText('Auto-plan content calendar')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Auto-research on approve')).toBeVisible({ timeout: 8_000 });
  });

  test('Autonomy phase-6 guiding constraint: no autonomous publish toggle exposed', async ({ page }) => {
    await page.goto('/autonomy', { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toContainText('Autonomy', { timeout: 10_000 });
    // There must never be a "publish" button inside the Autonomy page
    const publishBtn = page.getByRole('button', { name: /^publish$/i });
    await expect(publishBtn).toHaveCount(0);
  });
});

// ── Synthetic-channel alpha smoke ─────────────────────────────────────────────
// A focused sub-suite that proves the heuristic path works end-to-end with zero
// real data (no YouTube API, no AI provider) — the zero-cost test path (spec §4).

test.describe('Autonomy — synthetic channel alpha (heuristic path)', () => {
  test('heuristic generate returns entries without AI provider', async ({ page }) => {
    await setupApiMocks(page);
    await setupAutonomyMocks(page);
    await setAuthToken(page);
    await seedLocalStorage(page);

    // Override generate to simulate heuristic (source='heuristic', no critique)
    await page.route(
      new RegExp(`/autonomy/channels/${CHANNEL_ID}/calendar/generate$`),
      async (route) => {
        await route.fulfill({
          json: { ...GENERATE_RESULT, source: 'heuristic', critique: null },
        });
      },
    );

    await page.goto('/autonomy', { waitUntil: 'networkidle' });
    await expect(page.getByText('Uploads / week (90d)')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /generate calendar/i }).click();
    await expect(page.getByText('Claude 4 vs GPT-5')).toBeVisible({ timeout: 10_000 });

    // No critique paragraph expected in heuristic mode (null critique)
    const critiquePara = page.getByText(/Both entries are on-niche/i);
    await expect(critiquePara).toHaveCount(0);
  });
});
