# workflows.md — AI CreatorForce

This document defines every orchestrated pipeline in the platform: the long-form content pipeline, the Shorts Studio pipeline, the analytics refresh loop, billing flows, the approval workflow, and supporting conventions. Compliance and human-review gates are mandatory where marked and cannot be bypassed in code. Read alongside [agents.md](agents.md), [architecture.md](architecture.md), and [youtube-publishing.md](youtube-publishing.md).

---

## 1. Conventions

- Every step longer than 2 seconds, or that calls an external AI/video/music provider, runs as a **BullMQ job** — never inline in a request handler.
- `[GATE]` = a step that blocks progression on failure. No override path exists.
- `[HUMAN]` = a human-approval checkpoint that pauses the workflow.
- `[PARALLEL]` = steps that run concurrently.
- Compliance and approval are enforced in code, not only by convention. `PublishingService` throws `ForbiddenException` if `Approval.status !== 'APPROVED'`.

**Job status transitions:**

```
PENDING → QUEUED → RUNNING → WAITING_APPROVAL → APPROVED / REJECTED → COMPLETED / FAILED / CANCELLED
```

Each step writes its result and a trace event keyed by the workflow's correlation ID (`jobId`).

---

## 2. BullMQ + SupervisorWorker

**File:** `apps/api/src/workers/supervisor.worker.ts`

All jobs are enqueued on `AGENT_QUEUE`. The `SupervisorWorker` consumes jobs, dispatches to the appropriate per-module service (e.g., `ResearchService`, `ScriptService`, `ComplianceService`), and posts results back via BullMQ. A Socket.io gateway notifies the frontend when a job completes or requires human input.

```
Client → POST /jobs → AGENT_QUEUE (BullMQ)
                         ↓
                   SupervisorWorker
                         ↓
              per-module service → Agent
                         ↓
                   Result → BullMQ
                         ↓
               Socket.io gateway → Client
```

---

## 3. Long-Form Content Pipeline

Triggered by a user creating a Project and requesting content generation.

| Step | Job type | Handler | Gate |
|---|---|---|---|
| 1 | — | User creates Project via `POST /projects`, selects Channel | — |
| 2 | `RESEARCH` | `ResearchAgent` gathers sources, returns structured sources JSON | — |
| 3 | `SCRIPT` | `ScriptAgent` generates script with inline source citations | — |
| 4 | `FACT_CHECK` | `FactCheckAgent` validates claims against research pack | [GATE] unsupported claims block |
| 5 | `COMPLIANCE` | `ComplianceAgent` scores content | [GATE] score < 70 or BLOCK severity = job fails, content blocked |
| 6 | `METADATA` | `MetadataAgent` generates title/description/tags | — |
| 7 | `SEO_OPTIMIZATION` | `SEOAgent` optimizes metadata for discoverability | — |
| 8 | — | System creates `Approval` record (`status=PENDING`, `expiresAt` set per config) | [HUMAN] |
| 9 | — | Human reviews and approves/rejects via `POST /approvals/:id/approve` or `/reject` | [GATE] |
| 10 | `PUBLISH` | `PublishingService` checks `Approval.status === 'APPROVED'`; throws `ForbiddenException` if not | [GATE] |
| 10 (cont.) | `PUBLISH` | YouTube Data API upload | — |

Any agent failure triggers retry with backoff. After `MAX_AGENT_RETRIES`, the job routes to `QualityControlAgent`. A `[GATE]` failure returns the bundle to the creator with specific, actionable reasons and halts the pipeline.

---

## 4. Shorts Studio Pipeline

Channel-first flow. Users select a channel, then explicitly pick videos to import via the library picker modal. Nothing is imported or listed automatically.

