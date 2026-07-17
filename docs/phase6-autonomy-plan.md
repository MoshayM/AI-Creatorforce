# Phase 6 — AI Autonomy: Implementation Plan (living doc)

Grounded version of `AI Autonomy.txt`, mapped to the actual codebase.
Status legend: ✅ shipped · 🔨 next · ⬜ later

## Guiding constraint (non-negotiable)

Autonomy **plans**; humans **approve**. Approving a calendar slot creates a
`DRAFT` Video — every existing gate (approvals module, publish approval,
compliance) stays untouched. No autonomous publishing in this phase.

## Milestone 1 — Foundation

| Item | Status | Where |
|---|---|---|
| Channel profile system (long-term memory, M1-lite) | ✅ | `apps/api/src/modules/autonomy/autonomy.service.ts` → `ChannelProfile` model. Aggregates 90-day cadence, best weekday/hour histograms, format mix, avg views, pipeline counts from `LibraryVideo` + `Video`. |
| Auto content-calendar generator | ✅ | `POST /autonomy/channels/:id/calendar/generate` — profile + `TrendService.analyze()` context → `callAIStructured()` (Claude, GPT-4o/Gemini fallback) → `ContentCalendarEntry` rows. Heuristic cadence fallback when no AI provider is reachable. |
| Dry-run simulation | ✅ | `dryRun: true` generates and returns the plan without persisting — the spec's "simulation mode before execution". |
| Approve/dismiss loop | ✅ | Approve → `DRAFT` Video parked at `scheduledAt = plannedAt` under the channel's newest project (auto-creates "AI Content Calendar" project when none). |
| Panel UI | ✅ | `/autonomy` page (profile cards, generate controls, proposal review) + AI-planned chips on the `/scheduler` month view. |
| Multi-step autonomous planning in Supervisor | 🔨 | Add `CALENDAR_PROPOSAL` JobType (shared `job.schema.ts` + Prisma enum + `supervisor.worker.ts` dispatch case) so generation runs on the queue with credit reservation like other agents. |
| Vector memory | ⬜ | Profile JSON is deliberate M1-lite; revisit vector store (spec §5) only when reasoning needs recall beyond the snapshot. Local-first: pgvector over Pinecone. |

## Milestone 2 — Intelligence layer

| Item | Status | Where |
|---|---|---|
| `autoPlan` flag on `ChannelAutomation` | ✅ | `schema.prisma` → migration `20260717104947_automation_auto_plan`. `AutomationSettingsSchema` updated with `autoPlan: z.boolean().default(false)`. |
| Auto-plan tick in Supervisor | ✅ | `automation.service.ts` step **e**: every 20 h per channel (guard via `lastPlanAt`), stamps before AI call to prevent retry storms, calls `autonomy.autoPlanTick()`. |
| `autoPlanTick()` | ✅ | `autonomy.service.ts` — counts upcoming `PROPOSED`+`APPROVED` slots; tops up via `generateCalendarInternal({weeks:2})` when < 3 future slots remain. |
| Self-critique pass | ✅ | `CritiqueSchema` + `critiqueProposal()` in `autonomy.service.ts` — second `callAIStructured` judges first draft, drops `keep=false` entries, re-scores priorities. Critique summary surfaced in UI (`/autonomy` page) and returned in `GenerateCalendarResult.critique`. |
| Auto-plan toggle in Automation UI | ✅ | `automation/page.tsx` — "Auto-plan content calendar" toggle with description; wired to `autoPlan` field. |
| Feed real analytics into profile | ⬜ | Replace `LibraryVideo` proxies with analytics module retention/CTR once snapshots cover enough history. |

## Milestone 3 — Autonomy core

| Item | Status | Where |
|---|---|---|
| Auto-research on approve (opt-in) | ✅ | `autoResearch` flag on `ChannelAutomation` (migration `20260718_autonomy_m3_auto_research`). `approve()` in `autonomy.service.ts` enqueues `RESEARCH` with `topic=entry.title` when flag is set; best-effort, never blocks the response. Toggle in Automation UI. |
| Escalation protocol | ✅ | `escalateStale()` in `autonomy.service.ts` — finds `PROPOSED` entries > 3 days old, fires `CALENDAR_STALE` in-app notification (24 h dedupe). Called from `automation.service.ts` step **f** in `tickChannel()` on every heartbeat. |
| Audit (lightweight) | ✅ | Structured log lines via `AutonomyService.logger` on every approve/escalate/auto-research action — visible in `logs/api.log`. Full `AgentLog` rows deferred to when generation moves to the queue. |
| Multi-step autonomous planning in Supervisor | 🔨 | Move `generateCalendarInternal()` onto the `AGENT_QUEUE` as a `CALENDAR_PROPOSAL` `JobType` so generation gets credit reservation and AgentJob audit trail like other workers. |

