# api.md — AI CreatorForce

## 1. Conventions

- **Base URL:** `/api/v1`
- **Format:** JSON. `Content-Type: application/json`.
- **Auth:** session cookie (Auth.js) for the web app; `Authorization: Bearer <JWT>` for service/API access. See `security.md`.
- **Validation:** every request body/query validated with Zod; 422 on failure with field errors.
- **Async pattern:** long operations return `202 Accepted` with a `jobId`; clients poll `GET /jobs/:id` or subscribe over WS/SSE.
- **Idempotency:** mutating endpoints accept an `Idempotency-Key` header.
- **Pagination:** cursor-based — `?cursor=&limit=` → `{ data, nextCursor }`.
- **Errors:** consistent envelope.

```jsonc
// Error envelope
{
  "error": {
    "code": "COMPLIANCE_BLOCKED",
    "message": "Content blocked by compliance gate.",
    "details": [{ "field": "script", "reason": "Unverified factual claim at 02:14" }],
    "correlationId": "req_01H..."
  }
}
```

Standard codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `RATE_LIMITED`, `BUDGET_EXCEEDED`, `COMPLIANCE_BLOCKED`, `PROVIDER_ERROR`, `CONFLICT`, `INTERNAL`.

## 2. Auth & Account

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/register` | Email sign-up → `{ accessToken, refreshToken }` |
| POST | `/auth/login` | Email sign-in → `{ accessToken, refreshToken }` |
| POST | `/auth/refresh` | Rotate refresh token (single-use; reuse revokes the whole session family) |
| POST | `/auth/logout` | Revoke current session (server-side; access token dies immediately) |
| GET | `/auth/sessions` | List active sessions (device, ip, `current` flag) |
| DELETE | `/auth/sessions/:id` | Revoke a session family |
| GET | `/auth/providers` | Which social providers are configured (`google`/`apple`/`facebook`) |
| POST | `/auth/:provider/start` | Begin OAuth (PKCE + state + nonce); `mode: 'link'` attaches to signed-in user |
| POST | `/auth/:provider/callback` | Exchange code → sign-in tokens, `{ linked: true }`, or 409 `LINK_REQUIRED` |
| POST | `/auth/apple/return` | Apple form_post landing → 302 back to the SPA callback |
| GET | `/auth/links` | Linked sign-in methods for the current user |
| DELETE | `/auth/link/:provider` | Unlink a method (409 if it is the last one) |
| GET | `/me` | Current user + plan + usage |
| GET | `/me/usage` | Token/credit usage vs limits |

See `Docs3/Updates/15_Authentication.md` for flows, linking rules, and session semantics.

## 3. Channels (YouTube)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/channels` | List connected channels |
| POST | `/channels/connect` | Start YouTube OAuth connect flow |
| GET | `/channels/oauth/callback` | OAuth redirect handler |
| DELETE | `/channels/:id` | Disconnect & revoke tokens |
| GET | `/channels/:id` | Channel details + sync status |

### 3.1 Channel Library (synced, cursor-paginated — `Updates/08`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/channels/:id/sync` | Enqueue resumable full-library sync → `{ jobId }` (idempotent per channel) |
| GET | `/channels/:id/sync-status` | Sync phase + progress (`VIDEOS`/`PLAYLISTS`/`DONE`/`ERROR`, cursors persisted per page) |
| GET | `/channels/:id/videos?cursor=&q=&type=&sort=` | Keyset-paginated videos → `{ data, nextCursor }` (never OFFSET) |
| GET | `/channels/:id/playlists?cursor=` | Synced playlists |
| GET | `/channels/:id/playlists/:pid/items?cursor=` | Playlist items in position order |
| PATCH | `/channels/:id/playlists/:pid/order` | Persist local reorder `{ itemIds }` |

## 4. Trend Intelligence

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/trends/discover` | Run discovery → `202 {jobId}` |
| GET | `/trends/board` | Latest scored opportunity board |
| GET | `/trends/:topicId` | Topic detail + scores + rationale |
| POST | `/trends/:topicId/promote` | Promote topic into a project |

## 5. SEO Intelligence

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/seo/keywords` | Keyword discovery |
| POST | `/seo/metadata` | Generate metadata draft |
| POST | `/seo/score` | Score given metadata |

