# features.md — AI CreatorForce

Feature reference organized by Core Engine. Each section covers: what the feature does, which agents and modules drive it, what it produces, and any compliance or quality guardrails. Build phasing (MVP / Beta / Launch) is in [build.md](build.md). Agent contracts are in [agents.md](agents.md). Pipeline sequencing is in [workflows.md](workflows.md).

---

## Related docs

- [project.md](project.md) — platform overview and golden rules
- [architecture.md](architecture.md) — module layout and job pipeline
- [agents.md](agents.md) — agent input/output schemas and provider config
- [workflows.md](workflows.md) — multi-step pipeline definitions
- [compliance.md](compliance.md) — compliance engine detail
- [youtube-publishing.md](youtube-publishing.md) — publishing gate
- [database.md](database.md) — Prisma schema reference

---

## Channel Workspace

Connect YouTube channels via Google OAuth (`channels` module, Google OAuth adapter in `ProviderRegistry`). On connection the API stores OAuth tokens encrypted at rest (`TOKEN_ENCRYPTION_KEY`) in `AccountLink`, and syncs the channel's video library into `LibraryVideo` and `LibraryPlaylist` models.

Each channel stores:
- **Niche profile** — target audience, content category, competitor channels
- **Voice profile** — tone, pacing, vocabulary preferences used as context for `ScriptAgent`
- **Brand kit** — colors, logo asset references, intro/outro preferences

Multi-channel is supported: a user or org can connect multiple channels, each with independent profiles. Channel list is surfaced in the sidebar; all downstream features (content pipeline, Shorts Studio) are scoped to the selected channel.

---

## Content Pipeline (long-form)

The core AI production line for long-form YouTube videos. Runs entirely as sequential BullMQ jobs on `AGENT_QUEUE`. Every step is stateless and idempotent.

**Sequence:**

```
ResearchAgent
  → ScriptAgent
  → FactCheckAgent
  → ComplianceAgent  ← hard gate
  → MetadataAgent
  → SEOAgent
  → [human approval via Approvals UI]
  → PublishingService → YouTube Data API
```

**Job types:** `RESEARCH`, `SCRIPT`, `FACT_CHECK`, `COMPLIANCE`, `METADATA`, `SEO_OPTIMIZATION`, `PUBLISH`.

**Key outputs:**
- Sourced research brief (URLs + summaries) stored in `AgentLog`
- `Script` model (sections: hook, body, CTA) with inline fact citations
- `ComplianceResult` with score (0–100) and `ComplianceFlag[]`
- Video title, description, tags, chapters (`MetadataAgent`)
- SEO-optimized title variants and keyword targeting (`SEOAgent`)
- `Approval` record created for human review
- YouTube video upload + metadata write on approval

**Compliance / quality guardrails:**
- `ComplianceAgent` must return `score >= 70` and no `BLOCK`-severity flags or the pipeline stops and the user is notified.
- `FactCheckAgent` rejects any script claim without a traceable source from `ResearchAgent`; the script is returned for revision, not silently passed.
- `QualityControlAgent` receives any agent output that fails Zod validation after `MAX_AGENT_RETRIES` attempts.

---

## Shorts Studio

Channel-first workflow for generating YouTube Shorts from existing long-form library videos. All operations are scoped to a selected channel.

**Import flow:** User explicitly selects videos via a picker modal (no automatic import). Selected videos become `ImportedVideo` records. Each imported video supports a `notes` field for per-video user reference context (surfaced as a sticky-note indicator in the UI).

**Analysis pipeline (per imported video):**
- Transcript ingested as `TranscriptSegment[]`
- Scene detection produces `VideoScene[]`
- Topic segmentation produces `TopicSegment[]`
- Chapter detection/import produces `Chapter[]` (`ChapterSource`: `DETECTED` | `IMPORTED`)
- Semantic search index built via `SemanticSearchService`

**Clip recommendations:** `ClipRecommendationService` scores segments by virality potential, topic coherence, and audience retention signals. Recommendations are ranked and displayed for user selection.

**Shorts generation:** `ShortsGenerationService` assembles selected clips into `ShortClip` records and stages them on a `ShortsTimeline`.

**Timeline editor:** Users edit clip order, trim points, and transitions on the `ShortsTimeline` model. An AI editing assistant (`AiEditingAssistantService`) accepts natural-language instructions and proposes timeline edits.

**Thumbnail generation:** AI-generated thumbnails via `ImageAgent`; user selects from candidates.

**Social content factory:** `SocialContent` model supports output types `QUOTE_CARD` | `CAROUSEL` | `BLOG_POST` | `NEWSLETTER`. Quote cards are rendered server-side. Content is generated from the same transcript/topic data as the Short.

**Chapter sync:** Detected/confirmed chapters can be written back to YouTube via the YouTube Data API (chapter timestamps in video description).

**Export and publish:** Export path goes through the same `ComplianceAgent` gate and `Approvals` flow as long-form content. `PublishingService` requires `Approval.status = 'APPROVED'` before upload.

