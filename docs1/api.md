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
{
  "error": {
    "code": "COMPLIANCE_BLOCKED",
    "message": "Content blocked by compliance gate.",
    "details": [{ "field": "script", "reason": "Unverified factual claim at 02:14" }],
    "correlationId": "req_01H..."
  }
}
```

Standard codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`, `RATE_LIMITED`, `BUDGET_EXCEEDED`, `COMPLIANCE_BLOCKED`, `APPROVAL_REQUIRED`, `ASSET_NOT_READY`, `CONFLICT`, `PROVIDER_ERROR`, `INTERNAL`.

## 2. Auth & Account

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/auth/session` | Create session (handled by Auth.js routes) |
| DELETE | `/auth/session` | Sign out |
| GET | `/me` | Current user + plan + usage |
| GET | `/me/usage` | Token/credit usage vs limits (tokens, voice s, images, video/music credits, render min) |

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
| POST | `/content/script/section` | Regenerate one section (incremental) → `202 {jobId}` |
| POST | `/content/factcheck` | Fact-check a script (changed claims only on revision) |
| GET | `/content/:projectId/script` | Fetch current script |
| PATCH | `/content/:projectId/script` | Edit script (triggers WF-7a re-review) |

## 8. Compliance

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/compliance/review` | Run compliance gate on a bundle (diff-aware on re-review) |
| GET | `/compliance/:projectId` | Latest compliance report |

Response includes `complianceScore`, `monetizationRisk`, `copyrightRisk`, `recommendation`, `ruleSetVersion`, and `flags[]`.

## 9. Music Intelligence

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/music/brief` | Generate music brief/prompt |
| POST | `/music/generate` | Trigger generation job → `202` |
| GET | `/music/:assetId` | Asset status + versions + R2 refs |

## 10. Voice Intelligence  *(new — `media-pipeline.md` §5)*

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/voice/spec` | VoiceAgent: per-section VoiceSpecs |
| POST | `/voice/generate` | TTS jobs (all or `?sectionId=`) → `202` |
| GET | `/voice/:assetId` | Take status + word timestamps + versions |
| POST | `/voice/profile/consent` | Register creator voice-clone consent artifact |

## 11. Video & Image Intelligence

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/video/sceneplan` | Scene plan + shot list |
| POST | `/video/prompts` | Provider prompts for configured video providers |
| POST | `/video/generate` | Trigger video generation job → `202` |
| GET | `/video/:assetId` | Asset status + versions |
| POST | `/images/briefs` | ImageAgent: per-scene briefs *(new)* |
| POST | `/images/generate` | Image generation jobs → `202` *(new)* |
| GET | `/images/:assetId` | Candidates/versions *(new)* |

## 12. Thumbnail Intelligence

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/thumbnails/concepts` | Generate concepts + prompts |
| POST | `/thumbnails/generate` | Generate variants → `202` |
| POST | `/thumbnails/:projectId/select` | Choose A/B winner |

## 13. Subtitles  *(new — `media-pipeline.md` §7)*

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/subtitles/generate` | Build cues from script + voice timestamps (or aligned STT) → `202` |
| GET | `/subtitles/:assetId` | Cues + SRT/VTT/styled JSON refs |
| PATCH | `/subtitles/:assetId/cues` | Edit cues (text-meaning change → WF-7a) |
| POST | `/subtitles/:assetId/translate` | Per-locale translation versions → `202` |

## 14. Editor & Timeline  *(new — `video-editor.md`)*

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/editor/:projectId/firstcut` | EditPlanAgent first cut → `202 {jobId}` |
| GET | `/editor/:projectId/timeline` | Working draft + version list |
| PATCH | `/editor/:projectId/timeline` | Autosave draft (optimistic-locked; `409 CONFLICT` on stale) |
| POST | `/editor/:projectId/timeline/versions` | Freeze a version (label) |
| GET | `/editor/:projectId/timeline/versions` | Version history + diff summaries |
| POST | `/editor/:projectId/timeline/versions/:v/restore` | Non-destructive restore |

## 15. Render  *(new — WF-8)*

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/render` | `{projectId, timelineVersion, preset}` → gate-checked, budget-reserved `202 {jobId, renderId}` (idempotent per unique key) |
| GET | `/render/:id` | Status, progress, checksum, size |
| GET | `/render/:id/download` | Signed URL for local save |
| GET | `/render?projectId=` | Renders for a project |

`POST /render` returns `409 COMPLIANCE_BLOCKED` pre-pass, `409 ASSET_NOT_READY` if referenced versions are pending, `402 BUDGET_EXCEEDED` with zero spend.

## 16. Metadata & Publishing

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/metadata/finalize` | Publish-ready metadata + disclosures (incl. synthetic-media flags) |
| POST | `/publish` | Publish/schedule (gate-checked; publishes the pinned render) → `202 {jobId}` |
| GET | `/publish/:projectId` | Publish receipt/status |
| POST | `/publish/:projectId/schedule` | Set/update schedule |

`POST /publish` returns `409 COMPLIANCE_BLOCKED` or `409 APPROVAL_REQUIRED` if gates unmet.

## 17. Analytics & Growth

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/analytics/:channelId/overview` | Channel KPIs |
| GET | `/analytics/video/:videoId` | Per-video diagnostics (retention over section markers) |
| POST | `/growth/report` | Generate growth report |
| GET | `/growth/recommendations` | Next-video recommendations |

## 18. Projects & Jobs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/projects` | List content projects |
| POST | `/projects` | Create project |
| GET | `/projects/:id` | Project detail (full bundle + state) |
| POST | `/projects/:id/run` | Run a workflow (full/script/assets/edit/publish) |
| GET | `/jobs/:id` | Job status/result |
| GET | `/jobs?projectId=` | Jobs for a project |

## 19. Billing

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/billing/plan` | Current plan |
| POST | `/billing/checkout` | Stripe checkout session |
| POST | `/billing/portal` | Stripe customer portal |
| POST | `/billing/webhook` | Stripe webhook (signature-verified) |

## 20. Admin (internal — `admin.md`)

`/api/admin/*` on a separate guarded module (internal SSO + role + IP allow-list); excluded from the public OpenAPI spec. Areas: users/plans, abuse queue, feature flags, prompt ops, provider/routing ops, compliance rule sets, queues, billing ops.

## 21. Realtime

- **WebSocket:** `/ws` — subscribe to `project:{id}` and `job:{id}` channels for status, progress, agent trace, and streaming `write`-class output.
- **SSE fallback:** `GET /projects/:id/stream`.

Event shapes:
```jsonc
{ "type": "job.progress", "jobId": "...", "step": "render", "status": "running", "progress": 0.4 }
{ "type": "asset.version.created", "assetId": "...", "version": 3 }
{ "type": "render.ready", "renderId": "...", "preset": "yt_1080p" }
{ "type": "timeline.version.created", "projectId": "...", "version": 5 }
```

## 22. Rate Limits & Budgets

- Per-user request rate limits (Redis token bucket) returned via `X-RateLimit-*` headers.
- AI/voice/image/video/music/render generation checks plan budget **before** dispatch (reservation model); `402/409 BUDGET_EXCEEDED` if insufficient. See `monetization-framework.md` and `token-optimization.md` §12.

## 23. Webhooks (outbound, optional for agencies)

`project.completed`, `render.ready`, `publish.succeeded`, `publish.failed`, `compliance.blocked` — signed with an HMAC secret.

## 24. Versioning

URI-versioned (`/api/v1`). Breaking changes ship under a new version; deprecations announced via `Deprecation` and `Sunset` headers.
