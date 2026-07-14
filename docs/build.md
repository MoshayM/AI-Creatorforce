# build.md — AI CreatorForce

This file describes what IS built and what is NOT YET built in the AI CreatorForce platform, along with development setup. It is a current-state reference, not a forward-looking plan — for the strategic phase plan see [roadmap.md](roadmap.md), for dependency and package details see [techstack.md](techstack.md), and for test tooling see [testing.md](testing.md).

---

## Implementation Status

### Built and Shipped (as of 2026-07)

#### Core Infrastructure

- NestJS API with 40+ modules (one module per engine, per CLAUDE.md §5).
- Prisma schema with all models including polymorphic wallet, audit log, and asset versioning.
- BullMQ job queue (`AGENT_QUEUE`) with async job processors.
- Socket.io real-time gateway for job progress push.
- Prometheus metrics + Grafana monitoring stack.
- GitHub Actions CI: lint, typecheck, unit tests, build, security audit (Semgrep SAST, ZAP DAST), E2E (cross-browser matrix).

#### Auth and Security

- Email/password auth with bcrypt.
- OAuth (Google, Apple, Facebook) with encrypted token storage.
- JWT + rotating refresh tokens (`AuthSession` model).
- RBAC with env-configured super admin.
- Helmet + CSP security headers.
- Semgrep SAST (`.semgrep/creatorforce.yml`) + ZAP DAST (`.zap/plan.yaml`) in CI.
- Audit log.

#### Content Pipeline (Long-Form)

- Full agent pipeline: Research → Script → FactCheck → Compliance → Metadata → SEO → Approval → Publish.
- `ComplianceService` with content hash cache.
- Human approval gate (`Approval` model, strict check in `PublishingService`).
- YouTube Data API publish (requires `videoFilePath` supplied by the user — see note under "Not Yet Built").
- All job types present in `AgentJob.type` enum.

#### Shorts Studio

- Channel-first flow: select channel → library picker → import videos.
- `ImportedVideo` model with per-video user reference notes.
- `TranscriptAnalysis`, `SceneDetection`, `TopicSegmentation`.
- Chapter detection (AI) and chapter import from YouTube.
- Clip recommendations.
- Shorts generation.
- `ShortsTimeline` editor (drag-drop clip ordering).
- AI editing assistant (apply commands + assist capability).
- Thumbnail generation.
- Semantic search.
- Social content factory (`QUOTE_CARD` / `CAROUSEL` / `BLOG_POST` / `NEWSLETTER`).
- Quote card render.
- Chapter sync to YouTube description.
- Export + publish flow.

#### Media Pipeline (partial)

- Voice, Image, Music, Video, Subtitle agents implemented.
- `Asset` / `AssetVersion` model with versioning.
- `Timeline` model with tracks (JSON).
- `Render` model with `RenderPreset`: `DRAFT_PROXY` / `YT_1080P` / `YT_4K` / `SHORTS_1080X1920`.
- `ffmpeg-static` present.
- `EditPlanAgent`.

#### Billing and Credits

- Wallet (polymorphic: user + org).
- `CreditLedger` (append-only).
- `CreditLot` (bucket expiry priority).
- `CreditReservation` (reserve-settle pattern).
- Stripe subscription tiers: `FREE` / `STARTER` / `PRO` / `AGENCY`.
- `BudgetService` (hard cap enforcement).
- `CreditInsightsService`.

#### Organizations and Teams

- `Organization` + `OrgMembership`.
- `Team` + `TeamMembership`.
- `BudgetPeriod` (org/team credit allocation).
- Org shared wallet.

#### Trial and Growth Engine

- `TrialGrant` + trial credit bucket.
- `ReferralCode` + referral credit grants.
- `TrialLimitsService`.
- `UpgradeEngineService`.
- `MarketplaceService` + `OffersService`.
- `GrowthReportJob`.

#### Developer Portal

- `DeveloperKey` + `DeveloperWebhook` models.
- External API (`dev-api.controller.ts`) authenticated by developer key.
- Webhook delivery job.
- Developer key guard.

#### Analytics

- `AnalyticsSnapshot` model.
- `AnalyticsAgent` + `GrowthAgent` + `AudienceAgent`.
- BI module.
- YouTube stats polling post-publish.

#### Copilot

- `CopilotController` + `IntentsController`.
- `TokenUsageController`.

---

### Not Yet Built (Planned)

- **n8n workflow runtime deployment.** The `n8n/` folder contains exported workflow definitions but no deployed instance. Required for long human-paused automations (e.g., full WF-1 with checkpoints).
- **In-app video file generation.** `PublishingService.publish()` requires a user-supplied `videoFilePath`. In-app video generation from the render pipeline to a YouTube-ready file is a Phase 4 feature (noted in code comments).
- **External video generation provider integrations.** `AssetVersion.provider` field is ready; Veo/Kling/Runway/Pika/Luma integrations are not wired.
- **External music generation providers.** Suno/Udio/Stable Audio integrations not wired.
- **Cloudflare R2 storage wiring.** `r2Key` field exists on `AssetVersion`; the R2 SDK is not integrated.
- **Production deployment infrastructure.** No Kubernetes manifests, Vercel config, or production Docker Compose. Staging environment does not exist yet.
- **Stripe production keys and live billing.** Stripe integration is built; production keys and live billing testing are not done.
- **Multi-region deployment.**
- **Additional AI provider support.** `aiClient` currently supports primary + fallback; DeepSeek/Grok/Mistral/Ollama/OpenRouter are not implemented.
- **Full prompt migration to `packages/prompts`.** Some agent system prompts remain inline in code.
- **i18n beyond English.** `targetLang` field exists on the `Project` model; the UI layer is not wired.
- **Per-flag compliance appeal workflow.**

---

## Development Setup

```bash
# Install dependencies
pnpm install

# Copy and fill environment variables
cp .env.example .env
# Required: DATABASE_URL, REDIS_URL, JWT_SECRET, TOKEN_ENCRYPTION_KEY (min 32 chars), AI provider keys

# Run database migrations
pnpm --filter @cf/api exec prisma migrate dev

# Start all apps (web + api)
pnpm dev
```

Default ports: web on 3007, API on 4007.