**Job types (Shorts-specific):** `SHORTS_ANALYZE` plus dedicated Shorts Studio job types enumerated in the `JobType` Prisma enum.

---

## Trend and Discovery

Surfaces content opportunities and keyword gaps for a channel.

**Agents:** `TrendAgent`, `SEOAgent`, `AudienceAgent`.

**Job types:** `TREND_ANALYSIS`, `SEO_OPTIMIZATION`, `AUDIENCE_ANALYSIS`.

**Key outputs:**
- Trending topic clusters with velocity scores (`TrendAgent`)
- Keyword gap analysis and search volume estimates (`SEOAgent`)
- Audience persona analysis and retention insight (`AudienceAgent`)

Results are stored in `AgentLog` and surfaced in the Trend and Discovery dashboard. No content is published from this engine; outputs feed into content project creation.

---

## Media Pipeline

AI-generated media assets attached to a content project. Each asset type runs as an independent BullMQ job.

### Voice

`VoiceAgent` (job types: `VOICE_SPEC`, `VOICE_GENERATE`). Generates a voice specification from the script and channel voice profile, then calls the configured voice provider to produce audio. Output stored as an `Asset`/`AssetVersion` with R2 storage key.

### Image (b-roll)

`ImageAgent` (job types: `IMAGE_BRIEF`, `IMAGE_GENERATE`). Generates a visual brief per script section, then calls the configured image provider. Used for b-roll and thumbnails. Each image is an `AssetVersion` with provenance metadata (provider, prompt hash, generation timestamp).

### Music

`MusicAgent` (job types: `MUSIC_BRIEF`, `MUSIC_GENERATE`). Generates a music brief (mood, tempo, key, duration) from script context, then calls the configured music provider (Suno/Udio/Stable Audio — placeholder integration). Output is an audio `AssetVersion`.

### Video

`VideoAgent` (job types: `VIDEO_SCENE_PLAN`, `VIDEO_GENERATE`). Generates a scene-by-scene video plan from the script, then calls the configured video provider (Veo/Kling/Runway/Pika/Luma — placeholder integration). Scene plans are stored in `AgentLog`; generated video files would be stored as `AssetVersion` records.

### Subtitles

`SubtitleAgent` (job type: `SUBTITLE_GENERATE`). Generates SRT/VTT subtitle files from voice audio transcript. Output is an `AssetVersion`.

### Edit Plan

`EditPlanAgent` (job type: `EDIT_PLAN`). Generates a structured edit plan (cut list, B-roll placement, transition notes) used as input to the render pipeline.

### Render Pipeline

`Timeline` model assembles ordered `Asset` references with in/out points. `RenderPreset` options: `DRAFT_PROXY` | `YT_1080P` | `YT_4K` | `SHORTS_1080X1920`. ffmpeg-static executes the render job (job type: `RENDER`). Output is a `Render` record with the final video file key in R2. `FULL_PRODUCTION` job type orchestrates the complete Voice → Image → Music → Video → Subtitle → Render sequence.

**Asset versioning:** Every generated file creates a new `AssetVersion` record (not an overwrite). Versions track provider, model, prompt hash, and timestamp for full provenance.

---

## Analytics

**Agent:** `AnalyticsAgent`.

**Job types:** `ANALYTICS`, `GROWTH_REPORT`.

**Modules:** `analytics`, `bi`.

The `analytics` module polls YouTube Analytics API on a configurable schedule and writes `AnalyticsSnapshot` records (JSON metrics blob: views, watch time, CTR, revenue, audience retention). The `bi` module exposes aggregated queries for dashboard charts and growth trend lines.

`AnalyticsAgent` interprets snapshot data and produces natural-language performance summaries and actionable recommendations, stored in `AgentLog`.

---

## Billing and Credits

**Module:** `billing`, `wallet`.

**Models:** `Subscription`, `Wallet`, `CreditLedger`, `CreditLot`, `CreditReservation`, `Payment`, `BudgetPeriod`.

**Wallet** is polymorphic: owned by either a `User` or an `Organization`. Credit operations are append-only entries in `CreditLedger` — the ledger is never updated in place.

**CreditLot** — a bucket of credits with an expiry date and a `lotType`: `PROMOTIONAL` | `BONUS` | `REFERRAL` | `PURCHASED` | `TRIAL`. Lots are consumed oldest-first.

**CreditReservation** — holds credits against a pending job (prevent overspend), then settles (actual cost) or releases (on failure) when the job completes.

**Subscription** tiers: `FREE` | `STARTER` | `PRO` | `AGENCY`. Stripe manages subscription lifecycle; the `billing` module handles webhooks and writes `Payment` records.

**BudgetPeriod** — per-org or per-team monthly spend cap. `BudgetService` enforces the cap before enqueueing expensive media jobs.

**Controllers:** `billing.controller` (user-facing billing UI), `billing-admin.controller` (internal ops), `wallet.controller` (credit balance, ledger history).

---

