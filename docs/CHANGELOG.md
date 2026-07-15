# Changelog

> Generated from conventional commits by `pnpm changelog` — do not edit by hand.

## 2026-07-13

### Features

- **flags**: SystemConfig-backed feature-flag service with env override + audit-logged admin surface — Phase 5 Wave 29 (docs4/29) (b384d32)
- **e2e**: visual regression snapshots for login/register/projects — Phase 5 Wave 28 (docs4/22) (2c7175b)
- **ci**: pin coverage gate to measured baseline (stmts 15/lines 14/fns 12/branches 13) — Phase 5 Wave 27 (docs4/21) (f2b4e1f)
- **ci**: bundle budget trend tracking — per-run report artifact + committed baseline with growth warnings — Phase 5 Wave 26 (docs4/44) (9a994e3)
- **api**: keyset cursor pagination for all remaining take-based lists via shared pagination util — Phase 5 Wave 25 (docs4/03) (13bc53f)
- **bi**: designate north-star metric — published videos per active channel (30d) hero tile — Phase 5 Wave 24 (docs4/01) (b1e3624)
- **a11y**: axe-core WCAG 2.2 AA e2e gate over 8 surfaces + fix all serious/critical violations — Phase 5 Wave 23 (docs4/42, /19, /22) (56b48f7)
- **assets**: scheduled asset GC — soft-delete/grace/purge sweep with FK + timeline-JSON reference checks — Phase 5 Wave 22 (Updates/09, Updates/40) (f073cf9)
- **jobs**: DLQ replay tooling — admin failed-jobs list + audit-logged replay endpoint — Phase 5 Wave 21 (Updates/35) (5dc8b45)
- **web**: actionable provider-outage/rate-limit error copy + wallet e2e for expiry timeline, marketplace, outage envelope — Phase 5 Wave 19 (closes R-06) (29b2597)
- **dev-api**: guard-level @PaidAction() decorator blocks sandbox keys on paid routes — Phase 5 Wave 18 (closes R-12) (6e1049d)
- **jobs**: stalled-job reaper + Idempotency-Key on enqueue — Phase 5 Wave 17 (closes R-01, R-02) (897707c)
- **observability**: structured JSON logging with correlation IDs + secret redaction — Phase 5 Wave 15 (Updates/38, closes R-04 app side) (2395075)
- **wallet**: credit expiry timeline + marketplace pack purchase UI — Phase 5 Wave 14 (Phase 6 §11–12) (3ce11c1)
- **ops**: /health + /ready probes, 202 on async enqueues, wallet lots endpoint, risk register — Phase 5 Wave 13 (5187834)

### Fixes

- **e2e**: raise wallet balance first-paint timeout to 15s — one-off slow render under full-suite load (33604d1)
- **settings**: don't flash 'No active sessions found' while the sessions query loads + exact e2e locators for the Active sessions heading (8a93988)
- **e2e**: repair jobs + library specs — expand collapsed Recent Jobs bar, register fixture mocks before spec-specific routes (last-registered wins), strict-mode exact locators (a2615e8)
- **e2e**: repair 4 stale Project Detail/Approval Center tests + surface nested result fields on approval cards (20b5086)

### Documentation

- move spec index README to repo root with docs4/ links + quickstart (329b10d)
- consolidated readiness checklist rolling up all Updates spec acceptance criteria — Phase 5 Wave 20 (Updates/48) (fc8f696)

### Chores

- **docs**: rename Updates/ -> docs4/ and repoint all 37 spec references (code comments, CI, Semgrep, living docs) (29e39ff)

## 2026-07-12

### Features

- **dev-api**: project/job resource routes + job enqueue with per-key token attribution — Phase 5 Wave 12 (c6fadbf)
- **billing**: credit-lot expiry warnings at 7/3/1 days via in-app notifications — Phase 5 Wave 11 (9050456)
- **dev-portal**: per-key request analytics + public dev-API OpenAPI doc — Phase 5 Wave 10 (2b69290)
- **shorts**: content-hash analysis cache — copy transcript/scenes/topics across identical media — Phase 5 Wave 9 (§12) (2f3cd4f)
- **orgs**: teams CRUD + team-scoped budget UI, admin dashboard e2e — Phase 5 Wave 8 (e1ea095)
- **orgs**: agent jobs bill org wallets via project billingOrgId + org management UI — Phase 5 Wave 7 (abec93d)
- **observability**: request-to-worker correlation IDs + structured error envelope — Updates/32 (99955e6)
- **credits**: burn forecast, optimization tips + copilot cost quotes — Updates/10 Phase 2 + /49 (553d8ab)