## 6. Audience Intelligence

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/audience/profile` | Build audience profile |
| POST | `/audience/hooks` | Generate hook variants |
| POST | `/audience/retention` | Retention strategy |

## 7. Content Intelligence

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/content/research` | Run ResearchAgent → research pack |
| POST | `/content/script` | Generate script → `202 {jobId}` |
| POST | `/content/factcheck` | Fact-check a script |
| GET | `/content/:projectId/script` | Fetch current script |
| PATCH | `/content/:projectId/script` | Edit script (triggers WF-7 re-review) |

## 8. Compliance

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/compliance/review` | Run compliance gate on a bundle |
| GET | `/compliance/:projectId` | Latest compliance report |

Response includes `complianceScore`, `monetizationRisk`, `copyrightRisk`, `recommendation`, and `flags[]`.

## 9. Music Intelligence

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/music/brief` | Generate music brief/prompt |
| POST | `/music/generate` | Trigger generation job (Suno/Udio/Stable Audio) |
| GET | `/music/:assetId` | Asset status + R2 reference |

## 10. Video Intelligence

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/video/sceneplan` | Scene plan + shot list |
| POST | `/video/prompts` | Provider prompts (Veo/Kling/Runway/Pika/Luma) |
| POST | `/video/generate` | Trigger video generation job |
| GET | `/video/:assetId` | Asset status + R2 reference |

## 11. Thumbnail Intelligence

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/thumbnails/concepts` | Generate concepts + prompts |
| POST | `/thumbnails/generate` | Generate variants |
| POST | `/thumbnails/:projectId/select` | Choose A/B winner |

## 12. Metadata & Publishing

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/metadata/finalize` | Produce publish-ready metadata + disclosures |
| POST | `/publish` | Publish/schedule (gate-checked) → `202 {jobId}` |
| GET | `/publish/:projectId` | Publish receipt/status |
| POST | `/publish/:projectId/schedule` | Set/update schedule |

`POST /publish` returns `409 COMPLIANCE_BLOCKED` or `409 APPROVAL_REQUIRED` if gates unmet.

## 13. Analytics & Growth

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/analytics/:channelId/overview` | Channel KPIs |
| GET | `/analytics/video/:videoId` | Per-video diagnostics |
| POST | `/growth/report` | Generate growth report |
| GET | `/growth/recommendations` | Next-video recommendations |

## 14. Projects & Jobs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/projects` | List content projects |
| POST | `/projects` | Create project |
| GET | `/projects/:id` | Project detail (full bundle + state) |
| POST | `/projects/:id/run` | Run a workflow (full/script/assets/publish) |
| GET | `/jobs/:id` | Job status/result |
| GET | `/jobs?projectId=` | Jobs for a project |

