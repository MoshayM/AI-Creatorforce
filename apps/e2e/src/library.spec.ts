import { test, expect } from '@playwright/test';
import { setupApiMocks, setAuthToken } from './fixtures/api-mock';

const BASE = 'http://localhost:4007/api/v1';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeVideoPage(
  count: number,
  offset: number,
  nextCursor: string | null,
) {
  const data = Array.from({ length: count }, (_, i) => ({
    id: `vid-${offset + i}`,
    youtubeVideoId: `yt-${offset + i}`,
    kind: 'video' as const,
    title: `Test Video ${offset + i + 1}`,
    description: null,
    thumbnailUrl: null,
    durationMs: 300_000,
    publishedAt: '2026-01-01T00:00:00.000Z',
    viewCount: 1000,
    likeCount: 50,
    commentCount: 5,
  }));
  return { data, nextCursor };
}

function makePlaylist(i: number) {
  return {
    id: `pl-${i}`,
    youtubePlaylistId: `ytpl-${i}`,
    title: `Playlist ${i}`,
    description: null,
    thumbnailUrl: null,
    itemCount: 3,
  };
}

// ── Per-test route setup ───────────────────────────────────────────────────────

async function setupLibraryMocks(
  page: import('@playwright/test').Page,
  syncPhase: 'IDLE' | 'VIDEOS' = 'IDLE',
) {
  // Must be registered AFTER setupApiMocks: Playwright invokes the
  // last-registered matching route first, so these override the fixture's
  // channelStore-backed /channels handler (whose store starts empty).

  // Channels list — single channel
  await page.route(`${BASE}/channels`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: [{ id: 'ch-lib-1', title: 'Test Channel', youtubeChannelId: 'UCtest', active: true }],
      });
    } else {
      await route.continue();
    }
  });

  // Sync status
  await page.route(`${BASE}/channels/ch-lib-1/sync-status`, async (route) => {
    await route.fulfill({
      json: {
        phase: syncPhase,
        syncedVideos: syncPhase === 'VIDEOS' ? 12 : 0,
        syncedPlaylists: 0,
        error: null,
      },
    });
  });

  // Videos — two pages
  await page.route(`${BASE}/channels/ch-lib-1/videos*`, async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get('cursor');
    if (cursor === 'page2') {
      await route.fulfill({ json: makeVideoPage(5, 50, null) });
    } else {
      await route.fulfill({ json: makeVideoPage(50, 0, 'page2') });
    }
  });

  // Playlists
  await page.route(`${BASE}/channels/ch-lib-1/playlists*`, async (route) => {
    const url = new URL(route.request().url());
    const isItems = /\/playlists\/[^/]+\/items/.test(url.pathname);
    if (!isItems) {
      await route.fulfill({
        json: { data: [makePlaylist(1), makePlaylist(2)], nextCursor: null },
      });
    }
  });

  // Playlist items
  await page.route(/\/channels\/ch-lib-1\/playlists\/pl-\d+\/items/, async (route) => {
    await route.fulfill({
      json: {
        data: [
          {
            id: 'pli-1',
            position: 0,
            video: {
              id: 'vid-0',
              youtubeVideoId: 'yt-0',
              kind: 'video',
              title: 'Test Video 1',
              description: null,
              thumbnailUrl: null,
              durationMs: 300_000,
              publishedAt: '2026-01-01T00:00:00.000Z',
              viewCount: 1000,
              likeCount: 50,
              commentCount: 5,
            },
          },
        ],
        nextCursor: null,
      },
    });
  });

  // Sync start
  await page.route(`${BASE}/channels/ch-lib-1/sync`, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 200, json: { jobId: 'job-sync-1' } });
    }
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('Library', () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await setupLibraryMocks(page);
    await setAuthToken(page);
    await page.goto('/library');
    await page.waitForLoadState('domcontentloaded');
  });

  test('Library nav sub-link is visible under Settings group when on /library', async ({ page }) => {
    // Library is a sub-link nested under the Settings collapsible group.
    // When the active route is /library the Settings group auto-expands, so the
    // sub-link is visible without manually clicking the chevron.
    await page.goto('/library');
    await page.waitForLoadState('domcontentloaded');
    // The sub-link is rendered and visible because the group is auto-open
    const libLink = page.locator('a[href="/library"]');
    await expect(libLink).toBeVisible({ timeout: 8_000 });
    await expect(page).toHaveURL(/\/library/);
  });

  test('page heading renders', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible({ timeout: 8_000 });
  });

  test('channel is auto-selected and videos render', async ({ page }) => {
    // Wait for videos to appear after auto-selection of the single channel
    // (exact: true — substring matching would also hit "Test Video 10" etc.)
    await expect(page.getByText('Test Video 1', { exact: true })).toBeVisible({ timeout: 10_000 });
    // Virtual grid renders visible subset — just assert at least one title is in the DOM
    await expect(page.getByText(/Test Video/).first()).toBeVisible();
  });

  test('search input updates URL with ?q= param', async ({ page }) => {
    // Wait for channel to be auto-selected first
    await expect(page.getByText('Test Video 1', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Intercept the next videos request to capture the q param
    let capturedQ: string | null = null;
    await page.route(`${BASE}/channels/ch-lib-1/videos*`, async (route) => {
      const url = new URL(route.request().url());
      capturedQ = url.searchParams.get('q');
      await route.fulfill({ json: makeVideoPage(3, 0, null) });
    });

    const searchInput = page.getByRole('searchbox', { name: 'Search videos' });
    await searchInput.fill('hello');

    // URL should update with ?q=hello (debounced at 300 ms)
    await expect(page).toHaveURL(/\?.*q=hello/, { timeout: 5_000 });
    // The API call should carry the q param
    await expect.poll(() => capturedQ, { timeout: 5_000 }).toBe('hello');
  });

  test('type filter toggle updates URL with ?type=', async ({ page }) => {
    await expect(page.getByText('Test Video 1', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Shorts' }).click();
    await expect(page).toHaveURL(/type=short/, { timeout: 5_000 });
  });

  test('playlists tab lists playlists', async ({ page }) => {
    await expect(page.getByText('Test Video 1', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'playlists' }).click();
    await expect(page.getByText('Playlist 1')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Playlist 2')).toBeVisible();
  });

  test('sync button POSTs /channels/:id/sync', async ({ page }) => {
    await expect(page.getByText('Test Video 1', { exact: true })).toBeVisible({ timeout: 10_000 });
    const syncPost = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/channels/ch-lib-1/sync'),
    );
    // The sync button is rendered by SyncBadge when status.phase is IDLE
    await page.getByRole('button', { name: 'Sync library' }).click();
    await syncPost;
  });
});

test.describe('Library — syncing badge', () => {
  test('shows syncing badge when sync phase is VIDEOS', async ({ page }) => {
    // Fixture first, specific routes after — last-registered route wins
    await setupApiMocks(page);
    await page.route(`${BASE}/channels`, async (route) => {
      await route.fulfill({
        json: [{ id: 'ch-lib-1', title: 'Test Channel', youtubeChannelId: 'UCtest', active: true }],
      });
    });
    await page.route(`${BASE}/channels/ch-lib-1/sync-status`, async (route) => {
      await route.fulfill({
        json: { phase: 'VIDEOS', syncedVideos: 12, syncedPlaylists: 0, error: null },
      });
    });
    await page.route(`${BASE}/channels/ch-lib-1/videos*`, async (route) => {
      await route.fulfill({ json: makeVideoPage(3, 0, null) });
    });
    await page.route(`${BASE}/channels/ch-lib-1/playlists*`, async (route) => {
      await route.fulfill({ json: { data: [], nextCursor: null } });
    });
    await setAuthToken(page);
    await page.goto('/library');
    await page.waitForLoadState('domcontentloaded');
    // Channel auto-selects, SyncBadge renders the active-phase message
    await expect(page.getByText(/Syncing/)).toBeVisible({ timeout: 10_000 });
  });
});
