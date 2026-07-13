#!/usr/bin/env node
/**
 * Performance budget gate (docs4/44): fails the build when any route's
 * first-load JavaScript exceeds the budget, and tracks size trends between
 * runs so slow creep is visible before the hard budget trips.
 *
 * Reads .next/app-build-manifest.json (written by `next build`) and sums the
 * on-disk size of each route's script files. Sizes are RAW bytes (pre-gzip)
 * — network transfer is roughly 3× smaller — so budgets are calibrated
 * against raw output. Override via env:
 *   BUNDLE_BUDGET_ROUTE_KB   per-route first-load budget (default 800)
 *   BUNDLE_BUDGET_TOTAL_KB   total unique JS across all routes (default 1500)
 *   BUNDLE_TREND_WARN_PCT    per-route growth vs baseline that logs a warning (default 10)
 *
 * Trend tracking: every run writes .next/bundle-budget-report.json (uploaded
 * as a CI artifact). Route sizes are diffed against the committed baseline
 * scripts/bundle-budget-baseline.json; growth beyond BUNDLE_TREND_WARN_PCT is
 * WARNED, not failed — the budget stays the only hard gate. Refresh the
 * baseline consciously after reviewing a legitimate size change:
 *   node scripts/check-bundle-budget.mjs --update-baseline
 *
 * Baseline at introduction (2026-07): heaviest route 571 KB, total 1001 KB —
 * budgets leave ~40% headroom before a conscious raise is needed.
 *
 * Usage: node scripts/check-bundle-budget.mjs   (run from apps/web after build)
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROUTE_BUDGET_KB = Number(process.env.BUNDLE_BUDGET_ROUTE_KB) || 800;
const TOTAL_BUDGET_KB = Number(process.env.BUNDLE_BUDGET_TOTAL_KB) || 1500;

const nextDir = join(process.cwd(), '.next');

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(nextDir, 'app-build-manifest.json'), 'utf8'));
} catch (err) {
  console.error(`bundle-budget: cannot read app-build-manifest.json — run \`next build\` first (${err.message})`);
  process.exit(2);
}

const sizeCache = new Map();
function fileKb(file) {
  if (!sizeCache.has(file)) {
    try {
      sizeCache.set(file, statSync(join(nextDir, file)).size / 1024);
    } catch {
      sizeCache.set(file, 0); // file emitted under a different root (e.g. edge) — skip
    }
  }
  return sizeCache.get(file);
}

const routes = Object.entries(manifest.pages ?? {})
  .filter(([route]) => route.endsWith('/page') || route === '/layout')
  .map(([route, files]) => {
    const jsFiles = files.filter((f) => f.endsWith('.js'));
    const kb = jsFiles.reduce((s, f) => s + fileKb(f), 0);
    return { route, kb: Math.round(kb), files: jsFiles.length };
  })
  .sort((a, b) => b.kb - a.kb);

const allFiles = new Set(
  Object.values(manifest.pages ?? {}).flat().filter((f) => f.endsWith('.js')),
);
const totalKb = Math.round([...allFiles].reduce((s, f) => s + fileKb(f), 0));

console.log(`bundle-budget: per-route budget ${ROUTE_BUDGET_KB} KB, total budget ${TOTAL_BUDGET_KB} KB (raw bytes)`);
for (const r of routes) {
  const flag = r.kb > ROUTE_BUDGET_KB ? '  << OVER BUDGET' : '';
  console.log(`  ${String(r.kb).padStart(6)} KB  ${r.route}${flag}`);
}
console.log(`  ${String(totalKb).padStart(6)} KB  TOTAL unique JS${totalKb > TOTAL_BUDGET_KB ? '  << OVER BUDGET' : ''}`);

// ── Trend tracking (docs4/44: budgets tracked over time, not just gated) ─────

const TREND_WARN_PCT = Number(process.env.BUNDLE_TREND_WARN_PCT) || 10;
const baselinePath = join(process.cwd(), 'scripts', 'bundle-budget-baseline.json');

const report = {
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? null,
  totalKb,
  routes: Object.fromEntries(routes.map((r) => [r.route, r.kb])),
};
writeFileSync(join(nextDir, 'bundle-budget-report.json'), JSON.stringify(report, null, 2));

if (process.argv.includes('--update-baseline')) {
  writeFileSync(baselinePath, JSON.stringify(report, null, 2) + '\n');
  console.log(`bundle-budget: baseline updated (${routes.length} routes, total ${totalKb} KB)`);
}

let baseline = null;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch {
  console.log('bundle-budget: no baseline — trend diff skipped (run with --update-baseline to create one)');
}

if (baseline) {
  const totalDelta = totalKb - baseline.totalKb;
  console.log(
    `bundle-budget: trend vs baseline (${baseline.generatedAt?.slice(0, 10)}): ` +
    `total ${totalDelta >= 0 ? '+' : ''}${totalDelta} KB`,
  );
  for (const r of routes) {
    const prev = baseline.routes?.[r.route];
    if (prev === undefined) {
      console.log(`    NEW  ${r.route} (${r.kb} KB)`);
      continue;
    }
    const growthPct = prev > 0 ? ((r.kb - prev) / prev) * 100 : 0;
    if (growthPct > TREND_WARN_PCT) {
      console.warn(
        `    WARN ${r.route} grew ${prev} → ${r.kb} KB (+${growthPct.toFixed(1)}% > ${TREND_WARN_PCT}%) — ` +
        'review, then refresh the baseline if intended',
      );
    }
  }
}

const overRoutes = routes.filter((r) => r.kb > ROUTE_BUDGET_KB);
if (overRoutes.length > 0 || totalKb > TOTAL_BUDGET_KB) {
  console.error(
    `\nbundle-budget: FAILED — ${overRoutes.length} route(s) over ${ROUTE_BUDGET_KB} KB` +
    (totalKb > TOTAL_BUDGET_KB ? `; total ${totalKb} KB > ${TOTAL_BUDGET_KB} KB` : '') +
    '\nReduce first-load JS (dynamic imports, drop heavy deps) or consciously raise the budget in ci.yml.',
  );
  process.exit(1);
}
console.log('bundle-budget: OK');