## 15. Billing

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/billing/plan` | Current plan |
| POST | `/billing/checkout` | Stripe checkout session |
| POST | `/billing/portal` | Stripe customer portal |
| POST | `/billing/webhook` | Stripe webhook (signature-verified) |

## 16. Realtime

- **WebSocket:** `/ws` — subscribe to `project:{id}` and `job:{id}` channels for status, progress, and agent trace events.
- **SSE fallback:** `GET /projects/:id/stream`.

Event shape:
```jsonc
{ "type": "job.progress", "jobId": "...", "step": "compliance", "status": "running", "progress": 0.4 }
```

## 17. Rate Limits & Budgets

- Per-user request rate limits (Redis token bucket) returned via `X-RateLimit-*` headers.
- AI/video/music generation checks plan budget before dispatch; `402/409 BUDGET_EXCEEDED` if insufficient. See `monetization-framework.md`.

## 18. Webhooks (outbound, optional for agencies)

`project.completed`, `publish.succeeded`, `publish.failed`, `compliance.blocked` — signed with an HMAC secret.

## 19. Versioning

URI-versioned (`/api/v1`). Breaking changes ship under a new version; deprecations announced via `Deprecation` and `Sunset` headers.

## 20. Shorts Studio

Module spec: repo-root `ai.md`. All routes prefixed `/shorts-studio`, JWT-guarded, ownership-checked per project.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/shorts-studio/channels/:channelId/videos` | Page through the channel's uploads (`?pageToken=`) |
| GET | `/shorts-studio/videos/:youtubeVideoId/metadata` | Fetch metadata without importing (`?channelId=`) |
| POST | `/shorts-studio/videos/import` | `{ projectId, youtubeVideoId }` → ImportedVideo |
| GET | `/shorts-studio/projects/:projectId/videos` | List imported videos with analysis counts |
| POST | `/shorts-studio/videos/:id/analyze` | Enqueue the SHORTS_ANALYZE pipeline (import → transcript → scenes → topics → highlights → chapters → embeddings) |
| GET | `/shorts-studio/videos/:id/analysis-status` | Aggregated per-stage status + output counts |
| GET | `/shorts-studio/videos/:id/transcript` | TranscriptSegment[] |
| GET | `/shorts-studio/videos/:id/scenes` | VideoScene[] |
| GET | `/shorts-studio/videos/:id/topics` | TopicSegment[] with highlight scores |
| GET | `/shorts-studio/videos/:id/highlights` | Highlight[] ranked by finalScore |
| GET | `/shorts-studio/videos/:id/recommendations` | Top-N clip recommendations (`?limit=5\|10\|20`, no AI call) |
| GET | `/shorts-studio/videos/:id/chapters` | Chapter[] — contiguous YouTube-style chapters (Ai-video edit.md §5, Phase 5) |
| POST | `/shorts-studio/videos/:id/detect-chapters` | Enqueue standalone CHAPTER_DETECTION (for videos analyzed before chapters shipped; self-skips if chapters exist) |
| PATCH | `/shorts-studio/chapters/:chapterId` | `{ title?, summary? }` — manual edit, sets `editedByUser` so re-detection keeps it |
| GET | `/shorts-studio/videos/:id/search` | NL search over transcript embeddings (`?q=&limit=`): top matches with timestamps, chapter context, cosine score. One embedding call per query, no LLM |
| GET | `/shorts-studio/search` | Cross-video library search (`?q=`): matches grouped per video, ranked by best moment (§11) |
| POST | `/shorts-studio/social-content/:id/render-quote-card` | Render a QUOTE_CARD to a 1080×1080 PNG (IMAGE asset); idempotent; file via `GET /media/versions/:versionId/file` |
| POST | `/shorts-studio/videos/:id/generate-embeddings` | Enqueue standalone EMBEDDING_GENERATION (resumable — only un-embedded segments are sent) |
| POST | `/shorts-studio/videos/:id/small-videos` | Batched chapter → SMALL_VIDEO candidates (16:9, 1–10 min, zero AI); same clip/timeline/render/export path as Shorts. Chapters under 60s are skipped |
| POST | `/shorts-studio/videos/:id/church-pack` | Enqueue CHURCH_PACK_GENERATION: bible refs + discussion questions + devotional per chapter, ONE batched LLM call (§11/§12.4). Chapters with a devotional are skipped on re-run; results ride on `GET .../chapters` |
| POST | `/shorts-studio/videos/:id/sync-chapters` | Publish the "0:00 Title" chapter block into the live YouTube description (replaces an existing block, keeps the rest). Needs ≥3 chapters; sets `chaptersSyncedAt`. CHAPTER_DETECTION also runs the reverse: a description that already defines chapters is imported as `source: IMPORTED` at zero tokens |
| GET | `/shorts-studio/videos/:id/social-content` | SocialContent[] — quote cards, carousel, blog post, newsletter (§10) |
| POST | `/shorts-studio/videos/:id/social-content` | Enqueue SOCIAL_CONTENT_GENERATION: the full text pack in ONE batched call over chapters + top highlights (+ their transcript excerpts, so quotes are verbatim). Self-skips when content exists |
| POST | `/shorts-studio/highlights/:id/generate-clips` | `{ clipTypes: ClipType[] }` → candidate ShortClip[] + seeded timelines |
| GET | `/shorts-studio/projects/:projectId/clips` | List ShortClip[] for a project |
| GET | `/shorts-studio/videos/:id/clips` | List ShortClip[] for one imported video |
| GET | `/shorts-studio/clips/:id/timeline` | Timeline with tracks + items + captions + source asset refs |
| PATCH | `/shorts-studio/timelines/:id` | `{ commands: TimelineCommand[] }` — TRIM/SPLIT/DELETE/MERGE/DUPLICATE/MOVE/RESIZE/CUT_RANGE, audited |
| POST | `/shorts-studio/timelines/:id/ai-suggestions` | `{ capability }` → proposed TimelineCommand[] (remove-silence \| remove-fillers \| improve-pacing) |
| POST | `/shorts-studio/timelines/:id/ai-suggestions/apply` | Apply reviewed suggestions (audited as AI_ASSISTANT) |
| GET | `/shorts-studio/timelines/:id/history` | ShortsTimelineEdit audit trail |
| POST | `/shorts-studio/clips/:id/captions` | Enqueue CAPTION_GENERATION job (transcript → styled ShortsCaption rows) |
| POST | `/shorts-studio/clips/:id/render` | Enqueue SHORTS_RENDER job (reframe + concat + caption burn-in, NVENC w/ CPU fallback) |
| GET | `/shorts-studio/clips/:id/render-status` | ShortsRenderJob status + rendered asset ref |
| GET | `/shorts-studio/clips/:id/thumbnails` | Thumbnail variations (generated automatically after first render) |
| POST | `/shorts-studio/thumbnails/:id/set-primary` | Pick the primary thumbnail |
| POST | `/shorts-studio/clips/:id/export` | Enqueue SHORTS_EXPORT (render + metadata.json + thumbnail ref → SHORTS_FINAL_EXPORT package) |
| GET | `/shorts-studio/clips/:id/exports` | ShortsExportHistory[] |
| POST | `/shorts-studio/clips/:id/request-publish` | Create the human-approval gate on the export (reviewed on /approvals) |
| POST | `/shorts-studio/clips/:id/publish` | Enqueue SHORTS_PUBLISH — requires APPROVED approval; job re-runs the compliance gate before YouTube upload |
| GET | `/shorts-studio/clips/:id/publish-status` | Approval + publish job state + youtubeVideoId |

