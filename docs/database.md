# database.md — AI CreatorForce

This document is the canonical reference for the AI CreatorForce data model. It covers all Prisma models, their key fields, naming conventions, and query patterns. The authoritative schema file is `apps/api/prisma/schema.prisma` (also synced to `infra/db/schema.prisma`). Related reading: [architecture.md](architecture.md), [api.md](api.md), [security.md](security.md), [techstack.md](techstack.md).

---

## Conventions

- **Engine:** PostgreSQL 16. **ORM:** Prisma 6 (migrations are the source of truth — never alter the database directly).
- **IDs:** `cuid()` primary keys on all models.
- **Table names:** `snake_case` via `@@map()` on every model.
- **Timestamps:** `createdAt` and `updatedAt` (UTC) on every table.
- **Cascade deletes:** all child models use `onDelete: Cascade` so orphaned rows are never left behind.
- **Indexes:** `@@index` annotations on all query-critical field combinations; documented per model group below.
- **Migrations:** `prisma migrate dev` locally, `prisma migrate deploy` in CI/production. Seed data in `infra/db/seed.ts`. No manual schema edits in any environment.
- **Wallet polymorphism:** the `Wallet` model enforces a DB `CHECK` constraint ensuring exactly one of `userId` or `orgId` is non-null. Balance is a read-cache; `CreditLedger` is the single source of truth (balance is reconstructable from the ledger).
- **Append-only tables:** `CreditLedger` and `AuditLog` are never updated or deleted. Corrections are new rows.

---

## Model Groups

### Users & Auth

**User** — `id`, `email` (unique), `name`, `avatarUrl`, `passwordHash`, `emailVerified`, `role` (`UserRole`: `SUPER_ADMIN` / `OWNER` / `MEMBER`), `rechargesFrozen`, timestamps. Roles are resolved from `SUPER_ADMIN_EMAILS` / `OWNER_EMAILS` env config at login; never hardcoded in the schema.

**SystemConfig** — `key` (PK), `value`. Runtime operator configuration; read by services at startup.

**ApiKey** — `id`, `userId`, `name`, `keyHash` (unique), `lastUsed`, `expiresAt`. Used for API key authentication in the developer portal.

**AccountLink** — OAuth provider linkage records (provider, providerAccountId, tokens). Supports multiple linked sign-in methods per user.

**AuthSession** — rotating refresh tokens. Tracks the full session family so any member of the family can be revoked on logout or reuse detection.

---

### Channels & Library

**Channel** — `id`, `userId`, `youtubeChannelId` (unique), `title`, `description`, `thumbnailUrl`, `customUrl`, `subscriberCount`, `videoCount`, `encryptedTokens`, `tokenExpiresAt`, `scopes[]`, `readOnly`, `active`, `lastSyncedAt`, `niche`, `voiceProfile` (Json), `brandKit` (Json). OAuth tokens are encrypted at rest using `TOKEN_ENCRYPTION_KEY`; never stored in plaintext. See [security.md](security.md).

**LibraryVideo** — videos synced from a connected channel's YouTube library.

**LibraryPlaylist** — playlists synced from a connected channel's YouTube library.

---

### Projects & Content

**Project** — `id`, `userId`, `channelId`, `title`, `description`, `status` (`DRAFT` / `ACTIVE` / `PAUSED` / `ARCHIVED`), `niche`, `targetLang` (default `'en'`), `billingOrgId` (nullable — for org billing). The primary content unit; all downstream models are scoped to a project.

**Video** — `id`, `projectId`, `channelId`, `youtubeVideoId` (unique, nullable), `title`, `description`, `tags[]`, `thumbnailUrl`, `status` (`DRAFT` / `PENDING_APPROVAL` / `APPROVED` / `SCHEDULED` / `PUBLISHED` / `FAILED`), `scheduledAt`, `publishedAt`, `viewCount`, `likeCount`, `commentCount`.

**Script** — `id`, `videoId`, `version` (increments on edit), `content`, `wordCount`, `sources` (Json, default `'[]'`), `active`. Editing a script after approval resets compliance and human-approval gates.

---

### Agent Jobs

