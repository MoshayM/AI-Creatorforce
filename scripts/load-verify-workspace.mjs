#!/usr/bin/env node
/**
 * Workspace load verification (docs4/13 §p75 budget, risk R-11 app-side half):
 * measures p75 time-to-first-video-card on /library against a channel seeded
 * with 10k videos, over N production-build page loads.
 *
 * Prereqs: API on :4007 and web (production build) on :3007, Postgres up.
 *
 * Phases (idempotent):
 *   seed     — register load-test user, create channel + 10k library rows
 *   measure  — N cold page loads via Playwright chromium, report p50/p75/p95
 *   cleanup  — delete the load-test user (channel + rows cascade)
 *
 * Usage: node scripts/load-verify-workspace.mjs seed|measure|cleanup
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const API = 'http://localhost:4007/api/v1';
const WEB = 'http://localhost:3007';
const EMAIL = 'loadtest-10k@creatorforce.local';
const PASSWORD = 'LoadTest10k!Secret';
const CHANNEL_YT_ID = 'UC-loadtest-10k';
const VIDEO_COUNT = Number(process.env['VIDEO_COUNT']) || 10_000;
const ITERATIONS = 20;
const P75_BUDGET_MS = 2_000;

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body.accessToken ?? body.data?.accessToken ?? null;
}

async function ensureUser() {
  const existing = await login();
  if (existing) return existing;
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'Load Test' }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const token = await login();
  if (!token) throw new Error('login after register failed');
  return token;
}

function prisma() {
  const { PrismaClient } = require('../apps/api/node_modules/@prisma/client');
  return new PrismaClient();
}

async function seed() {
  await ensureUser();
  const db = prisma();
  try {
    const user = await db.user.findUnique({ where: { email: EMAIL } });
    let channel = await db.channel.findUnique({ where: { youtubeChannelId: CHANNEL_YT_ID } });
    if (!channel) {
      channel = await db.channel.create({
        data: {
          userId: user.id,
          youtubeChannelId: CHANNEL_YT_ID,
          title: 'LoadTest 10k',
          active: true,
          lastSyncedAt: new Date(),
        },
      });
    }
    const have = await db.libraryVideo.count({ where: { channelId: channel.id } });
    if (have < VIDEO_COUNT) {
      const base = Date.UTC(2020, 0, 1);
      const batch = 1_000;
      for (let start = have; start < VIDEO_COUNT; start += batch) {
        const rows = Array.from({ length: Math.min(batch, VIDEO_COUNT - start) }, (_, j) => {
          const i = start + j;
          return {
            channelId: channel.id,
            youtubeVideoId: `lt-${i}`,
            kind: i % 5 === 0 ? 'short' : 'video',
            title: `Load Test Video ${i} — synthetic workspace-scale row`,
            durationMs: i % 5 === 0 ? 45_000 : 600_000,
            publishedAt: new Date(base + i * 3_600_000),
            viewCount: (i * 37) % 100_000,
            likeCount: (i * 13) % 5_000,
            commentCount: (i * 7) % 900,
          };
        });
        await db.libraryVideo.createMany({ data: rows, skipDuplicates: true });
        process.stdout.write(`\rseeded ${Math.min(start + batch, VIDEO_COUNT)}/${VIDEO_COUNT}`);
      }
      console.log();
    }
    console.log(`seed: channel ${channel.id} has ${await db.libraryVideo.count({ where: { channelId: channel.id } })} videos`);
  } finally {
    await db.$disconnect();
  }
}

async function measure() {
  const token = await login();
  if (!token) throw new Error('load-test user missing — run seed first');
  const { chromium } = require('../apps/e2e/node_modules/@playwright/test');
  const browser = await chromium.launch();
  const times = [];
  for (let i = 0; i < ITERATIONS; i++) {
    // Fresh context per iteration = cold browser cache (server caches stay warm,
    // matching a returning user's p75 experience)
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript((t) => localStorage.setItem('cf_token', t), token);
    const start = Date.now();
    await page.goto(`${WEB}/library`);
    await page.getByText('Load Test Video', { exact: false }).first().waitFor({ timeout: 30_000 });
    times.push(Date.now() - start);
    await ctx.close();
    process.stdout.write(`\rmeasure ${i + 1}/${ITERATIONS}: ${times[times.length - 1]} ms   `);
  }
  await browser.close();
  console.log();
  const sorted = [...times].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  const p50 = pct(50), p75 = pct(75), p95 = pct(95);
  console.log(`measure: n=${ITERATIONS} p50=${p50}ms p75=${p75}ms p95=${p95}ms (budget p75 ≤ ${P75_BUDGET_MS}ms)`);
  console.log(p75 <= P75_BUDGET_MS ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exitCode = p75 <= P75_BUDGET_MS ? 0 : 1;
}

async function cleanup() {
  const db = prisma();
  try {
    const user = await db.user.findUnique({ where: { email: EMAIL } });
    if (user) {
      await db.user.delete({ where: { id: user.id } }); // channel + rows cascade
      console.log('cleanup: load-test user and channel removed');
    } else {
      console.log('cleanup: nothing to remove');
    }
  } finally {
    await db.$disconnect();
  }
}

const phase = process.argv[2];
if (phase === 'seed') await seed();
else if (phase === 'measure') await measure();
else if (phase === 'cleanup') await cleanup();
else {
  console.error('usage: node scripts/load-verify-workspace.mjs seed|measure|cleanup');
  process.exit(2);
}