Pipeline stages run as child `AgentJob`s of the `SHORTS_ANALYZE` root and self-skip when their output rows already exist (resume semantics, `ai.md` §16). Requires `yt-dlp` (`YT_DLP_PATH`) for source download; Whisper ASR fallback uses `OPENAI_API_KEY`.


## 21. Copilot, Intents & Token Governor

Spec: repo-root `Ai-video edit.md` (§8, §12, §15) — one execution path for UI, chat, and voice; plan/status in `docs/video-hub.md`. All routes JWT-guarded.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/copilot/chat` | Conversational turn: `{ messages, inputMode?: 'text'\|'voice', confirmedCommand?, pendingCommand? }` → `{ reply, language, executed?, needsConfirmation?, fromCache?, tokensUsed? }`. Repeated phrases resolve from the intent cache (zero tokens); confirmation-gated commands (`EXPENSIVE_ACTIONS`) always return `needsConfirmation` first. |
| POST | `/intents` | Unified UI entry point: `{ command: CopilotCommand, confirmed?: boolean }` → ActionResult `{ intentId, status: 'executed'\|'needs_confirmation', fromCache, tokensUsed, payload }`. Same executor, gates, and audit trail as chat/voice — intent parity by construction. |
| GET | `/intents/:id` | Fetch the ActionRecord audit row for an executed intent (owner-scoped). |
| GET | `/token-usage/summary` | `?days=30` → total tokens/cost, per-model breakdown (all AI calls in the process, agents included), copilot cache-hit rate (§12.3 target ≥80%), and `byVideo` — top-15 per-video cost rows (§12.2.8). Feeds the Analytics "AI Usage" card + cost-by-video table. |

## 22. Wallet, Recharge & Admin (billing spec)

Spec: `docs2/AI-CreatorForce-Billing-Payment-Security-Spec.md`; plan/status in `docs/billing-security.md`. JWT-guarded; admin routes additionally require RBAC permissions (`common/rbac.ts`).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/wallet/balance` | Balance + bucket breakdown (promo/bonus/referral/purchased) |
| GET | `/wallet/transactions` | Credit-ledger entries (`?take=`) |
| POST | `/wallet/recharge` | `{ amountUsd, successUrl, cancelUrl }` + mandatory `Idempotency-Key` header → Stripe Checkout URL. Credits granted only by the verified webhook |
| GET | `/admin/billing/revenue` | `admin:revenue` — gross/credits by gateway |
| GET | `/admin/audit-logs` | `admin:audit-logs` |
| GET | `/admin/users` | `admin:users` — roles + wallet/plan |
| POST | `/admin/wallet/adjust` | `wallet:adjust` — grant/claw back credits with reason; audited with before/after |
| POST | `/admin/payments/:id/refund` | `billing:refund` — full/partial Stripe refund with proportional credit claw-back (clamped to balance, shortfall recorded); audited |
| POST | `/admin/users/:id/recharges-frozen` | `admin:users` — lift/apply the §7 dispute recharge freeze; audited |
| GET | `/admin/providers` | `admin:providers` — AI provider registry: status, health score, failure rate, current cost rates, recent health events (Phase 5 §5) |
| GET/POST/PATCH | `/admin/pricing-rules` | `admin:pricing` — credit pricing rules, most-specific-wins; create/update rejected below `MIN_PROFIT_MARGIN` (fail closed); audited. Rule prices are locked at reservation time |
| POST | `/admin/profit/preview` | `admin:pricing` — margin verdict for a hypothetical `{action, creditCost}` (Phase 5 §8) |
| GET | `/trial/status` | Trial grant status, remaining trial credits, expiry (Phase 6 §5) |
| GET | `/trial/limits` | Effective trial-tier restrictions + whether they apply to me |
| GET/PATCH | `/admin/trial-config` | `admin:trial` — trial credits/expiry + per-feature limits; audited |
| GET | `/admin/abuse-signals` | `admin:trial` — fingerprint/IP abuse decisions (Phase 6 §6) |
| POST | `/admin/trial/:userId/approve` | `admin:trial` — grant a PENDING_REVIEW trial after manual review |
| GET | `/upgrade/recommendations` | Behavior-driven upgrade nudges (frequency-capped); refreshes on read (Phase 6 §8) |
| POST | `/upgrade/recommendations/:id/dismiss` | Dismiss a nudge (suppresses that reason for 14 days) |
| GET/POST | `/admin/offers` | `admin:trial` — campaigns (FIRST_RECHARGE/WELCOME/LOYALTY/WINBACK/LOW_CREDIT with `targetRule`); creation margin-gated (fail closed); grants double-idempotent (Phase 6 §9/§10.1) |
| GET | `/offers` | My Offer Center: active campaigns I qualify for (behavior-targeted) |
| POST | `/offers/:id/redeem` | Redeem a direct-grant offer (idempotent per user); recharge-attached offers apply automatically at settle |
| GET | `/marketplace/packs` | Credit packs (`?region=` filters; global packs always included) (Phase 6 §12) |
| GET/POST/PATCH | `/admin/credit-packs` | `admin:pricing` — packs; creation margin-gated on real credit economics; audited |
| GET/PUT | `/wallet/budget` | Per-user monthly budget: limit, alert threshold, hard cap. Hard cap enforced fail-closed inside `WalletService.reserve()` (`Updates/10` §Budgets) |
| GET | `/wallet/usage-summary?days=` | Month/period spend grouped by action intent |
| GET | `/wallet/forecast?days=` | Window-average burn projection: daily burn, days-to-empty, projected month-end spend (`Updates/10` Phase 2) |
| GET | `/wallet/recommendations` | Rule-based optimization tips: budget pace, low balance, expiring lots, dominant action, cache-hit rate |
| POST | `/orgs` | Create organisation — caller becomes ORG_ADMIN; org shared wallet provisioned in the same transaction (Phase 5 §10) |
| GET | `/orgs/mine` | My orgs with my role in each |
| GET/POST | `/orgs/:id/members` | List members (with email/name) / add-or-update by email (MANAGE_ORG); roles ORG_ADMIN, BILLING_ADMIN, TEAM_MANAGER, MEMBER + `approvalRequired`; `teamId` validated against the org (Wave 8) |
| GET/POST | `/orgs/:id/teams` | List teams (any member) / create a team (MANAGE_ORG) — teams scope budget periods and member assignment (Wave 8) |
| GET/PUT | `/orgs/:id/budget?teamId=` | Current budget-period status + org balance / create a period (MANAGE_BUDGET); hard cap blocks spend at exhaustion; `teamId` validated against the org (Wave 8) |
| GET | `/orgs/:id/reports/usage?from=&to=&teamId=&format=json\|csv` | Per-member usage rollup (VIEW_REPORTS) |
| GET | `/dev/usage?days=` | Per-developer-key request analytics: totals + sparse per-day counts, last `days` UTC days (default 30, clamped 1–90) (Wave 10) |
| GET | `/api/dev-docs` (+ `-json`) | Public developer-API OpenAPI doc, served in every environment — `-json` is the SDK-generation source (Wave 10) |
| POST | `/referral/code` | Get-or-create my referral code (deterministic, 8-char) (Phase 6 §10.2) |
| POST | `/referral/redeem` | Apply a code once (self/duplicate/inactive rejected); registration auto-applies `?ref=` codes |
| GET | `/referral/earnings` | My code, totals, per-referral status (PENDING→QUALIFIED on first recharge→REWARDED; FLAGGED withheld on shared-fingerprint fraud) |
| GET | `/referral/leaderboard` | Top referrers (masked emails) |
| GET/POST | `/admin/referrals` | `admin:trial` — review queue; `POST /admin/referrals/:id/review` approves (idempotent replay of payout) or rejects |
| GET | `/notifications` | In-app notifications (`?unreadOnly=`) + unread count; 24h dedupe window (Phase 6 §15) |
| POST | `/notifications/:id/read` / `/notifications/read-all` | Mark read (204) |
| GET | `/admin/analytics/conversion-funnel` | `admin:trial` — signups → trials → first recharge → subscription with conversion percentages (Phase 6 §14) |
| POST | `/admin/routing/simulate` | `admin:pricing` — dry-run provider routing: ranked candidates, est. cost/credits, would-route verdict; no spend (Phase 5 §16) |

