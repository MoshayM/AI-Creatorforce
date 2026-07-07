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

## 20. Shorts Studio

Module spec: repo-root `ai.md`. All routes prefixed `/shorts-studio`, JWT-guarded, ownership-checked per project.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/shorts-studio/channels/:channelId/videos` | Page through the channel's uploads (`?pageToken=`) |
| GET | `/shorts-studio/videos/:youtubeVideoId/metadata` | Fetch metadata without importing (`?channelId=`) |
| POST | `/shorts-studio/videos/import` | `{ projectId, youtubeVideoId }` → ImportedVideo |
| GET | `/shorts-studio/projects/:projectId/videos` | List imported videos with analysis counts |
| POST | `/shorts-studio/videos/:id/analyze` | Enqueue the SHORTS_ANALYZE pipeline (import → transcript → scenes → topics → highlights → chapters) |
| GET | `/shorts-studio/videos/:id/analysis-status` | Aggregated per-stage status + output counts |
| GET | `/shorts-studio/videos/:id/transcript` | TranscriptSegment[] |
| GET | `/shorts-studio/videos/:id/scenes` | VideoScene[] |
| GET | `/shorts-studio/videos/:id/topics` | TopicSegment[] with highlight scores |
| GET | `/shorts-studio/videos/:id/highlights` | Highlight[] ranked by finalScore |
| GET | `/shorts-studio/videos/:id/recommendations` | Top-N clip recommendations (`?limit=5\|10\|20`, no AI call) |
| GET | `/shorts-studio/videos/:id/chapters` | Chapter[] — contiguous YouTube-style chapters (Ai-video edit.md §5, Phase 5) |
| POST | `/shorts-studio/videos/:id/detect-chapters` | Enqueue standalone CHAPTER_DETECTION (for videos analyzed before chapters shipped; self-skips if chapters exist) |
| PATCH | `/shorts-studio/chapters/:chapterId` | `{ title?, summary? }` — manual edit, sets `editedByUser` so re-detection keeps it |
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
| GET | `/token-usage/summary` | `?days=30` → total tokens/cost, per-model breakdown (all AI calls in the process, agents included), copilot cache-hit rate (§12.3 target ≥80%). Feeds the Analytics "AI Usage" card. |

Every turn lands in the `actions` audit table (source `UI`/`COPILOT`/`VOICE`, status, `fromCache`, `tokensUsed`); spoken turns also record `voice_commands` (raw transcript + resolved intent); `copilot_sessions` keeps compressed per-user intent history. The `token_usage` ledger is populated by a global usage hook on the shared aiClient — no AI call goes unmetered.
