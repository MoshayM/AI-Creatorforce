# api.md — AI CreatorForce

This document is the canonical reference for the AI CreatorForce REST API. All routes are served under `/api/v1` by the NestJS backend in `apps/api`. Related reading: [architecture.md](architecture.md), [database.md](database.md), [security.md](security.md), [compliance.md](compliance.md), [youtube-publishing.md](youtube-publishing.md), [monetization-framework.md](monetization-framework.md).

---

## Conventions

- **Base URL:** `/api/v1`
- **Format:** JSON. `Content-Type: application/json`.
- **Auth:** `Authorization: Bearer <JWT>` on all routes except `/health`, `/auth/*` (register / login / refresh / logout / OAuth), and `/metrics`. The `/metrics` endpoint is protected by network policy (not JWT).
- **JWT guard:** `JwtAuthGuard` is applied globally; exceptions are listed above.
- **Response format:** standard NestJS JSON (data objects or arrays).
- **Error format:** `{ statusCode, message, error }`.
- **Pagination:** cursor-based — `?cursor=&limit=` returns `{ data, nextCursor }`. No `OFFSET` pagination on large tables.
- **Async pattern:** long operations return `202 Accepted` with a `jobId`; clients poll `GET /jobs/:id` or subscribe over WebSocket for progress events.
- **Idempotency:** `POST /wallet/recharge` and other mutating wallet calls require an `Idempotency-Key` header. `AgentJob` deduplication uses the `idempotencyKey` field — a duplicate enqueue returns the original job without re-running it.
- **Swagger UI:** available at `/api/docs` (non-production environments). OpenAPI JSON at `/api/docs-json`.

---

## Authentication

| Method | Path | Body / Notes |
|---|---|---|
| POST | `/auth/register` | `{ email, password, name?, deviceFingerprint? }` → `{ accessToken, refreshToken }` |
| POST | `/auth/login` | `{ email, password }` → `{ accessToken, refreshToken }` |
| POST | `/auth/refresh` | `{ refreshToken }` → new token pair. Single-use; reuse revokes the session family. |
| POST | `/auth/logout` | `{ refreshToken? }` — revokes current session |
| GET | `/auth/oauth/:provider` | Starts OAuth flow. Providers: `google`, `apple`, `facebook` |
| GET | `/auth/oauth/:provider/callback` | Handles OAuth redirect callback |
| GET | `/auth/sessions` | List active sessions (device, IP, `current` flag) |
| DELETE | `/auth/sessions/:id` | Revoke a session family |

See [security.md](security.md) for OAuth linking rules and session semantics.

---

## Channels

| Method | Path | Notes |
|---|---|---|
| GET | `/channels` | List connected channels |
| POST | `/channels` | Connect a channel (triggers OAuth + sync) |
| GET | `/channels/:id` | Channel detail + sync status |
| PATCH | `/channels/:id` | Update channel metadata |
| DELETE | `/channels/:id` | Disconnect + revoke tokens |
| GET | `/channels/:id/library-videos` | Paginated library videos (cursor-based, supports `?q=&type=&sort=`) |
| GET | `/channels/:id/library-playlists` | Synced playlists |
| GET | `/channels/:channelId/automation` | Get automation settings for a channel |
| PUT | `/channels/:channelId/automation` | Update automation settings |
| POST | `/channels/:channelId/automation/suggest` | AI-generated settings suggestion (with heuristic fallback) |

Channel sync is enqueued on channel creation / OAuth link. Tokens are encrypted at rest; see [security.md](security.md).

---

## Projects

| Method | Path | Notes |
|---|---|---|
| GET | `/projects` | List projects (scoped to authenticated user) |
| POST | `/projects` | Create project — requires `channelId` in body |
| GET | `/projects/:id` | Project detail |
| PATCH | `/projects/:id` | Update project |
| DELETE | `/projects/:id` | Delete project |

---

## Jobs

| Method | Path | Notes |
|---|---|---|
| POST | `/jobs` | Enqueue a job — body: `{ type, projectId, payload, idempotencyKey? }` |
| GET | `/jobs/:id` | Job status + result (poll or use WebSocket for push) |
| GET | `/jobs` | List jobs — filter by `?projectId=` |
| GET | `/admin/jobs` | Admin: all jobs (SUPER_ADMIN only) |
| POST | `/admin/jobs/:id/retry` | Admin: retry a failed job |
| POST | `/admin/jobs/:id/cancel` | Admin: cancel a running job |

Duplicate enqueue with the same `idempotencyKey` returns the original job without re-running it.

---

## Compliance

| Method | Path | Notes |
|---|---|---|
| POST | `/compliance/check` | `{ title, script, description?, tags? }` → `ComplianceResult` (passed, score, flags[], reviewerAI, summary) |
| POST | `/compliance/enforce` | Same as `/check` but throws `400` if result is not passed |

No content reaches the publishing engine without a passed `ComplianceResult`. `ComplianceAgent` cannot be bypassed. See [compliance.md](compliance.md).

