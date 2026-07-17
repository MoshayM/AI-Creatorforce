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

- Nightly `AUTOMATION_TICK` extension: refresh stale `ChannelProfile`s and top up calendars for channels that opt in (`ChannelAutomation` gets an `autoPlan` flag).
- Feed real analytics into the profile: replace `LibraryVideo` proxies with the analytics module's retention/CTR once its snapshots cover enough history.
- Self-critique pass: second `callAIStructured()` round that scores the proposed calendar against the profile before returning (spec §3.3).

## Milestone 3 — Autonomy core

- Approved entry → auto-enqueue `RESEARCH` for the draft video (opt-in), chaining the existing production pipeline.
- Escalation protocol: entries older than N days unreviewed → notification via the notifications module.
- Audit: calendar decisions already persist (`source`, `rationale`, `batchId`); add `AgentLog` rows once generation moves onto the queue.

## Milestone 4 — Testing & hardening

- Extend `apps/e2e/autonomy-smoke.cjs` into a proper Playwright spec.
- Synthetic-channel alpha per spec §4; heuristic mode doubles as the zero-cost test path.

## API surface (shipped)

```
GET  /api/v1/autonomy/channels/:channelId/profile?refresh=true
POST /api/v1/autonomy/channels/:channelId/calendar/generate  { weeks?, perWeek?, dryRun? }
GET  /api/v1/autonomy/channels/:channelId/calendar?status=&from=&to=
POST /api/v1/autonomy/calendar/:entryId/approve
POST /api/v1/autonomy/calendar/:entryId/dismiss
```

Models: `ChannelProfile`, `ContentCalendarEntry` (+ `CalendarFormat`, `CalendarEntryStatus`) — migration `20260717061903_phase6_autonomy_calendar`.