**AgentJob** — `id`, `projectId`, `type` (`JobType` enum), `status` (`JobStatus` enum), `payload` (Json), `result` (Json, nullable), `error`, `errorCode`, `errorDetails` (Json, nullable — sanitized technical payload for admin), `attempts`, `idempotencyKey` (unique, nullable), `startedAt`, `completedAt`. Index on `[status, updatedAt]`.

**AgentLog** — `id`, `jobId`, `agentName`, `step`, `input` (Json), `output` (Json), `tokensIn`, `tokensOut`, `latencyMs`. One row per agent step within a job.

**JobType enum** — approximately 50 values covering: `RESEARCH`, `SCRIPT`, `FACT_CHECK`, `COMPLIANCE`, `METADATA`, `THUMBNAIL`, `TREND_ANALYSIS`, `SEO_OPTIMIZATION`, `AUDIENCE_ANALYSIS`, `PUBLISH`, all media pipeline types, all Shorts Studio types (`SHORTS_ANALYZE`, `CHAPTER_DETECTION`, `CAPTION_GENERATION`, `SHORTS_RENDER`, `SHORTS_EXPORT`, `SHORTS_PUBLISH`, `SOCIAL_CONTENT_GENERATION`, `EMBEDDING_GENERATION`, etc.), and `CHANNEL_SYNC`.

**JobStatus enum** — `PENDING` / `QUEUED` / `RUNNING` / `WAITING_APPROVAL` / `APPROVED` / `REJECTED` / `COMPLETED` / `FAILED` / `CANCELLED`.

---

### Compliance

**ComplianceResult** — `id`, `jobId` (unique), `passed`, `score` (Float), `flags` (relation to `ComplianceFlag[]`), `reviewedAt`, `reviewerAI`. Every content pipeline run has exactly one ComplianceResult linked via `jobId`.

**ComplianceFlag** — `id`, `complianceResultId`, `category`, `severity` (`FlagSeverity`: `INFO` / `WARNING` / `CRITICAL` / `BLOCK`), `description`, `excerpt`. A `BLOCK`-severity flag causes the result to fail. No content reaches the publishing engine without a passed `ComplianceResult`. See [compliance.md](compliance.md).

---

### Approvals

**Approval** — `id`, `projectId`, `jobId` (unique), `status` (`PENDING` / `APPROVED` / `REJECTED` / `EXPIRED`), `reviewedBy`, `notes`, `reviewedAt`, `expiresAt`. Expired approvals block publish; a new approval must be created. Human approval is a hard gate — see [youtube-publishing.md](youtube-publishing.md).

---

### Media Assets

**Asset** — `id`, `projectId`, `kind` (`AssetKind` enum — covers all media types: audio, video, thumbnail, voiceover, plus all Shorts Studio asset types), `currentVersionId`, `status` (`BRIEFED` / `GENERATING` / `READY` / `FAILED` / `ACCEPTED`), `label`, `deletedAt`. Index on `[projectId, kind, status]`.

**AssetVersion** — `id`, `assetId`, `version`, `r2Key`, `contentHash`, `provider`, `model`, `prompt` (Json), `params` (Json), `provenance` (Json), `sizeBytes` (BigInt), `durationMs`, `wordTimestamps` (Json). Stores full provenance for every generated version including provider, model, prompt, and generation params. `r2Key` is the Cloudflare R2 object key (integration planned; field present).

**Timeline** — `id`, `projectId`, `version`, `label`, `fps` (default 30), `resolution` (Json, default 1920×1080), `tracks` (Json — schemaVersioned tracks array), `contentHash`, `isDraft`. Index on `[projectId, version]`.

**Render** — `id`, `projectId`, `timelineId`, `timelineVersion`, `preset` (`DRAFT_PROXY` / `YT_1080P` / `YT_4K` / `SHORTS_1080X1920`), `status` (`QUEUED` / `RENDERING` / `READY` / `FAILED`), `progressPct`, `r2Key`, `sizeBytes`, `durationMs`, `checksum`, `costCredits` (Decimal), `error` (Json). Unique on `[projectId, timelineVersion, preset]`.

---

### Analytics

**AnalyticsSnapshot** — `id`, `channelId`, `ytVideoId` (nullable — null means channel-level snapshot), `capturedAt`, `metrics` (Json). Index on `[channelId, ytVideoId, capturedAt]`.