---

## Approvals

| Method | Path | Notes |
|---|---|---|
| GET | `/approvals` | List approvals — filter by `?projectId=` |
| POST | `/approvals/:id/approve` | `{ notes? }` — approve. Sets status to `APPROVED`. |
| POST | `/approvals/:id/reject` | `{ notes? }` — reject. Sets status to `REJECTED`. |

Expired approvals block publish; a new approval must be created. `POST /publishing/publish` throws `403` if no valid `APPROVED` approval exists for the content.

---

## Publishing

| Method | Path | Notes |
|---|---|---|
| POST | `/publishing/publish` | `{ videoId, channelId, title, description, tags[], categoryId?, scheduledAt?, videoFilePath, approvalId }` — requires a valid `APPROVED` Approval. Throws `403` if unmet. Available to all authenticated users — no per-user grant required. |
| GET | `/publishing/stats/:channelId/:youtubeVideoId` | Post-publish analytics snapshot |

See [youtube-publishing.md](youtube-publishing.md) for the full publish gate sequence.

---

## Shorts Studio

All routes are JWT-guarded with ownership checks per project. Routes under `/shorts-studio` map to the `ShortsStudioModule`.

| Method | Path | Notes |
|---|---|---|
| GET | `/shorts-studio/channels/:channelId/videos` | List channel videos from YouTube (`?pageToken=` for pagination) |
| POST | `/shorts-studio/import` | `{ channelId or projectId, youtubeVideoId }` — create `ImportedVideo` |
| GET | `/shorts-studio/:projectId/videos` | List imported videos for a project |
| GET | `/shorts-studio/:projectId/recommendations` | Clip recommendations |
| POST | `/shorts-studio/:projectId/generate` | `{ clipTypes[] }` — generate clips |

Additional endpoints under `/shorts-studio/:projectId/*`: timeline editing, AI assistant suggestions, thumbnail management, export, semantic search, chapter sync, social content generation, and clip publish flow. Full Shorts Studio pipeline spec: `docs/` and root `ai.md`.

---

## Billing & Wallet

| Method | Path | Notes |
|---|---|---|
| GET | `/wallet/balance` | Balance + per-bucket breakdown (promo / bonus / referral / purchased) |
| GET | `/wallet/transactions` | Credit ledger entries (`?take=`) |
| GET | `/wallet/lots` | Credit lots with expiry |
| POST | `/wallet/recharge` | `{ amountUsd? or packId, successUrl, cancelUrl }` + `Idempotency-Key` header → Stripe Checkout URL. Credits granted only by the verified Stripe webhook. |
| POST | `/wallet/budget` | `{ monthlyLimit, alertThreshold?, hardCap? }` — set per-user monthly cap |
| GET | `/wallet/insights` | Rule-based optimization tips (budget pace, low balance, expiring lots) |
| POST | `/billing/webhook` | Stripe webhook — public endpoint, signature-verified |
| GET | `/billing/subscription` | Current subscription plan and status |

See [monetization-framework.md](monetization-framework.md) for credit economics, lot consumption order, and reserve/settle semantics.

---

## Organizations

| Method | Path | Notes |
|---|---|---|
| POST | `/orgs` | `{ name, billingEmail? }` — create org; caller becomes `ORG_ADMIN`; org wallet provisioned in same transaction |
| GET | `/orgs/:id` | Org detail |
| PATCH | `/orgs/:id` | Update org |
| POST | `/orgs/:id/members` | `{ userId, role }` — add or update member |
| DELETE | `/orgs/:id/members/:userId` | Remove member |
| GET | `/orgs/:id/budget` | Current budget-period status |
| POST | `/orgs/:id/budget` | Create a budget period — requires `MANAGE_BUDGET` permission |

---

## Trial & Growth

| Method | Path | Notes |
|---|---|---|
| GET | `/trial/status` | Trial grant status, remaining trial credits, expiry |
| POST | `/trial/start` | Activate trial |
| GET | `/growth/referral-code` | Get-or-create referral code (8-char, deterministic) |
| POST | `/growth/referral/apply` | `{ code }` — apply a referral code |
| GET | `/growth/report` | Growth analytics report |

---

## Analytics

| Method | Path | Notes |
|---|---|---|
| GET | `/analytics` | `?channelId=&from=&to=` — channel KPIs and analytics snapshots |
| GET | `/bi` | Business intelligence aggregates |

---

## Developer Portal

| Method | Path | Notes |
|---|---|---|
| POST | `/dev-portal/keys` | Create an API key — `{ name, scopes[] }` |
| GET | `/dev-portal/keys` | List developer keys |
| DELETE | `/dev-portal/keys/:id` | Revoke a key |
| POST | `/dev-portal/webhooks` | Register an outbound webhook |
| GET | `/dev-portal/webhooks` | List webhooks |
| DELETE | `/dev-portal/webhooks/:id` | Delete a webhook |

