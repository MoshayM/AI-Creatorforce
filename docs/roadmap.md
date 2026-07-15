# roadmap.md — AI CreatorForce

This file describes the strategic product timeline for AI CreatorForce. Build mechanics and current implementation state live in [build.md](build.md); feature descriptions live in [features.md](features.md).

> Strategic timeline. Build mechanics live in `build.md`; this is the product/market view.

---

## Vision Arc

AI CreatorForce becomes the operating system for YouTube creators — from a single-creator tool to an agency-grade multi-channel platform with AI autonomy where it is appropriate (research, scripting, optimization) and human control where it matters (publish, compliance approval).

---

## Core Principles (Unchanging)

See [project.md](project.md) for full detail. In brief:

- Original, monetizable content only.
- Human-in-the-loop on publish — always.
- Compliance as a hard gate, never a suggestion.
- No fabricated facts.
- Creator productivity, not spam.

These are non-goals for every phase: spam/content-farm tooling, fully autonomous publish without prior human approval, copyright/disclosure evasion, fake-engagement features.

---

## Phase 1 — Core Platform (COMPLETED)

- Auth, channel connect (OAuth, encrypted tokens), project management.
- Full content pipeline: Research → Script → FactCheck → Compliance → Metadata → SEO → Approval → Publish.
- `ComplianceAgent` hard gate — no publish path bypasses it.
- Billing and credits foundation: wallet, subscription tiers (FREE/STARTER/PRO/AGENCY), Stripe integration, hard-cap budget enforcement.
- Developer portal (API keys, webhooks).
- GitHub Actions CI with lint, typecheck, unit tests, build, SAST, DAST, E2E.

---

## Phase 2 — Shorts Studio (COMPLETED)

- Channel-first Shorts Studio (select channel before any library content appears).
- Library picker with explicit video selection modal — no automatic import.
- Per-video user reference notes with sticky-note indicator.
- Transcript analysis, scene detection, topic segmentation, chapter detection (AI) + YouTube chapter import.
- Clip recommendations and Shorts generation.
- `ShortsTimeline` editor with drag-drop clip ordering and AI editing assistant.
- Social content factory (QUOTE_CARD / CAROUSEL / BLOG_POST / NEWSLETTER).
- Chapter sync to YouTube description.
- Export + publish flow.

---

## Phase 3 — Enterprise and Growth (COMPLETED)

- Organizations + Teams with shared wallet and `BudgetPeriod` credit allocation.
- Referral program (`ReferralCode` + referral credit grants).
- Trial engine (`TrialGrant`, `TrialLimitsService`, `UpgradeEngineService`).
- Marketplace + offers (`MarketplaceService`, `OffersService`).
- BI analytics module.
- Org/team RBAC.
- `GrowthReportJob`.

---

## Phase 4 — Media Pipeline (IN PROGRESS)

Built so far:
- Voice, Image, Music, Video, Subtitle agents implemented.
- Render pipeline: `Timeline` model → ffmpeg → `RenderPreset` (DRAFT_PROXY / YT_1080P / YT_4K / SHORTS_1080X1920).
- `Asset` / `AssetVersion` with versioning and `r2Key` field.
- `EditPlanAgent`.

Still needed to complete Phase 4:
- Cloudflare R2 SDK wiring (`r2Key` field is ready, integration is not).
- External video generation provider integrations (Veo/Kling/Runway/Pika/Luma) — `AssetVersion.provider` field is ready.
- External music generation providers (Suno/Udio/Stable Audio).
- End-to-end render-to-publish flow: in-app generated video file → YouTube upload. `PublishingService.publish()` currently requires a user-supplied `videoFilePath`.

---

## Phase 5 — Automation and Scale (IN PROGRESS)

Shipped so far:

- **Per-channel Automation** (`ChannelAutomation` model, 15-min `AUTOMATION_TICK` BullMQ repeatable heartbeat). Auto-import / auto-analyze / auto-publish (paced, APPROVED-only) / chapter-sync per channel, each with daily quotas. AI-suggested settings with heuristic fallback. Automation UI under Settings sidebar group.
- **Standalone Video Editor** (`EditProject` model, `EDIT_RENDER` job type, multi-track timeline, Phase 1–3 render — filters, transitions, audio mixing, multi-format/quality export). Video Editor is a top-level sidebar item.
- **Security hardening:** production startup guard for `JWT_SECRET`/`TOKEN_ENCRYPTION_KEY`; Redis-backed auth rate limiting on login/register/refresh.
- **Public landing page** at `/` (feature grid, download CTAs, Use-in-browser CTA).
- **CI overhaul:** Node 24, pnpm from `packageManager`, `prisma generate` in typecheck/unit/build jobs, production-build E2E, `TOKEN_ENCRYPTION_KEY` in E2E env, ZAP baseline CI job.
- **Reliability:** chapter sync surfaces real YouTube errors (`invalid_grant` → reconnect); embedding generation non-fatal; AV1 sources re-acquired as H.264; typed media pipeline errors with friendly Shorts error cards.

Still needed:
- n8n workflow runtime deployment.
- Multi-region deployment.
- Horizontal BullMQ worker scaling.
- Rate limiting and quota management per subscription tier (beyond auth endpoints).
- Staging environment.
- Production infrastructure-as-code.

---

## Phase 6 — AI Autonomy and Intelligence (PLANNED)

- Deeper AI copilot: intent classification → full workflow orchestration.
- Cross-channel intelligence and benchmarking.
- Advanced audience segmentation.
- Auto-generated content calendars.
- Real-time trend integration.

---

## Phase 7 — Platform and Ecosystem (PLANNED)

- Partner/agency white-labeling.
- Additional AI provider support: DeepSeek/Grok/Mistral/OpenRouter in `aiClient`.
- i18n / localization (`targetLang` field exists on the `Project` model; UI layer not wired).
- Public developer API GA.

---

## Current Gaps in Completed Phases

These items are gaps within phases marked COMPLETED — they were not delivered as part of those phases and remain outstanding:

- n8n runtime deployment (designed in Phase 1 scope, not deployed).
- In-app video file generation from render pipeline to YouTube upload (Shorts publish and long-form publish both still require a user-supplied `videoFilePath`; standalone editor renders but the path from editor render → YouTube upload is not yet wired).
- Cloudflare R2 storage wiring (`r2Key` fields present; R2 client not integrated).
- External video and music generation providers.
- Staging environment.
- Production infrastructure-as-code.
- Stripe live billing testing (integration built; production keys not configured).

---

## Guiding Metrics by Phase

| Phase | North-star metric |
|---|---|
| Phase 1 (Core Platform) | Time idea → publish; compliance first-pass rate |
| Phase 2 (Shorts Studio) | Shorts published per active user; library import adoption |
| Phase 3 (Enterprise) | Org/team activation rate; referral conversion rate |
| Phase 4 (Media Pipeline) | End-to-end render-to-publish success rate; asset generation cost per video |
| Phase 5 (Automation) | Queue throughput reliability; auto-publish opt-in rate |
| Phase 6+ | Creator retention; videos published per active user; cross-channel lift |
