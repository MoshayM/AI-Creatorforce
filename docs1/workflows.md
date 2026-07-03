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
 ├─ 1. Discover            TrendAgent        → scored topic candidates
 ├─ 2. Select topic        [HUMAN]           → creator picks / confirms topic
 ├─ 3. SEO research        SEOAgent          → keywords, metadata draft, SEO score
 ├─ 4. Audience strategy   AudienceAgent     → hooks, emotional angle, retention plan
 ├─ 5. Research            ResearchAgent     → sourced research pack
 ├─ 6. Script              ScriptAgent       → structured script (Hook→…→CTA, per-section hashes)
 ├─ 7. Fact check          FactCheckAgent    [GATE] → claims verified or returned
 ├─ 8. Compliance          ComplianceAgent   [GATE] → pass / revise / block
 ├─ 9. Asset specs         [∥]
 │     ├─ VoiceAgent       → per-section VoiceSpec
 │     ├─ MusicAgent       → music brief/prompt
 │     ├─ VideoAgent       → scene plan, shot list, video prompts
 │     ├─ ImageAgent       → per-scene image briefs
 │     └─ ThumbnailAgent   → thumbnail concepts + CTR prediction
 ├─10. Asset generation    [∥] (queued provider jobs; budget-reserved; provenance stored in R2)
 │     ├─ Voice (TTS per section)      queue: assets-voice
 │     ├─ Music                        queue: assets-music
 │     ├─ Video clips                  queue: assets-video
 │     ├─ Images                       queue: assets-image
 │     └─ Thumbnails                   queue: assets-thumbnail
 ├─11. First cut           EditPlanAgent     → Timeline v1 from script + ready assets
 ├─12. Edit                [HUMAN]           → creator refines timeline (video-editor.md);
 │                                             proxy renders on demand (WF-8 draft preset)
 ├─13. Subtitles           SubtitleAgent     → cues from script + voice timestamps; creator tweaks
 ├─14. Final render        Render worker     [GATE on asset readiness] → WF-8 final preset
 ├─15. Metadata finalize   MetadataAgent     → publish-ready metadata + disclosures (incl. synthetic-media flags)
 ├─16. Review & approve    [HUMAN][GATE]     → creator approves full bundle incl. the rendered video
 ├─17. Publish/schedule    PublishingAgent   → YouTube upload (from pinned render) + receipt
 ├─18. Analytics           AnalyticsAgent    → growth report (after data accrues; retention overlaid on section markers)
 └─19. Growth              GrowthAgent       → next-video recommendations + memory writes → feeds WF-1 step 1
END (loops)
```

**Failure routing:** any agent failure → retry (backoff) → `QualityControlAgent` → `[HUMAN]` escalation. A `[GATE]` block returns the bundle to the creator with specific, actionable reasons. Asset-generation failures affect only their branch; the pipeline proceeds with available assets and the editor flags the gap.

**MVP note:** steps 10–14 ship in Beta (`build.md`); MVP runs WF-1 with asset *briefs* only and external generation, publishing a creator-supplied render.

---

## WF-2: Trend Discovery (standalone)

```
1. Inputs: niche, region, window, competitor set
2. Pull signals (cached): YouTube trends, Google Trends, competitor monitor
3. TrendAgent scores candidates (trend/competition/revenue/virality/recommendation),
   deduped against existing projects/channel memory
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

Section-level revisions re-run only the affected section + changed claims (`token-optimization.md` §6), then WF-7 applies.

---

## WF-4: Asset Production (post-script)

Runs only on a compliance-passed script.

```
1. Inputs: approved script + style guide + provider preferences
2. [∥] VoiceAgent · MusicAgent · VideoAgent · ImageAgent · ThumbnailAgent produce specs/briefs
3. Creator triggers generation jobs per asset (budget reserved before dispatch; cost shown first)
4. Generated assets stored in R2 as asset versions with provenance (media-pipeline.md §9)
5. [HUMAN] review assets → accept / regenerate (regeneration appends a new version)
```

---

## WF-5: Publish & Schedule

```
1. Precondition check [GATE]: compliancePassed == true AND humanApproved == true
   AND bundleHash matches reviewed (incl. the pinned final render)
2. MetadataAgent finalizes metadata + AI/disclosure flags
3. PublishingAgent uploads the pinned R2 render or schedules via YouTube Data API (idempotent)
4. Store publish receipt (videoId, status, scheduledTime)
5. Register analytics polling job
```

If preconditions fail, the workflow refuses and explains which gate is unmet. There is no override path that skips the compliance gate.

---

## WF-6: Analytics → Growth Loop

```
1. Scheduled poll of YouTube Analytics for published videos
2. Snapshot metrics to Postgres (CTR, retention curve, watch time, revenue, subs)
3. AnalyticsAgent diagnoses performance (retention mapped onto timeline section markers)
4. GrowthAgent produces prioritized actions + next topics; distilled findings → channel memory
5. Next topics seed WF-2/WF-1; recommendations surface in dashboard
```

---

## WF-7: Compliance & Approval Re-review (on edit)

Any edit to an approved bundle invalidates prior approval.

```
1. Detect change after a prior pass, classified by scope:
   a. Text-meaning change (script sections, metadata, subtitle cue text vs script)
      → reset compliancePassed = false AND humanApproved = false
      → re-run ComplianceAgent [GATE] on the diff + bundle map
   b. Arrangement-only change (timeline edits, asset swaps among passed assets, new render)
      → reset humanApproved = false (compliance pass persists)
2. Require fresh [HUMAN] approval before WF-5 in both cases
```

No "stale pass" can reach publish; the bundle hash comparison in WF-5 enforces this even if state flags were somehow inconsistent.

---

## WF-8: Render & Export

```
1. Input: (timelineId, timelineVersion, preset)  — preset ∈ draft_proxy | yt_1080p | yt_4k | shorts_1080x1920
2. [GATE] validate: project compliance-passed; all referenced asset versions ready;
   duration within plan limits; render budget available (reserved)
3. Idempotency check: existing render for (projectId, timelineVersion, preset) → return it (no spend)
4. Render worker compiles timeline → FFmpeg graph → encodes; streams render.progress events
5. Store output in R2 + renders row (checksum, duration, size); settle budget
6. draft_proxy: available immediately in the editor preview loop
   final presets: pinned to the project bundle → triggers WF-7(b) if the project was already approved
7. Creator may download via signed URL (local save); WF-5 always publishes from the R2 render
```

Failures: transient errors retry with backoff; validation errors return node-path reasons to the editor; reserved credits are released on failure.

---

## Human-in-the-Loop Checkpoints (summary)

| Checkpoint | Why it exists |
|------------|---------------|
| Topic selection | Creator owns editorial direction |
| Script approval | Originality + voice + accuracy |
| Edit session | Creative control over the cut |
| Asset review | Quality + brand fit + rights |
| Final approval before publish | Last safety/quality gate — includes watching the rendered video |

Auto-publish is only permitted for an item that has already passed compliance **and** received explicit prior human approval, scheduled by the creator. Even then, WF-7 forces re-approval if anything changed.

---

## Idempotency & State

- Each step is keyed `(projectId, step)`. Re-running a completed step is a no-op unless inputs changed (content hash differs).
- Renders are keyed `(projectId, timelineVersion, preset)`; media generations by their spec hash.
- n8n workflows persist `executionId`; the API maps it to the `ContentProject` so progress survives restarts.
- All external-provider calls (AI, voice, image, video, music, YouTube) run as queued jobs with retry + dedupe keys and budget reservation before dispatch.
