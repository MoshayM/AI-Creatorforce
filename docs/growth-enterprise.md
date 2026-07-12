# Enterprise Extensions & Growth Engine — Implementation Plan

> Working plan for `Docs3/Phase5-Enterprise-Extensions-Spec.md` and
> `Docs3/Phase6-Trial-Growth-Engine-Spec.md`, mapped onto the existing NestJS
> monolith. Same convention as `docs/billing-security.md`: spec concepts kept,
> microservice topology not (module boundaries mirror the spec's service
> boundaries). Both specs build on the shipped billing core — see
> `docs/billing-security.md` for that layer's status.

## Phase 5 slice status

| Spec module | Scope | Status |
|---|---|---|
| §5 Provider management | `ai_providers` + `provider_health_events` + `provider_cost_rates` persisted from the shared aiClient's LIVE health state; seeded on boot; `/admin/providers` | ✅ shipped |
| §7 Dynamic pricing | `pricing_rules`, most-specific-wins resolution (plan > model > provider > action), quoted-and-LOCKED at reservation, admin CRUD audited | ✅ shipped |
| §8 Profit protection | Fail-closed margin guard (`MIN_PROFIT_MARGIN`, default 30%): worst-case provider cost vs credit value; gates pricing-rule create/update; `/admin/profit/preview` | ✅ shipped |
| §6 Smart routing | Health-ranked provider selection + automatic failover + rate limiting | ✅ pre-existing in the shared aiClient (score/cooldown/failover) — registry now persists it; per-request cost-based *model* selection deferred (single model per provider today) |
| §12 Token optimization | Intent cache, compliance cache, per-stage resume, embedding no-reembed | ✅ pre-existing; response-cache generalization deferred |
| §10 Org/team billing | Organizations, teams, shared wallets, budgets, manager approval | ✅ shipped (Wave 3) — shared wallet = existing wallet owned by an org; Wave 6 adds usage reports, budget rollover + copilot org billing (`orgId` on /copilot/chat) |
| §11 BI/forecasting | LTV/CAC/ARPU/MRR, forecasts | ✅ shipped (Wave 4a backend + Wave 6 dashboard UI) |
| §13 Developer portal | Hashed API keys, webhooks, sandbox | ✅ shipped (Wave 4b) — SDK/OpenAPI-docs autogen + per-key usage analytics deferred |
| §14 Background jobs | forecast-generation, budget-period-rollover, cache-eviction | ✅ forecast + rollover jobs shipped; cache-eviction satisfied by Redis TTL (see deviations) |
| §15 Monitoring/DR | SLOs, backups, replicas | ✅ shipped (Wave 5) — alert rules, SLOs, Grafana dashboard, DR scripts + runbooks |

## Phase 6 slice status

| Spec module | Scope | Status |
|---|---|---|
| §5–7 Trial system + abuse + restrictions | Trial lot on signup, one-per-identity, fingerprint scoring, feature gating | ✅ shipped |
| §8–9 Upgrade engine + first-recharge rewards | Behavior-driven nudges; profit-gated bonuses | ✅ shipped |
| §10.1 Offer engine | Behavior-qualified campaigns, redeem + auto-apply at settle, profit-gated | ✅ shipped |
| §12 Marketplace | `credit_packs`, regional rows, pack-based recharge over the existing payment path | ✅ shipped |
| §10.2 Referrals | Codes, qualification gate, fraud, leaderboard | ✅ shipped (Waves 4+5, with in-app notifications + growth surfaces) |
| §11 Wallet display | Lot breakdown already exists on the settings wallet card; expiry timeline pending | ⏳ partial |

## What shipped in this slice (Phase 5 Wave 1)

- **Provider registry** (§5): the live health/failover/rate-limit machinery
  already ran inside `packages/shared/src/ai` (health scores, cooldowns,
  provider ranking) — the new `ProviderRegistryService` seeds
  `ai_providers` + default `provider_cost_rates` from the client's built-in
  table and persists the health snapshot every 5 minutes; status transitions
  become `provider_health_events`. `GET /admin/providers` shows state,
  current rates, and recent events.