## Milestone 4 — Testing & hardening

| Item | Status | Where |
|---|---|---|
| Proper Playwright spec | ✅ | `apps/e2e/src/autonomy.spec.ts` — 12 tests across profile cards, calendar generate, dry-run, critique display, approve/dismiss, Scheduler AI chips, Automation toggles, and guiding-constraint assertion (no publish button). All API calls mocked via route intercepts. |
| Synthetic-channel alpha (spec §4) | ✅ | `SYNTHETIC_CHANNEL` + `SYNTHETIC_PROFILE` mock data in `autonomy.spec.ts`; heuristic-path sub-suite (`describe('synthetic channel alpha')`) verifies zero-cost generation with `source='heuristic'` and `critique=null`. No real YouTube OAuth or AI API key required. |
| `CALENDAR_PROPOSAL` job type on queue | ✅ | Added to `JobTypeSchema` + Prisma enum (migration `20260717192741_autonomy_m4_calendar_proposal`). `generateCalendarForJob()` in `AutonomyService` is the supervisor-callable wrapper. `case 'CALENDAR_PROPOSAL'` in `supervisor.worker.ts`. `POST /autonomy/channels/:id/calendar/generate-async` returns `{jobId}`; caller polls `GET /jobs/:id`. `AutonomyModule` imported in `WorkersModule`. |
| Feed real analytics into profile | ⬜ | Replace `LibraryVideo` proxies with analytics module retention/CTR once snapshots cover enough history. |
| Vector memory | ⬜ | Profile JSON is deliberate M1-lite; revisit vector store (spec §5) only when reasoning needs recall beyond the snapshot. Local-first: pgvector over Pinecone. |

## Milestone 5 — Calendar lifecycle management

| Item | Status | Where |
|---|---|---|
| Auto-expire overdue proposals | ✅ | `expireOverdue()` in `autonomy.service.ts` — PROPOSED entries past `plannedAt` by > 1 day auto-dismissed; triggers `autoPlanTick()` replan. Called from `automation.service.ts` step **g** in `tickChannel()`. |
| Calendar stats endpoint | ✅ | `getCalendarStats()` in `autonomy.service.ts` + `GET /autonomy/channels/:id/calendar/stats` — returns total/proposed/approved/dismissed/scheduled counts, upcoming7d count, approvalRate%, avgPriority. |
| Hook-focused angle prompt | ✅ | `CalendarProposalSchema.angle` description updated to prompt the AI for a punchy one-sentence scroll-stopper hook rather than a generic description. |
| Title variants per entry | ⬜ | Schema migration needed: `titleVariants String[] @default([])` on `ContentCalendarEntry`; generate 2-3 alternatives in AI call; surface in proposal cards. |
| Performance feedback loop | ⬜ | Feed actual view/like counts from `LibraryVideo`/`AnalyticsSnapshot` back into profile scoring after videos publish. |

## API surface (shipped)

```
GET  /api/v1/autonomy/channels/:channelId/profile?refresh=true
POST /api/v1/autonomy/channels/:channelId/calendar/generate        { weeks?, perWeek?, dryRun? }
POST /api/v1/autonomy/channels/:channelId/calendar/generate-async  { weeks?, perWeek?, dryRun? } → { jobId }
GET  /api/v1/autonomy/channels/:channelId/calendar?status=&from=&to=
GET  /api/v1/autonomy/channels/:channelId/calendar/stats
POST /api/v1/autonomy/calendar/:entryId/approve
POST /api/v1/autonomy/calendar/:entryId/dismiss
```

Models: `ChannelProfile`, `ContentCalendarEntry` (+ `CalendarFormat`, `CalendarEntryStatus`) — migration `20260717061903_phase6_autonomy_calendar`.
JobType: `CALENDAR_PROPOSAL` — migration `20260717192741_autonomy_m4_calendar_proposal`.