### Tests

- **e2e**: growth, library, notifications, sessions journeys (b5709b9)

### Chores

- **a11y**: jsx-a11y lint gate at error severity + violation fixes — Updates/42 (cd7014d)

### CI

- **perf**: bundle budget gate — Updates/44 (1afadb5)

## 2026-07-11

### Features

- **orgs**: bill copilot turns to org shared wallets — Phase 5 §10 spend wiring (493f39a)
- **enterprise**: budget rollover, org usage reports, admin dashboard — Phase 5 Wave 6 (009d95d)
- **dev-portal**: developer API keys + signed webhooks — Phase 5 Wave 4b (8fc230a)
- **bi**: enterprise analytics + explainable forecasting — Phase 5 Wave 4a (7877298)
- **orgs**: organizations, shared wallets, budget periods — Phase 5 Wave 3 (dc5001b)
- **ops**: alert rules, SLOs, Grafana dashboard, DR scripts + runbooks — Phase 5 Wave 5 (a34aed8)
- **ai-ops**: response + embedding caches, cache-hit attribution, routing dry-run — Phase 5 Wave 2 (9f0bfe7)
- **growth**: referral program, in-app notifications, growth surfaces — Phase 6 Waves 4+5 (e4079cc)
- **observability**: Prometheus metrics + Grafana provisioning — Phase 0 observability wave (e18b2c9)
- **credits**: wallet dashboard + monthly budgets with hard cap — Phase 0 credits wave (c953fa2)
- **library**: synced channel library with resumable sync + virtualized UI — Phase 0 library wave (f838db4)
- **auth**: revocable sessions + social sign-in with account linking — Phase 0 auth wave (7988134)

### Fixes

- **web**: drop eslint-disable comments for unregistered rules (d7c3f6d)

### Documentation

- **api**: document library, budgets, referral, notifications, caches, ops endpoints (a74563c)
- add engineering spec set (Updates/00-50) (243891b)
- move legacy docs1 set under docs/docs1 (bbeb884)

### Chores

- green the full lint + typecheck gates (a3f6e06)

### CI

- security + quality gates — Semgrep invariants, coverage floor, e2e job, Dependabot (d1c4cdc)

## 2026-07-07

### Features

- **growth**: upgrade engine + first-recharge rewards — Phase 6 Wave 2 (1f0881c)
- **trial**: free trial system with abuse prevention — Phase 6 Wave 1 (83bd54d)
- **ai-ops**: provider registry, dynamic pricing, profit guard — Phase 5 Wave 1 (bcabe78)
- **search,social**: cross-video library search + quote-card PNGs — Phase 6 slice 3 (20728b9)
- **billing**: credit lots with per-bucket expiry + dispute recharge freeze (aa2a5c5)
- **billing**: reconciliation jobs, refunds, dispute handling — billing spec slice 3 (0361ab7)
- **billing**: reserve->settle credit holds on AI runs — billing spec slice 2 (75b4d23)
- **billing**: wallet, credit ledger, RBAC, Stripe recharge — billing spec slice 1 (13187ae)
- **analytics**: per-video AI cost breakdown — Phase 6 slice 2 (9d6bb5d)
- **social**: social content factory — Phase 5 slice 5 (86a6cf3)
- **chapters**: YouTube chapter sync, both directions — Phase 6 slice 1 (ee7c0aa)
- **church**: church AI content pack per chapter — Phase 5 slice 4 (a9ace1f)
- **small-videos**: chapter -> horizontal small videos — Phase 5 slice 3 (ebcd578)
- **search**: transcript embeddings + natural-language search — Phase 5 slice 2 (6e9dbae)
- **chapters**: AI chapter detection — first Phase 5 slice (0c3c94f)
- **copilot**: unified intent-action layer + token governor (44bfc30)

## 2026-07-06

### Features