AI cost controls (Phase 5 §6/§12): deterministic `callAI` calls and all embeddings are served cache-first from Redis (`AI_RESPONSE_CACHE_ENABLED`, TTLs via `AI_RESPONSE_CACHE_TTL_SECONDS` / `AI_EMBEDDING_CACHE_TTL_SECONDS`); hits cost $0, are attributed via `token_usage.fromCache`, and are counted in `cf_ai_cache_hits_total`.

## 23. Observability & DR (ops)

`GET /metrics` (no `/api` prefix, version-neutral) serves Prometheus metrics (`cf_` prefix); protect with `METRICS_TOKEN` bearer in shared environments. Alert rules, SLOs, and the Grafana overview dashboard live in `infra/monitoring/`; backup/restore scripts and incident runbooks (RTO 1h / RPO 24h) in `infra/dr/`.

Roles: `SUPER_ADMIN` > `OWNER` > `MEMBER`; elevated identities come from `SUPER_ADMIN_EMAILS` / `OWNER_EMAILS` env config (never hardcoded). The `credit_ledger` is append-only and idempotent — every balance is reconstructable from it.

Reserve→settle (§5.3, opt-in `BILLING_ENFORCE_CREDITS`): jobs hold `JOB_RESERVE_CREDITS` and copilot turns `COPILOT_RESERVE_CREDITS` before AI runs; the real cost (accumulated via the AI usage context) settles as a `USAGE_DEBIT` of `ceil(costUsd × CREDITS_PER_USD × AI_CREDIT_MARKUP)`; failures release the hold. Holds expire after `HOLD_TTL_MINUTES` so crashes never strand credits.

Every turn lands in the `actions` audit table (source `UI`/`COPILOT`/`VOICE`, status, `fromCache`, `tokensUsed`); spoken turns also record `voice_commands` (raw transcript + resolved intent); `copilot_sessions` keeps compressed per-user intent history. The `token_usage` ledger is populated by a global usage hook on the shared aiClient — no AI call goes unmetered. Rows carry `userId`/`jobId`/`projectId`/`importedVideoId` attribution from an AsyncLocalStorage context (`common/ai-usage.context.ts`) set by the supervisor around each job dispatch, by the copilot around each chat turn, and by semantic search around query embeddings — no per-call plumbing.
