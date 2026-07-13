import { Page, request } from '@playwright/test';

const BASE = 'http://localhost:4007/api/v1';

export const MOCK_TOKEN = 'mock-jwt-token-for-testing';

type StoreChannel = {
  id: string; youtubeChannelId: string; title: string; description: string;
  thumbnailUrl: null; customUrl: string; subscriberCount: number; videoCount: number;
  active: boolean; readOnly?: boolean; lastSyncedAt: string; createdAt: string;
};

// Starts empty — channels are only added when the user explicitly connects one via OAuth
const channelStore: StoreChannel[] = [];
let channelSeq = 0;
const CHANNEL_NAMES = [
  { title: 'Gaming Nexus', customUrl: '@gamingnexus', subs: 4800, videos: 34 },
  { title: 'Cooking with AI', customUrl: '@cookingwithai', subs: 22100, videos: 112 },
  { title: 'Finance Unlocked', customUrl: '@financeunlocked', subs: 9350, videos: 58 },
  { title: 'Travel Hacks', customUrl: '@travelhacks', subs: 31000, videos: 203 },
];

const MOCK_PROJECTS = [
  { id: 'proj-1', title: 'AI Tools Deep Dive', niche: 'Technology', status: 'ACTIVE', targetLang: 'en', channel: { title: 'TechReview Pro', thumbnailUrl: null }, _count: { jobs: 5, videos: 2 }, updatedAt: '2026-06-20T10:00:00.000Z' },
  { id: 'proj-2', title: 'Beginner Coding Series', niche: 'Education', status: 'DRAFT', targetLang: 'en', channel: { title: 'TechReview Pro', thumbnailUrl: null }, _count: { jobs: 1, videos: 0 }, updatedAt: '2026-06-18T10:00:00.000Z' },
];

const MOCK_PROJECT_DETAIL = {
  id: 'proj-1', title: 'AI Tools Deep Dive', niche: 'Technology', status: 'ACTIVE', targetLang: 'en',
  description: 'Comprehensive series on AI productivity tools', channelId: 'ch-1',
  channel: { id: 'ch-1', title: 'TechReview Pro', thumbnailUrl: null, youtubeChannelId: 'UCmock123' },
  jobs: [
    { id: 'job-1', type: 'TREND_ANALYSIS', status: 'COMPLETED', createdAt: '2026-06-20T10:00:00.000Z', completedAt: '2026-06-20T10:01:00.000Z' },
    { id: 'job-2', type: 'RESEARCH', status: 'COMPLETED', createdAt: '2026-06-20T10:02:00.000Z', completedAt: '2026-06-20T10:03:00.000Z' },
    { id: 'job-3', type: 'COMPLIANCE', status: 'WAITING_APPROVAL', createdAt: '2026-06-20T10:04:00.000Z', completedAt: null },
  ],
  videos: [],
  approvals: [{ id: 'appr-1', status: 'PENDING' }],
};

export const MOCK_APPROVALS = [
  {
    id: 'appr-1', status: 'PENDING', expiresAt: '2026-06-28T10:00:00.000Z',
    project: { title: 'AI Tools Deep Dive', channel: { title: 'TechReview Pro' } },
    job: { type: 'METADATA', result: { metadata: { title: 'Top 5 AI Tools That Replace Your Entire Workflow' }, awaitingApproval: true } },
  },
];

const MOCK_TRENDS = {
  trending: [
    { topic: 'AI Agents Automation 2026', score: 94, relatedKeywords: ['n8n', 'make.com', 'zapier AI', 'Claude API'], peakTime: 'weekdays' },
    { topic: 'Local LLMs vs Cloud AI', score: 87, relatedKeywords: ['Ollama', 'LM Studio', 'privacy AI'], peakTime: null },
    { topic: 'Vibe Coding with AI', score: 82, relatedKeywords: ['cursor', 'copilot', 'claude code'], peakTime: null },
  ],
  recommendations: ['Focus on beginner tutorials'],
  analysisDate: '2026-06-26',
};

const MOCK_SUBSCRIPTION = {
  plan: 'FREE', status: 'ACTIVE',
  currentPeriodStart: '2026-06-01T00:00:00.000Z',
  currentPeriodEnd: '2026-06-30T23:59:59.000Z',
  cancelAtPeriodEnd: false,
};