- **copilot**: multilingual voice conversation, spoken approvals, voice language for VO (23916b9)
- **pipeline**: real encode progress and stage retry with backoff (110d611)
- **copilot**: chat + voice control of the pipeline (0326729)
- **pipeline**: validation engine gates completion — no fake media, ever (97a3e39)
- **web**: accordion clips section on the analysis page (c0edba1)
- **web**: accordion topics and highlights on the analysis page (6e2d68d)
- **web**: accordion channel-videos list in Shorts Studio (bc0366a)
- **web**: accordion imported-videos list in Shorts Studio (4084bba)
- **web**: collapsible Recent Jobs section with expand-all on project page (8ea1bba)
- **web**: collapsible history section with expand-all in Approval Center (b07bd04)
- **web**: expandable history rows in the Approval Center (c8dca2f)
- **approvals**: auto-enqueue SHORTS_PUBLISH when a shorts export is approved (4777304)
- **approvals**: reviewed-history section in the Approval Center (a07ca17)
- **web**: human-readable Approval Center cards (8cd3bea)
- **web**: one-click Publish button on highlight cards (affc36d)
- **shorts-studio**: public auto-captions via yt-dlp + chunked Whisper ASR (9ce0a69)
- **shorts-studio**: Phase 5 — export packages and approval-gated publishing (fc72e97)
- **shorts-studio**: Phase 4 — smart reframe, vertical render, thumbnails, export page (ebe2e67)
- **shorts-studio**: Phase 3 — timeline editor, AI editing assistant, captions (0203daf)
- **shorts-studio**: Phase 2 — AI topic segmentation, highlight scoring, clip generation (a0cc4d3)
- **web**: Shorts Studio page + sidebar entry (5dec9d9)
- **shorts-studio**: Phase 1 backend foundation per ai.md spec (fc3c08f)

### Fixes

- **copilot**: teach the model the command JSON shape; log raw output on schema mismatch (73c9361)
- **shorts-studio**: bump timeline updatedAt when captions are generated (c352407)
- **shorts-studio**: caption fetch — regex sub-langs, tolerate partial downloads (ebfa2c1)
- **shorts-studio**: give yt-dlp a JS runtime (our own node binary) (0bc896e)
- **api**: serialize Prisma BigInt columns in JSON responses (bb13981)
- **shorts-studio**: hand yt-dlp the bundled ffmpeg for stream merging (6d1a176)
- **compliance**: scope the result cache to the service instance (48ba9d2)

### Tests

- **shorts-studio**: unit tests for SRT/duration parsing, source mapping, presets (f9fee4a)

### Chores

- ignore local yt-dlp checkout and binary (500b65d)

## 2026-07-05

### Features

- **web**: merge the standalone Jobs page into the project page (4c47b93)
- **media**: Gemini image adapter, latch revoked OpenAI key out of the chain (c3850a4)
- **web**: click-to-open job history rows (9fee015)

### Fixes

- **media**: honor Gemini 429 retryDelay before falling back to placeholders (b7fad4d)
- **ai**: retry once on schema mismatch and tolerate omitted fact-check sources (864de63)
- JWT sub-based ownership checks, render duration cap, and media player error state (d5be365)

## 2026-07-04

### Features

- deletable job history with owner-checked permanent deletion (a1934bf)
- render presets, transition SFX, auto B-roll fill, and pre-render quality analyzer (15cea10)
- **web**: disciplined content pipeline UI per 1.png with functional platform targeting (7d9221b)
- guided in-project studio flow with editable stages (4988213)
- **web**: analytics and projects redesign per analyse.jpg + access upgrade for URL channels (a5536ad)
- **web**: purple dashboard theme matching login.jpg/ux.jpg design references (73317cb)
- **web**: redesign auth pages to match login.jpg reference (0d3bae2)
- self-service YouTube channel access levels (ee33cc1)
- ElevenLabs voice adapter with admin-managed key and selective media regeneration (a9fd2a8)

### Fixes

- rescale subtitle cues to actual video duration (6880b2a)
- latest-per-type project jobs + script topic input and accordion cards (e8b585a)

### Refactoring

- **web**: dissolve production studio into pipeline stages per task1/task2 (c16b1b0)
- **web**: compact pipeline cards with dedicated detail panel per task1.txt (bee8dd1)
- consolidate app into single project workspace per task.txt (4e3d570)

## 2026-07-03

### Features

- one-click FULL_PRODUCTION pipeline with real media generation and ffmpeg rendering (4618a0e)
- **web**: save/print result actions and live AI activity indicators (5796581)
- beta media pipeline, analytics, teams schema + full agent suite (2b53c12)

### Fixes

- **api**: guard PENDING->QUEUED transition so fast workers are not overwritten (fffcce3)
- run web app on port 3007 to match e2e config and API CORS (6dd8e76)

### Chores

- stop tracking generated test artifacts and redis dump (b21cfb4)