- **Pricing engine** (§7): `resolveRule` picks the most specific active rule
  (specificity = non-null matchers, then priority, then recency) within its
  effective window. When a rule prices an action, the supervisor/copilot
  reserve exactly that amount and settle exactly that amount
  (`priceLocked: true` + rule id in the ledger metadata) — a mid-flight rule
  change never touches an in-progress request. No rule → the existing
  cost×markup settle path (which is margin-safe by construction).
- **Profit guard** (§8): `computeMargin` fails closed on zero value or
  unknown cost; expected cost = worst-case (most expensive) live provider at
  the action's nominal token usage, from DB rates falling back to the shared
  defaults. Creating or re-pricing a rule below `MIN_PROFIT_MARGIN`
  (default 0.3) is rejected with the computed numbers; every decision is
  audit-logged. `POST /admin/profit/preview` answers "could I charge X?".
- **RBAC**: new `admin:providers` (OWNER+) and `admin:pricing`
  (SUPER_ADMIN) permissions.

## What shipped in Phase 6 Wave 1 (trial system)

- **Trial credits are ordinary credit lots** (spec's own reuse rule): a new
  `trialCredits` bucket at the HEAD of the spend priority (trial → promo →
  bonus → referral → purchased), granted as a `TRIAL` ledger entry with lot
  expiry `TRIAL_EXPIRY_DAYS` (default 15) — the existing expiry job sweeps
  it, the existing wallet card shows it. `TRIAL_CREDITS` (default 100),
  0 disables trials.
- **One trial per identity**: `trial_grants` with unique `userId` AND unique
  `identityKey` (sha256 of normalized email) — the hard backstop the spec
  requires even when scoring passes. The grant idempotency key is the
  identity key, so replay can't double-grant.
- **Abuse scoring** (`scoreAbuse`, pure + tested, fail-closed): duplicate
  device fingerprint → BLOCK; duplicate IP + VPN → REVIEW (parked as
  `PENDING_REVIEW`, granted only via `POST /admin/trial/:userId/approve`);
  clean signups → ALLOW. Every decision lands in `abuse_signals`.
- **Server-side restrictions** (`trial_limits`, Super-Admin editable via
  `PATCH /admin/trial-config`): `daily_ai_requests` enforced in the
  supervisor before any job dispatch (counts child stages — a 20/day default
  ≈ 3 full pipelines), `max_projects`, `publishing`. Applies only while the
  user is genuinely on trial (no purchases, not converted). Disabled/exceeded
  features fail with `TRIAL_LIMIT:<feature>` the UI can turn into an
  upgrade nudge.
- **Conversion**: the first successful recharge flips the grant to
  `CONVERTED` (webhook settle path) — restrictions lift automatically.
- `GET /trial/status` (remaining trial credits, expiry) and
  `GET /trial/limits` for the client; signup accepts an optional
  `deviceFingerprint`.

## What shipped in Phase 6 Wave 2 (upgrade engine + first-recharge rewards)

- **Behavior tracker** (§4.9): `user_behaviour` rebuilt every 30 minutes from
  tables the platform already writes (copilot/voice actions, analyze/render
  jobs, clips, trial consumption) — no new event stream needed at this scale.
- **Upgrade engine** (§8): pure rules mapped to this platform's real
  features — low/expiring trial → STARTER banner, video-heavy (≥5 analyses
  or ≥10 renders) → PRO, clip-heavy → STARTER, chat-heavy → PRO. Frequency
  cap: same reason suppressed 7 days after being shown, 14 after dismissal.
  `GET /upgrade/recommendations` (refreshes on read), dismiss endpoint.
- **First-recharge rewards** (§9): `offers`/`offer_redemptions` with the
  spec's double idempotency (unique redemption key AND ledger key on the
  payment — a replayed webhook can't double-grant). Highest qualifying
  `minRechargeMinor` threshold wins; margin gate at offer CREATION and
  re-checked at grant time with the real amount
  (`bonus$ ≤ recharge$ × (1 − MIN_PROFIT_MARGIN)`, conservative face-value
  costing). Reward failures never break the payment webhook.
  `GET/POST /admin/offers` (`admin:trial`, audited).

## What shipped in Phase 6 Wave 3 (offer engine + marketplace)

- **Offer engine** (§10.1): offers are admin-created campaigns whose
  *targeting* is behavior-driven — `offerQualifies` (pure, tested) matches
  WELCOME/FIRST_RECHARGE (no payments yet), LOYALTY (`lifetimePurchasedMin`),
  WINBACK (`inactiveDaysMin`), LOW_CREDIT (`maxBalance`) against the user's
  live context, thresholds via `targetRule`. Two redemption modes:
  recharge-attached offers auto-apply at webhook settle (best qualifying
  reward, per-user/global limits, double-idempotent on the payment) and
  direct-grant offers via `POST /offers/:id/redeem` (idempotent per user).
  `GET /offers` is the user's Offer Center feed. Profit gates at creation:
  recharge-attached bonuses fit the margin envelope; direct grants are
  capped by `MAX_FREE_GRANT_CREDITS` (default 100) — fail closed.
- **Marketplace** (§12): `credit_packs` with per-region rows;
  `GET /marketplace/packs?region=` filters; recharge accepts `packId` and
  runs the standard payment flow (same idempotency, webhook settlement, and
  offer rewards). Pack creation is margin-gated using the real credit
  economics — credits redeem at rate×markup, so a $10 pack may carry up to
  40% bonus credits at defaults (`packWithinMargin`, pure + tested).
  Admin CRUD under `admin:pricing`, audited.
- Deviation: the spec's *auto-generation* of offer rows is replaced by
  admin-created campaigns + behavior-driven qualification + the Wave 2
  upgrade nudges — same outcomes, no per-user campaign-row explosion.

## What shipped in Phase 5 Wave 6 (org billing hardening + enterprise dashboard)

- **budget-period-rollover job** (§14): hourly `BudgetRolloverJob` calls
  `OrgsService.rolloverExpiredBudgets()` — every (org, team) whose latest
  `BudgetPeriod` has ended gets a successor with the same duration,
  allocation and hardCap, consumption reset.  Without this an expired period
  meant `currentPeriod` found nothing and org spend silently went
  unbudgeted.  Missed windows are backfilled in one run (`rolloverWindows`,
  pure + tested, capped at 12 periods); idempotent via successor-existence
  check; org admins are notified (`org.budget.rollover`).  Kill-switch:
  `BUDGET_ROLLOVER_JOB_ENABLED=false`.
- **Usage reports** (§10): `GET /orgs/:id/reports/usage?from=&to=&teamId=&format=json|csv`
  (VIEW_REPORTS role) rolls up the org wallet's HELD/SETTLED reservations
  per member × action — SETTLED holds count `settledCredits` (the real
  debit), HELD count the reserved amount, RELEASED are excluded.  Member
  attribution parses the orgSpend idempotency-key format the same module
  writes (`parseOrgSpendKey`, pure + tested); usage by removed members
  survives as role `REMOVED`.  `format=csv` streams a text/csv attachment.
- **Org billing in the copilot spend path** (§10): `POST /copilot/chat`
  accepts an optional `orgId` — the turn's reserve→settle then runs on the
  org shared wallet through `orgSpend` (SPEND role + budget gate).  A
  hard-capped budget rejects with `ORG_BUDGET_EXCEEDED`; members flagged
  `approvalRequired` above the threshold get `ORG_APPROVAL_REQUIRED` (their
  managers are notified) and retry after approval.  Budget consumption is
  recorded at reserve and reconciled at settle/release (delta adjustment /
  rollback), and the settle ledger metadata carries `orgId` + `memberUserId`.
  Fixed along the way: consumption now lands on the org-wide fallback period
  when a team member is gated by it (previously it was never recorded), and
  the orgSpend idempotency key carries a numeric nonce so same-millisecond
  turns can't reuse a hold.
- **Enterprise dashboard UI** (§9): `/admin` page in the web app (nav link
  shown to OWNER/SUPER_ADMIN from the JWT role; the API's permission guard
  is the real gate) rendering the Wave 4a backend: MRR/ARR, ARPU/LTV, churn,
  AI cost + cache savings, revenue-by-period bars, most-used models,
  forecast cards (per-metric units: revenue minor, cost USD, subscription
  count) with a manual generate button, and provider health/cost table.

## What shipped in Phase 5 Wave 7 (org billing everywhere + org UI)

- **Project → org billing** (§10): `projects.billingOrgId` (nullable; set/cleared
  via POST/PUT `/projects` — owner must be a member of the org, verified at set
  time).  When set, the supervisor's reserve→settle for every agent job runs on
  the org shared wallet through `orgSpend` (SPEND role + budget gate), with the
  same consumption reconciliation as copilot turns: recorded at reserve,
  delta-adjusted at settle, rolled back on release.  `NEEDS_APPROVAL` fails the
  job with `ORG_APPROVAL_REQUIRED` (managers notified inside orgSpend); the user
  re-enqueues after approval.  Voice turns bill orgs through the same
  `/copilot/chat` `orgId` path as chat — the panel's picker covers both.
- **Org management UI**: `/orgs` page — create org, budget-period status +
  creation (MANAGE_BUDGET), member list + add-by-email with role +
  `approvalRequired` (MANAGE_ORG), usage-report CSV download (VIEW_REPORTS).
  Role capabilities mirrored client-side for display only; the server re-checks.
  `GET /orgs/:id/members` now joins user email/name (OrgMembership has no User
  relation — manual join).
- **Bill-to pickers**: copilot panel header ("Bill to: personal wallet / org")
  sends `orgId` on every turn; project detail header picker PUTs
  `billingOrgId`.  Both hidden when the user belongs to no org.
- **E2e**: `orgs.spec.ts` — create-org POST body, budget card render, member
  roles render, budget PUT body, MEMBER-role control hiding, copilot turn
  carries `orgId`, project picker PUTs `billingOrgId`.

## What shipped in Phase 5 Wave 8 (teams UI + admin e2e)

- **Teams API**: `POST /orgs/:id/teams` (MANAGE_ORG) and `GET /orgs/:id/teams`
  (any member).  The `Team` model already existed (Wave 3, nullable `orgId`);
  these endpoints only cover org-linked teams.  Budget (`PUT /orgs/:id/budget`)
  and member (`POST /orgs/:id/members`) endpoints now validate a supplied
  `teamId` names a team of *that* org — a foreign/typo'd id previously created
  a period that never matched any member and silently never enforced.
- **Teams UI** (closes next-step 6): Teams card on `/orgs` (chip list +
  create, MANAGE_ORG); budget card gained a scope picker (org-wide / per-team)
  driving both the status query (`?teamId=`) and new-period `teamId`; the
  add-member form gained a team select and the member table a Team column.
  Team controls stay hidden while the org has no teams.
- **E2e**: `admin.spec.ts` (closes next-step 5) — KPI/forecast/provider render
  with per-metric units, generate-forecasts POST, 403 → access-required state.
  `orgs.spec.ts` gained team coverage: create-team POST body, budget scope
  `?teamId=` + PUT `teamId`, add-member `teamId`.

## What shipped in Phase 5 Wave 9 (content-hash analysis cache, §12)

- **`AnalysisCacheService`** (shorts-studio): when a video's source media is
  byte-identical to one already analyzed — same `AssetVersion.contentHash`,
  e.g. the same file re-imported into another project or after a delete —
  transcript segments (embeddings included), scene rows, and topic segments
  are **copied** from the analyzed twin instead of recomputed.  A full hit
  skips Whisper ASR, the ffmpeg scene pass, and every topic-segmentation AI
  window.  Wired into `ensureTranscript` / `ensureScenes` / `ensureTopics`
  ahead of provider work; topic copy only fires when zero rows exist so a
  partially segmented video still resumes its own windows.
- **Scoping**: same-user only — identical input yields identical output, but
  derived rows never cross tenants, keeping access control auditable.  Rows
  are copied, not shared, so §16 resume rules and cascade deletes keep
  working per video.  `AssetVersion.contentHash` was already indexed — no
  migration.

## What shipped in Phase 5 Wave 10 (dev-portal analytics + OpenAPI)

- **Per-key request analytics**: `developer_key_usage_days` — one row per key
  per UTC day, incremented fire-and-forget by `DeveloperKeyGuard` after auth
  + rate-limit pass (rejected and rate-limited calls stay out).
  `GET /dev/usage?days=` returns totals + sparse per-day counts per key
  (`buildUsageSummary`, pure + tested).  Request-level only by design: the
  next-steps note stands — token attribution per key needs a `token_usage`
  key column and only makes sense once the dev API grows AI-spending routes.
- **OpenAPI for the public API**: a second Swagger document filtered to the
  `/dev-api/` surface (portal management and internal routes excluded),
  served at `/api/dev-docs` in EVERY environment — unlike the internal doc,
  which stays non-production.  `/api/dev-docs-json` is the SDK-generation
  source (openapi-generator et al.); shipping generated SDK packages is a
  consumer-side build step, not a server feature.

## What shipped in Phase 5 Wave 12 (dev-API resources + per-key tokens)

- **Resource routes** on `/dev-api/v1`: projects list/get (`projects:read`),
  project jobs list + job get with result (`jobs:read`).  Every route
  resolves through the key owner's userId (ProjectsService.get is
  ownership-scoped) — a key can never touch foreign resources regardless of
  scopes; channel-scoped jobs (null projectId) 404 on the public surface.
