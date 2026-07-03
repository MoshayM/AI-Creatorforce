# workflows.md — AI CreatorForce

This document defines the orchestrated, multi-step pipelines. Workflows are implemented in two places: short, in-process orchestration in the Agent Runtime (via `SupervisorAgent` + BullMQ jobs), and long, human-paused automations in **n8n** that call the API and enqueue jobs. Compliance and human-review gates are mandatory where marked.

## Conventions

- `[GATE]` = a step that can block progression.
- `[HUMAN]` = a human-approval checkpoint that pauses the workflow.
- `[∥]` = steps that run in parallel.
- Every step writes results + a trace event keyed by the workflow's correlation ID.
- Workflows are resumable: state persists in Postgres; n8n/Supervisor can re-enter at the last completed step.

---

## WF-1: Full Content Pipeline (Idea → Published → Growth)

```
START
 ├─ 1. Discover           TrendAgent        → scored topic candidates
 ├─ 2. Select topic       [HUMAN]           → creator picks / confirms topic
 ├─ 3. SEO research       SEOAgent          → keywords, metadata draft, SEO score
 ├─ 4. Audience strategy  AudienceAgent     → hooks, emotional angle, retention plan
 ├─ 5. Research           ResearchAgent     → sourced research pack
 ├─ 6. Script             ScriptAgent       → structured script (Hook→…→CTA)
 ├─ 7. Fact check         FactCheckAgent    [GATE] → claims verified or returned
 ├─ 8. Compliance         ComplianceAgent   [GATE] → pass / revise / block
 ├─ 9. Asset production   [∥]
 │     ├─ MusicAgent      → music brief/prompt
 │     ├─ VideoAgent      → scene plan, shot list, video prompts
 │     └─ ThumbnailAgent  → thumbnail concepts + CTR prediction
 ├─10. Asset generation   [∥] (external providers, queued; creator-driven)
 │     ├─ Music (Suno/Udio/Stable Audio)
 │     ├─ Video (Veo/Kling/Runway/Pika/Luma)
 │     └─ Thumbnail (image provider)
 ├─11. Metadata finalize  MetadataAgent     → publish-ready metadata + disclosures
 ├─12. Review & approve   [HUMAN][GATE]     → creator approves full bundle
 ├─13. Publish/schedule   PublishingAgent   → YouTube upload + receipt
 ├─14. Analytics          AnalyticsAgent    → growth report (after data accrues)
 └─15. Growth             GrowthAgent       → next-video recommendations → feeds WF-1 step 1
END (loops)
```

**Failure routing:** any agent failure → retry (backoff) → `QualityControlAgent` → `[HUMAN]` escalation. A `[GATE]` block returns the bundle to the creator with specific, actionable reasons.

---

## WF-2: Trend Discovery (standalone)

```
1. Inputs: niche, region, window, competitor set
2. Pull signals (cached): YouTube trends, Google Trends, competitor monitor
3. TrendAgent scores candidates (trend/competition/revenue/virality/recommendation)
4. Return ranked board; creator can promote a candidate into WF-1
```

---

## WF-3: Script Studio (script-only)

```
1. Inputs: confirmed topic + format + length + creator voice profile
2. AudienceAgent → hooks + retention plan
3. ResearchAgent → sourced facts
4. ScriptAgent → structured script
5. FactCheckAgent [GATE]
6. ComplianceAgent [GATE]
7. [HUMAN] edit/approve → save as draft asset
```

---

## WF-4: Asset Production (post-script)

Runs only on a compliance-passed script.

```
1. Inputs: approved script + style guide + provider preferences
2. [∥] MusicAgent · VideoAgent · ThumbnailAgent produce briefs/prompts
3. Creator triggers generation jobs per asset (metered against plan budget)
4. Generated assets stored in R2 with provenance
5. [HUMAN] review assets → accept / regenerate
```

---

## WF-5: Publish & Schedule

```
1. Precondition check [GATE]: compliancePassed == true AND humanApproved == true
2. MetadataAgent finalizes metadata + AI/disclosure flags
3. PublishingAgent uploads or schedules via YouTube Data API (idempotent)
4. Store publish receipt (videoId, status, scheduledTime)
5. Register analytics polling job
```

If preconditions fail, the workflow refuses and explains which gate is unmet. There is no override path that skips the compliance gate.

---

## WF-6: Analytics → Growth Loop

```
1. Scheduled poll of YouTube Analytics for published videos
2. Snapshot metrics to Postgres (CTR, retention curve, watch time, revenue, subs)
3. AnalyticsAgent diagnoses performance
4. GrowthAgent produces prioritized actions + next topics
5. Next topics seed WF-2/WF-1; recommendations surface in dashboard
```

---

## WF-7: Compliance Re-review (on edit)

Any edit to an approved bundle invalidates prior approval.

```
1. Detect change to script/metadata/assets after a prior pass
2. Reset compliancePassed = false, humanApproved = false
3. Re-run ComplianceAgent [GATE]
4. Require fresh [HUMAN] approval before WF-5
```

---

## Human-in-the-Loop Checkpoints (summary)

| Checkpoint | Why it exists |
|------------|---------------|
| Topic selection | Creator owns editorial direction |
| Script approval | Originality + voice + accuracy |
| Asset review | Quality + brand fit + rights |
| Final approval before publish | Last safety/quality gate |

Auto-publish is only permitted for an item that has already passed compliance **and** received explicit prior human approval, scheduled by the creator. Even then, WF-7 forces re-approval if anything changed.

---

## Idempotency & State

- Each step is keyed `(projectId, step)`. Re-running a completed step is a no-op unless inputs changed (content hash differs).
- n8n workflows persist `executionId`; the API maps it to the `ContentProject` so progress survives restarts.
- All external-provider calls (AI, video, music, YouTube) run as queued jobs with retry + dedupe keys.