**AuditLog** — `id`, `userId` (nullable), `action`, `target` (nullable), `meta` (Json). Append-only. Index on `[userId, createdAt]` and `[action, createdAt]`. Never updated or deleted.

**PromptVersion** — `id`, `key`, `version`, `body`, `active`, `createdAt`. Unique on `[key, version]`. Index on `[key, active]`. Active prompt versions are loaded by agents at runtime.

---

### Organizations & Teams

**Organization** — `id`, `name`, `ownerUserId`, `billingEmail`, `status` (`ACTIVE` / `SUSPENDED`). An org has its own `Wallet` (provisioned in the same transaction as org creation).

**OrgMembership** — `id`, `orgId`, `userId`, `teamId` (nullable), `role` (`ORG_ADMIN` / `TEAM_MANAGER` / `BILLING_ADMIN` / `MEMBER`), `approvalRequired`. Unique on `[orgId, userId]`.

**BudgetPeriod** — `id`, `orgId`, `teamId` (nullable), `periodStart`, `periodEnd`, `allocatedCredits`, `consumedCredits`, `hardCap` (default `true`). Index on `[orgId, teamId, periodStart]`. Hard cap blocks spend at exhaustion when `hardCap = true`.

**Team** — `id`, `name`, `ownerId`, `planTier`, `orgId` (nullable — standalone for beta teams). Teams scope budget periods and member assignment within an org.

**TeamMembership** — `id`, `teamId`, `userId`, `role` (`OWNER` / `ADMIN` / `EDITOR` / `REVIEWER` / `VIEWER`). Unique on `[teamId, userId]`.

---

### Billing & Credits

**Wallet** — Polymorphic: exactly one of `userId` / `orgId` is non-null (enforced by a DB `CHECK` constraint). Fields: `balanceCredits`, `purchasedCredits`, `bonusCredits`, `promotionalCredits`, `referralCredits`, `trialCredits`, `lifetimePurchased`, `lifetimeUsed`. Balance is a read-cache; the `CreditLedger` is the single source of truth.

**CreditLot** — `id`, `walletId`, `bucket` (string: `promotionalCredits` / `bonusCredits` / `referralCredits` / `purchasedCredits`), `amount`, `remaining`, `expiresAt` (nullable — null means never expires). Index on `[walletId, expiresAt]`. Credits are consumed from lots ordered by earliest expiry.

**CreditLedger** — Append-only. `id`, `walletId`, `entryType` (`LedgerEntryType`: `PURCHASE` / `BONUS` / `REFERRAL` / `PROMO` / `TRIAL` / `USAGE_DEBIT` / `REFUND` / `EXPIRY` / `ADJUSTMENT`), `amount` (positive = credit, negative = debit), `balanceAfter` (snapshot for audit), `referenceType` (`LedgerReferenceType`: `PAYMENT` / `AI_REQUEST` / `COUPON` / `REFERRAL` / `ADMIN_ACTION`), `referenceId`, `idempotencyKey` (unique). Corrections are new `ADJUSTMENT` rows — existing rows are never updated or deleted.

**CreditReservation** — `id`, `walletId`, `amount`, `status` (`HELD` / `SETTLED` / `RELEASED`), `settledCredits`, `referenceType`, `referenceId`, `idempotencyKey` (unique), `expiresAt`. Expired `HELD` rows are ignored by balance math. Jobs hold credits before AI runs; real cost settles as `USAGE_DEBIT` on completion; failures release the hold.

**Subscription** — `id`, `userId` (unique), `stripeCustomerId` (unique), `stripeSubscriptionId` (unique, nullable), `plan` (`FREE` / `STARTER` / `PRO` / `AGENCY`), `status` (`ACTIVE` / `PAST_DUE` / `CANCELLED` / `TRIALING`), `currentPeriodStart`, `currentPeriodEnd`, `cancelAtPeriodEnd`.

**Payment** — Payment receipt records linked to wallet recharge events.

**UsageLog** — Per-period usage records for token / credit metering.

---

### Shorts Studio