- **First paid AI action**: `POST /dev-api/v1/projects/:id/jobs`
  (`jobs:write`) — type validated against `JobTypeSchema`, sandbox keys
  rejected (real credit spend), billing rides the existing supervisor
  reserve→settle (personal wallet or `billingOrgId` org wallet, unchanged).
- **Per-key token attribution** (closes the Wave 10 deferral):
  `token_usage.developerKeyId` (indexed) — the enqueue route stamps the key
  id into the job payload, the supervisor passes it into the AI-usage
  context, and `UsageLedgerService` writes it on every provider call in the
  run.  `GET /dev/usage` now returns `tokens` {in, out, costUsd, calls} per
  key alongside request counts.

## Deliberate deviations

- **Monolith modules, not microservices** (both specs §3) — same precedent
  as every prior layer.
- **Token-only cost model**: the specs price images/video/voice per unit;
  this deployment's AI spend is token-based (media generation runs local
  ffmpeg/offline adapters at zero marginal provider cost), so cost rates are
  per-1M-token only until paid media providers land.
- **Routing engine**: provider choice stays in the shared aiClient (health-
  ranked with cooldown failover). The spec's per-request *cheapest-model*
  scoring needs multiple models per task type — deferred until model
  alternatives exist per provider.
- **Float cost rates** instead of numeric(18,6): estimates feeding a guard
  with a 30% buffer, not money movement; credits remain integers.