## Organizations and Teams

**Module:** `orgs`.

**Models:** `Organization`, `OrgMembership`, `Team`, `TeamMembership`.

An `Organization` is the top-level billing and access boundary. Users belong to an org via `OrgMembership` with roles: `ORG_ADMIN` | `TEAM_MANAGER` | `BILLING_ADMIN` | `MEMBER`.

`Team` is a sub-group within an org. `TeamMembership` roles: `OWNER` | `ADMIN` | `EDITOR` | `REVIEWER` | `VIEWER`. Teams can be scoped to specific channels or content projects.

Orgs share a single `Wallet`; credit spend is attributed to the acting user in `CreditLedger`. `BudgetPeriod` can be set at org or team level.

---

## Trial and Growth Engine

**Modules:** `trial`, `growth`.

**Models:** `TrialGrant`, `ReferralCode`.

New users receive a `TrialGrant` which seeds a `TRIAL`-type `CreditLot` in their wallet. `TrialLimitsService` enforces per-feature usage caps during trial. On upgrade, trial limits are lifted and the credit lot is converted or topped up per plan.

`ReferralCode` allows existing users to invite others. Successful referral activations credit both referrer and referee via `REFERRAL`-type `CreditLot` entries.

`MarketplaceService` and `OffersService` handle promotional credit grants and upsell flows. `GrowthReportAgent` (job type: `GROWTH_REPORT`) surfaces channel growth trends and monetization recommendations.

---

## Developer Portal

**Modules:** `dev-portal`, `dev-api`.

**Models:** `DeveloperKey`, `DeveloperWebhook`.

Registered developers obtain `DeveloperKey` records (hashed secret, scopes, rate limit tier). API requests authenticated with a developer key pass through `DeveloperKeyGuard`.

`DeveloperWebhook` records define delivery endpoints for platform events (job completed, compliance result, approval decision). Webhook delivery runs as a BullMQ job to guarantee at-least-once delivery with retries and exponential backoff.

`DevApiController` exposes a versioned external REST API surface distinct from the internal API used by the web frontend.

---

## Notifications

**Module:** `notifications`.

**Model:** `Notification`.

In-app and push notifications for: job completion, compliance failure, approval request, billing event, referral activation. `NotificationsController` exposes read/mark-read endpoints. Real-time delivery uses the existing Socket.io gateway.

---

## Admin (internal ops)

**Modules:** `admin-jobs`, `flags`, `ai-ops`, `metrics`, `health`.

**Models:** `SystemConfig`, `AuditLog`, `PromptVersion`.

`AdminJobsController` allows internal staff to inspect, retry, or cancel any `AgentJob`. `flags` module provides feature flag evaluation backed by `SystemConfig`. `ai-ops` module manages `PromptVersion` records (create, activate, rollback) and AI provider configuration without redeploys. `AuditLog` records all state-changing administrative actions with actor, timestamp, and before/after snapshot.

---

## Copilot

**Modules:** `copilot`, `intents`, `token-usage`.

An AI assistant embedded in the platform UI. `CopilotController` accepts free-text queries; `IntentsController` classifies intent and routes to the appropriate agent or data query. `TokenUsageController` surfaces per-user and per-org AI token spend for transparency and billing reconciliation.

---

## Compliance Engine

**Module:** `compliance`.

**Models:** `ComplianceResult`, `ComplianceFlag`.

`ComplianceService.enforce(content)` is the hard gate called before any content reaches `PublishingService`. Internally:

1. Computes SHA-256 hash of the content.
2. Checks Redis cache (24-hour TTL) for a prior result on the same hash.
3. On cache miss, calls `callAIStructured` with the compliance prompt and validates against `ComplianceResultSchema` (Zod).
4. Writes `ComplianceResult` and `ComplianceFlag[]` to the database.
5. `mustPassCompliance()` returns `false` if `score < 70` or any flag has `severity = 'BLOCK'`.
6. `enforce()` throws `BadRequestException` on failure — there is no path to proceed.

Cache keying means identical content is never re-evaluated within 24 hours. `bypassCache: true` is available for forced re-evaluation (admin only).

---

## Planned / not yet implemented

| Feature | Status |
|---|---|
| n8n workflow automations | n8n/ folder exists; runtime not deployed |
| Video file generation via Veo/Kling/Runway/Pika/Luma | Placeholder in VideoAgent and PublishingService; provider APIs not integrated |
| Music file generation via Suno/Udio/Stable Audio | Placeholder in MusicAgent; provider APIs not integrated |
| Full media render pipeline end-to-end | ffmpeg-static present, RenderPreset defined; render worker not fully wired to video providers |
| i18n beyond English | `targetLang` on `Project` model exists; multi-language agent pipeline not wired |
| Accessibility audit tooling | `apps/e2e/a11y.spec.ts` exists; not integrated into CI |
| Stripe production keys | Billing module wired to Stripe; test keys only |
| Multi-region deployment | Single-region only; horizontal BullMQ worker scaling not provisioned |