**External API** (`/dev-api/*`): authenticated by developer key (not user JWT). Sandbox keys are rejected on production AI actions. Scopes: `projects:read`, `jobs:read`, `jobs:write`.

| Method | Path | Notes |
|---|---|---|
| GET | `/dev-api/v1/projects` | List projects (owner-scoped via key) |
| GET | `/dev-api/v1/projects/:id` | Project detail |
| GET | `/dev-api/v1/projects/:id/jobs` | Jobs for a project |
| GET | `/dev-api/v1/jobs/:id` | Job status + result |
| POST | `/dev-api/v1/projects/:id/jobs` | Enqueue a job — first paid AI action; scope `jobs:write` required |

---

## Video Editor

Standalone multi-track video editor. All routes are JWT-guarded with ownership checks. The `editor` module is separate from the Shorts clip editor.

| Method | Path | Notes |
|---|---|---|
| POST | `/editor/projects/:projectId` | Create an `EditProject` within a project. Body: `{ blank?, title?, width?, height?, fps?, sourceKind?: 'VIDEO'\|'IMPORTED_VIDEO'\|'ASSET', sourceId? }` |
| GET | `/editor/projects/:projectId` | List `EditProject` records for a project |
| GET | `/editor/mine` | All edit projects owned by the current user |
| POST | `/editor/blank` | Create a blank `EditProject`; container project resolved server-side |
| POST | `/editor/from-imported/:importedVideoId` | Open an `ImportedVideo` in the editor; project resolved from the video |
| GET | `/editor/:id` | Get a single `EditProject` |
| PUT | `/editor/:id/timeline` | Save and validate the timeline JSON against `EditTimelineSchema` (Zod) |
| GET | `/editor/:id/media-bin` | List assets droppable onto the timeline |
| POST | `/editor/:id/render` | Enqueue an `EDIT_RENDER` job. Body: `{ preset?: EditRenderPreset, format?: 'mp4'\|'webm', quality?: 'draft'\|'standard'\|'high' }` |
| GET | `/editor/:id/render-status` | Poll render status and download path |

**Export presets:** `1080P_16_9` (1920×1080) / `1080P_9_16` (1080×1920) / `720P_16_9` (1280×720) / `1080P_1_1` (1080×1080) / `SOURCE` (project dims). **Format:** `mp4` (libx264+aac, default) or `webm` (libvpx-vp9+libopus). **Quality:** `draft` / `standard` (default) / `high`.

See [features.md](features.md) for timeline schema detail and render implementation limits.

---

## Copilot

| Method | Path | Notes |
|---|---|---|
| POST | `/copilot` | `{ messages[], context? }` — conversational AI assistant turn |
| POST | `/intents` | `{ command, confirmed? }` — unified intent execution (UI, chat, voice same path) |
| GET | `/token-usage` | Token usage summary by model and by video |

---

## Settings & Notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/settings` | Current user settings |
| PATCH | `/settings` | Update settings |
| GET | `/notifications` | In-app notifications (`?unreadOnly=`) + unread count |
| PATCH | `/notifications/:id` | Mark a notification as read |

---

## Admin (SUPER_ADMIN only)

| Method | Path | Notes |
|---|---|---|
| GET | `/flags` | List feature flags |
| PATCH | `/flags` | Update feature flags |
| POST | `/ai-ops/prompts` | Activate a prompt version |
| GET | `/admin/audit-logs` | Append-only audit log |
| POST | `/billing/admin/refund` | Full or partial Stripe refund with proportional credit claw-back; audited |
| POST | `/billing/admin/wallet-adjust` | Grant or claw back credits with reason; audited |

---

## Observability

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness check — returns `{ status: 'ok' }`. No auth required. |
| GET | `/metrics` | Prometheus metrics scrape endpoint. Protected by network policy. `MetricsInterceptor` records `http_request_duration_ms` histogram per route. |

---

## Idempotency

`POST /wallet/recharge` requires an `Idempotency-Key` header. Any mutating wallet operation that can be retried by the client should include this header to prevent duplicate credit grants.

`AgentJob` deduplication: supplying `idempotencyKey` in the job payload causes duplicate enqueue calls to return the original job record without creating a new BullMQ job.

---

## Real-Time (WebSocket)

The NestJS WebSocket gateway (via `@nestjs/websockets` + `socket.io-client`) pushes job-progress events to connected browsers. Clients subscribe to `project:{id}` and `job:{id}` channels. Event shape:

```json
{ "type": "job.progress", "jobId": "...", "step": "compliance", "status": "running", "progress": 0.4 }
```

The WebSocket gateway is not documented in the OpenAPI/Swagger spec.

---

## Planned / Not Yet Implemented

- **Full Swagger decorator coverage** — partial; not all controllers are fully decorated.
- **WebSocket API documentation** — the Socket.io gateway handles real-time job progress but is not reflected in the OpenAPI spec.