- **Nominal-usage margin checks**: rule-level checks use per-action nominal
  token counts (`NOMINAL_USAGE`) rather than per-user history — history-based
  prediction becomes worthwhile with the Phase 6 behavior tracker.
- **cache-eviction job** (§14): not built as a job — the response/embedding
  caches live in Redis with a TTL set on every write (`AiCacheAdapter`), so
  expiry is handled by Redis itself (plus `maxmemory` LRU if configured).
  A sweep job would duplicate what the store already guarantees.
- **Usage-report attribution**: member attribution comes from the orgSpend
  reservation idempotency key rather than a ledger column — the format is
  owned by the same module and parsed by a tested pure function.  If
  attribution ever needs to survive a key-format change, add a `metadata`
  column to `credit_reservations` and write both.
- **Identity verification** (Phase 6 §6): no outbound email/OTP infra exists,
  so "verified identity" = the registered email (hashed) — the one-trial
  uniqueness and fingerprint/IP scoring still hold; OTP/social verification
  plug into `verificationMethod` when auth providers land. VPN detection
  needs an IP-intelligence service — the scoring input exists, wired to
  `false` for now.

## Next steps

1. ~~Extend org billing beyond copilot chat~~ — done (Wave 7): agent jobs bill
   via `projects.billingOrgId`; voice turns share the copilot `orgId` path.
2. ~~Web UI for orgs~~ — done (Wave 7): `/orgs` page + bill-to pickers in the
   copilot panel and project detail header.
3. ~~Developer portal follow-ups~~ — done (Waves 10+12): OpenAPI doc at
   `/api/dev-docs(-json)`, per-key request analytics (`GET /dev/usage`),
   and per-key token attribution via `token_usage.developerKeyId` now that
   the dev API has an AI-spending route (job enqueue).
4. ~~Transcript/analysis cache keyed by media content hash~~ — done (Wave 9):
   `AnalysisCacheService` copies transcript/scene/topic rows across
   content-identical videos of the same user.
5. ~~Playwright e2e coverage for Phase 5 flows~~ — done (Wave 8):
   `admin.spec.ts` covers the dashboard; org/team flows in `orgs.spec.ts`.
6. ~~Team-scoped budgets in the UI~~ — done (Wave 8): teams CRUD + scope
   picker on the budget card and team assignment on the member form.