**ImportedVideo** — `id`, `projectId`, `youtubeVideoId`, `title`, `description`, `durationMs`, `thumbnailUrl`, `viewCount` (BigInt), `likeCount` (BigInt), `commentCount` (BigInt), `sourceAssetId`, `transcriptStatus` (`PENDING` / ...), `chaptersSyncedAt`, `notes` (text — user-editable reference notes, displayed as a sticky-note indicator in the UI). Unique on `[projectId, youtubeVideoId]`.

**TranscriptSegment** — Transcript segments from ASR (Whisper / YouTube captions), linked to an `ImportedVideo`. Used as the embedding source for semantic search.

**VideoScene** — Scene detection outputs linked to an `ImportedVideo`.

**TopicSegment** — Topic/highlight segments with scoring, linked to an `ImportedVideo`.

**Chapter** — `id`, linked to `ImportedVideo`, `title`, `summary`, `startMs`, `endMs`, `source` (`ChapterSource`: `DETECTED` / `IMPORTED`), `editedByUser`. Re-detection preserves rows where `editedByUser = true`. At least 3 chapters are required for YouTube chapter sync.

**SocialContent** — `id`, `importedVideoId`, `kind` (`SocialContentKind`: `QUOTE_CARD` / `CAROUSEL` / `BLOG_POST` / `NEWSLETTER`). Full text pack generated in one batched LLM call over chapters and top highlights.

**ShortClip** — Candidate short clips generated from highlights, linked to an `ImportedVideo` and a `Project`.

**ShortsTimelineItem** — Items within a Shorts timeline (trim points, captions, overlays).

**ShortsThumbnail** — Thumbnail variations generated after first render.

**ShortsExportHistory** — Export records linking a clip to its final exported asset and YouTube publish state.

---

### Growth & Developer

**TrialGrant** — Records trial credit grants per user, including amount, expiry, and status.

**ReferralCode** — `id`, `userId`, `code` (8-char, deterministic), referral totals. Used for the referral program with fraud detection (shared-fingerprint detection).

**DeveloperKey** — API keys for the developer portal. Scoped to `projects:read` / `jobs:read` / `jobs:write`. Sandbox keys are rejected on production AI actions.

**DeveloperWebhook** — Outbound webhook registrations (`project.completed`, `publish.succeeded`, `publish.failed`, `compliance.blocked`), signed with HMAC.

**Budget** — Per-user monthly spend cap with `monthlyLimit`, `alertThreshold`, and `hardCap`. Hard cap is enforced fail-closed inside `WalletService.reserve()`.

**Notification** — In-app notifications with a 24-hour dedupe window.

---

## Query Patterns & Performance

- **Pagination:** cursor-based throughout (`apps/api/src/common/pagination/cursor.ts`). No `OFFSET` pagination on large tables.
- **Key indexes:** `AgentJob [status, updatedAt]`, `Asset [projectId, kind, status]`, `Timeline [projectId, version]`, `Render` unique on `[projectId, timelineVersion, preset]`, `AnalyticsSnapshot [channelId, ytVideoId, capturedAt]`, `AuditLog [userId, createdAt]` and `[action, createdAt]`, `PromptVersion [key, active]`, `CreditLot [walletId, expiresAt]`, `BudgetPeriod [orgId, teamId, periodStart]`, `OrgMembership` unique on `[orgId, userId]`, `TeamMembership` unique on `[teamId, userId]`, `ImportedVideo` unique on `[projectId, youtubeVideoId]`.
- **Wallet balance:** the `balanceCredits` field is a read-cache. The `CreditLedger` is the authoritative source; balance is fully reconstructable from ledger rows. `balanceAfter` snapshots on each ledger row enable point-in-time audit without a full replay.
- **Compliance gate:** a `ComplianceResult` with `passed = true` is required before any content can be published. This is enforced in the service layer and re-verified by the publishing worker.
- **Approval gate:** an `Approval` with `status = APPROVED` and a non-expired `expiresAt` is required before `POST /publishing/publish` proceeds.

---

## Planned / Not Yet Implemented

- **Cloudflare R2 integration** — `r2Key` fields are present on `AssetVersion` and `Render`; the R2 client integration is not yet wired.
- **Full Shorts Studio relation details** — some relations (e.g., full `ShortsTimeline` model) are implied by the schema structure but the complete model definitions are not shown in the public schema view.