| Step | Job type / action | Handler |
|---|---|---|
| 1 | UI | User selects Channel (channel-first entry point) |
| 2 | UI | User opens library picker, selects videos to import |
| 3 | `POST /shorts-studio/import` | `VideoImportService` creates `ImportedVideo` record, enqueues `TRANSCRIPT_ANALYSIS` |
| 4 | `TRANSCRIPT_ANALYSIS` | Transcript processing; creates `TranscriptSegment` rows |
| 5 | `SCENE_DETECTION` | Creates `VideoScene` rows |
| 6 | `TOPIC_SEGMENTATION` | Creates `TopicSegment` rows |
| 7 | `CHAPTER_DETECTION` | Creates `Chapter` rows (`ChapterSource.DETECTED`) |
| 8 | `HIGHLIGHT_DETECTION` | Scores segments for short-form potential |
| 9 | — | `ClipRecommendationService` returns ranked clip recommendations |
| 10 | `SHORTS_GENERATION` | `ShortsGenerationService` creates `ShortClip` rows |
| 11 | UI | User edits `ShortsTimeline` (drag-drop, trim, reorder) via `TimelineService` |
| 12 | `APPLY_COMMANDS` / `ASSIST_CAPABILITY` | AI editing assistant (`AiEditingAssistantService`) |
| 13 | `SHORTS_RENDER` | `ShortsExportService` creates export |
| 14 | Optional | `ChapterSyncService` syncs detected chapters to YouTube description |
| 15 | Optional | `SocialContentService` generates `QUOTE_CARD` / `CAROUSEL` / `BLOG_POST` / `NEWSLETTER` |
| 16 | Optional | `SHORTS_PUBLISH` → YouTube Shorts upload |
| 17 | Optional | `ThumbnailGenerationService` generates Short thumbnail |

---

## 5. Analytics Refresh Workflow

Runs on a scheduled poll after videos are published.

```
ANALYTICS job
  → AnalyticsAgent pulls data from YouTube Analytics API
  → Stores AnalyticsSnapshot in Postgres (CTR, retention, watch time, revenue, subscribers)
  → GROWTH_REPORT job
  → GrowthAgent produces channel performance insights and next-topic recommendations
  → Recommendations surface in dashboard; top topics seed the long-form pipeline
```

---

## 6. Billing Workflows

### Credit reserve-settle

1. Before a metered job starts: `WalletService.reserve()` creates a `CreditReservation` with status `HELD` and deducts the estimated amount from the user's spendable balance.
2. After the job completes: `WalletService.settle()` posts a `USAGE_DEBIT` entry to `CreditLedger` and closes the reservation.
3. If the job fails before settling, the reservation is released.

### Stripe recharge

1. User triggers `POST /wallet/recharge`.
2. `BillingService` creates a Stripe Checkout session; returns session URL.
3. Stripe webhook fires on payment completion.
4. Credit grant is posted to `CreditLedger` as a `PURCHASE` lot.

### Referral credits

`ReferralService` posts a `REFERRAL` credit lot to both the referrer's and the new user's wallets on successful signup.

---

## 7. Approval Workflow

| Endpoint | Effect |
|---|---|
| `POST /approvals/:id/approve` | Sets `Approval.status = 'APPROVED'` |
| `POST /approvals/:id/reject` | Sets `Approval.status = 'REJECTED'` |

Rules:
- Every `Approval` record has an `expiresAt`. Expired approvals block publish even if status was previously `APPROVED`.
- Any edit to an approved bundle resets `compliancePassed = false` and `humanApproved = false`, requiring a fresh compliance run and a new approval.
- `PublishingService` re-validates both flags at publish time; it does not rely solely on the prior gate having run.

---

## 8. n8n

The `n8n/` folder in the repository contains exported workflow JSON definitions intended for long, human-paused automations that call the API and enqueue jobs. The n8n runtime is **not yet deployed**. No production workflows depend on it.

---

## 9. Planned / Not Yet Implemented

| Item | Status |
|---|---|
| n8n runtime deployment | Not yet deployed. Workflow definitions exist in `n8n/`. |
| Auto-publish scheduling | Schema has `scheduledAt` on `Video`. Requires explicit auto-publish opt-in by user and a compliance pass. Not yet exposed in the UI per CLAUDE.md rule 2. |