export async function setupApiMocks(page: Page) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  await page.route(`${BASE}/auth/login`, async (route) => {
    const body = route.request().postDataJSON() as { email?: string; password?: string } | null;
    if (body?.email && body?.password) {
      await route.fulfill({ json: { accessToken: MOCK_TOKEN } });
    } else {
      await route.fulfill({ status: 401, json: { message: 'Invalid credentials' } });
    }
  });

  await page.route(`${BASE}/auth/register`, async (route) => {
    await route.fulfill({ status: 201, json: { accessToken: MOCK_TOKEN } });
  });

  // ── Channels ──────────────────────────────────────────────────────────────
  await page.route(/\/api\/v1\/channels\/auth-url/, async (route) => {
    // Simulate OAuth succeeding — add a new channel to the store so the list updates after redirect
    const info = CHANNEL_NAMES[channelSeq % CHANNEL_NAMES.length]!;
    const now = new Date().toISOString();
    channelStore.push({
      id: `ch-dyn-${channelSeq + 1}`,
      youtubeChannelId: `UCdyn${channelSeq + 1}`,
      title: info.title,
      customUrl: info.customUrl,
      description: 'Connected via YouTube OAuth',
      thumbnailUrl: null,
      subscriberCount: info.subs,
      videoCount: info.videos,
      active: true,
      lastSyncedAt: now,
      createdAt: now,
    });
    channelSeq++;
    await route.fulfill({ json: { url: 'http://localhost:3007/settings?connected=true' } });
  });

  await page.route(/\/api\/v1\/channels\/status/, async (route) => {
    const active = channelStore.find((c) => c.active);
    if (!active) {
      await route.fulfill({ json: { connected: false } });
    } else {
      await route.fulfill({ json: {
        connected: true,
        channelId: active.youtubeChannelId,
        channelName: active.title,
        handle: active.customUrl,
        thumbnail: active.thumbnailUrl,
        subscriberCount: active.subscriberCount,
        connectedAt: active.createdAt,
        lastSyncAt: active.lastSyncedAt,
      }});
    }
  });

  await page.route(`${BASE}/channels/connect-by-url`, async (route) => {
    const body = route.request().postDataJSON() as { channelUrl?: string } | null;
    const raw = (body?.channelUrl ?? '').trim();
    if (!raw) {
      await route.fulfill({ status: 400, json: { message: 'channelUrl is required' } });
      return;
    }
    const handleMatch = raw.match(/(?:youtube\.com\/@?|^@?)([\w.-]+)/i);
    const handleSlug = handleMatch?.[1] ?? raw.replace(/[^a-z0-9]/gi, '');
    const displayName = handleSlug.charAt(0).toUpperCase() + handleSlug.slice(1);
    const customUrl = `@${handleSlug.toLowerCase()}`;
    const now = new Date().toISOString();
    const newCh: StoreChannel = {
      id: `ch-url-${channelSeq + 1}`,
      youtubeChannelId: `UCurl${channelSeq + 1}`,
      title: displayName,
      customUrl,
      description: 'Connected via URL (read-only)',
      thumbnailUrl: null,
      subscriberCount: 0,
      videoCount: 0,
      active: true,
      lastSyncedAt: now,
      createdAt: now,
    };
    channelStore.push(newCh);
    channelSeq++;
    await route.fulfill({ status: 201, json: { ...newCh, readOnly: true } });
  });

  await page.route(`${BASE}/channels`, async (route) => {
    await route.fulfill({ json: [...channelStore] });
  });

  // ── Projects ──────────────────────────────────────────────────────────────
  await page.route(`${BASE}/projects`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { data: MOCK_PROJECTS, nextCursor: null } });
    } else {
      const body = route.request().postDataJSON() as { title?: string; channelId?: string } | null;
      await route.fulfill({ status: 201, json: { id: 'proj-new', title: body?.title ?? '', channelId: body?.channelId ?? '', status: 'DRAFT', niche: null, targetLang: 'en', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
    }
  });

  // Specific project IDs — registered AFTER the list route, so they take priority (LIFO)
  await page.route(/\/api\/v1\/projects\/[^/]+$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: MOCK_PROJECT_DETAIL });
    } else {
      await route.fulfill({ json: { ...MOCK_PROJECT_DETAIL } });
    }
  });

  // ── Jobs ──────────────────────────────────────────────────────────────────
  await page.route(/\/api\/v1\/jobs\/project\/[^/]+$/, async (route) => {
    await route.fulfill({ json: MOCK_PROJECT_DETAIL.jobs });
  });

  await page.route(`${BASE}/jobs`, async (route) => {
    const body = route.request().postDataJSON() as { type?: string } | null;
    await route.fulfill({ status: 201, json: { id: 'job-new', projectId: 'proj-1', type: body?.type ?? 'TREND_ANALYSIS', status: 'QUEUED', payload: {}, result: null, error: null, attempts: 0, startedAt: null, completedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  });

  await page.route(/\/api\/v1\/jobs\/[^/]+$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: MOCK_PROJECT_DETAIL.jobs[0] });
    } else {
      await route.fulfill({ json: { success: true } });
    }
  });

  // ── Approvals ─────────────────────────────────────────────────────────────
  await page.route(`${BASE}/approvals/pending`, async (route) => {
    await route.fulfill({ json: { data: MOCK_APPROVALS, nextCursor: null } });
  });

  await page.route(/\/api\/v1\/approvals\/[^/]+\/approve$/, async (route) => {
    await route.fulfill({ json: { id: 'appr-1', status: 'APPROVED' } });
  });

  await page.route(/\/api\/v1\/approvals\/[^/]+\/reject$/, async (route) => {
    await route.fulfill({ json: { id: 'appr-1', status: 'REJECTED' } });
  });

  // ── Trends ────────────────────────────────────────────────────────────────
  await page.route(`${BASE}/trends/analyze`, async (route) => {
    await route.fulfill({ json: MOCK_TRENDS });
  });

  // ── Billing ───────────────────────────────────────────────────────────────
  await page.route(`${BASE}/billing/subscription`, async (route) => {
    await route.fulfill({ json: MOCK_SUBSCRIPTION });
  });

  await page.route(`${BASE}/billing/checkout`, async (route) => {
    await route.fulfill({ json: { url: 'https://checkout.stripe.com/mock-session' } });
  });
}

// Cached real JWT so every test in a run shares one login call
let _cachedToken: string | null = null;

export async function setAuthToken(page: Page) {
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');

  // Use a real JWT obtained via Node.js (outside page context so Playwright
  // route mocks don't intercept it). A real token means any API call that
  // bypasses a route handler returns real data instead of 401.
  if (!_cachedToken) {
    try {
      const ctx = await request.newContext();
      const r = await ctx.post(`${BASE}/auth/login`, {
        data: { email: 'ethonanpasumvalki@gmail.com', password: 'password@123' },
      });
      if (r.ok()) {
        const body = await r.json() as { accessToken?: string };
        _cachedToken = body.accessToken ?? null;
      }
      await ctx.dispose();
    } catch {
      // fall through
    }
  }

  await page.evaluate(
    (token) => localStorage.setItem('cf_token', token),
    _cachedToken ?? MOCK_TOKEN,
  );
}
