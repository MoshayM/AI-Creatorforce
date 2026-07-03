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
| POST | `/auth/session` | Create session (handled by Auth.js routes) |
| DELETE | `/auth/session` | Sign out |
| GET | `/me` | Current user + plan + usage |
| GET | `/me/usage` | Token/credit usage vs limits |

## 3. Channels (YouTube)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/channels` | List connected channels |
| POST | `/channels/connect` | Start YouTube OAuth connect flow |
| GET | `/channels/oauth/callback` | OAuth redirect handler |
| DELETE | `/channels/:id` | Disconnect & revoke tokens |
| GET | `/channels/:id` | Channel details + sync status |

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
