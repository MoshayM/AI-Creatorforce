# media-pipeline.md — AI CreatorForce

> Owner document for **in-app media production**: voice generation, subtitle generation, image (b-roll) generation, media storage & version history, and the deterministic **render pipeline** that turns an edited timeline into a finished video file. The timeline/editing model itself is owned by `video-editor.md`. Agent contracts are summarized here and registered in `agents.md`.

**Position in the pipeline:** everything in this document runs **after** the compliance gate passes (`compliance.md`) and **before** final human approval and publish (`youtube-publishing.md`). No media generation job may dispatch for a project whose latest compliance report is not `pass` (`database.md` §5).

---

## 1. Purpose & Scope

- Replace "briefs for external tools" with **in-app generation** of voice, images, subtitles, and a rendered video — so the creator never needs external tools (MVP ships briefs; Beta ships this pipeline; see `build.md`).
- Every generated media object is an **Asset** with write-once provenance and version history.
- Rendering is **deterministic infrastructure work** (FFmpeg-class), executed by the Render worker — it is *not* an LLM agent and never calls a model.

Out of scope here: timeline data model, effects/transitions, preview, undo/redo (→ `video-editor.md`); music generation flow specifics (→ `agents.md` MusicAgent, same asset/provenance rules apply); thumbnails (→ ThumbnailAgent, same rules apply).

## 2. Responsibilities

| Component | Kind | Responsibility |
|-----------|------|----------------|
| VoiceAgent | LLM-assisted agent | Voice direction: narration script markup (pauses, emphasis, pacing), voice selection from the channel voice profile, provider-ready TTS request spec |
| TTS jobs | Queued provider calls | Synthesize narration per script section via ElevenLabs / OpenAI TTS / Google Cloud TTS (config-driven; see `model-routing.md` §7) |
| ImageAgent | LLM-assisted agent | Per-scene image briefs → provider-ready image prompts (b-roll stills, diagrams, backgrounds) |
| Image jobs | Queued provider calls | Generate images via configured image providers (e.g., gpt-image, Imagen, Flux, Stable Diffusion endpoints) |
| SubtitleAgent | Deterministic + LLM-assisted | Build subtitles from script timestamps + voice audio alignment; segment, style, and (optionally) translate |
| EditPlanAgent | LLM-assisted agent (owned by `video-editor.md`) | Assemble the first-cut timeline from script + generated assets |
| Render worker | Deterministic worker | Compile timeline JSON + assets → MP4/WebM via FFmpeg; produce proxies and preview segments |
| Asset store | Infrastructure | R2 objects + Postgres `assets`/`asset_versions` rows with provenance |

## 3. Architecture

```
Compliance PASS
   │
   ▼
[∥] VoiceAgent → queue assets-voice → TTS provider → R2 (voice takes)
[∥] ImageAgent → queue assets-image → image provider → R2 (stills)
[∥] MusicAgent → queue assets-music → music provider → R2 (tracks)      (existing)
[∥] VideoAgent → queue assets-video → video provider → R2 (clips)       (existing)
   │
   ▼
EditPlanAgent → first-cut Timeline (video-editor.md)
   │
   ▼  creator edits (Editor)
SubtitleAgent → subtitle track (SRT/VTT + styled JSON)
   │
   ▼
Render worker (queue: render) → proxy render → [HUMAN preview/approve edits]
   │                                   ↑ loop until satisfied
   ▼
Final render (preset) → R2 → version pinned → [HUMAN final approval] → WF-5 publish
```

Queues (extends `architecture.md` §3.6): `assets-voice`, `assets-image`, `subtitles`, `render` (heavy pool — separate worker fleet, CPU/GPU sized; see `deployment.md` §6).

## 4. Data Model (delta — full schema in `database.md`)

- `assets.kind` enum extended: `music | video | thumbnail | voice | image | subtitle | render`.
- **`asset_versions`**: `(id, assetId FK, version int, r2Key, params jsonb, provenance jsonb, sizeBytes, durationMs null, createdAt)` — every regeneration appends a version; nothing is overwritten. `assets.currentVersionId` points at the active one.
- **`renders`**: `(id, projectId FK, timelineId FK, timelineVersion int, preset enum(yt_1080p, yt_4k, shorts_1080x1920, draft_proxy), status enum(queued,rendering,ready,failed), progressPct, r2Key null, sizeBytes, durationMs, checksum, error jsonb null)`.
- Provenance (write-once, `security.md` §10): `{provider, model, promptRef+version, params, generatedAt, license, tosNotes}` on every version.

## 5. Voice Generation

**Flow (WF-1 step 9a / WF-4):**
1. VoiceAgent reads the approved script sections + channel `voiceProfile` and emits a `VoiceSpec` per section: `{sectionId, ssmlOrMarkup, voiceId, provider, speed, stability, pronunciationNotes[]}`. Zod-validated like every agent output.
2. One TTS job per section (parallel, idempotent key `(projectId, "voice", sectionId, specHash)`), each metered against plan voice credits **before dispatch** (`monetization-framework.md` A5).
3. Output audio (per-section takes) stored as `voice` asset versions; word-level timestamps captured where the provider supplies them (used by SubtitleAgent and the editor's audio track alignment).
4. Creator can re-record any single section (incremental regeneration — only that section's job re-runs; `token-optimization.md` §6).

**Guardrails:** voice cloning only from the creator's **own** consented voice samples with recorded consent artifact; never clone third-party voices; synthetic-voice usage feeds the disclosure flags (`compliance.md` §3.4).

## 6. Image Generation (b-roll / stills)

1. ImageAgent maps scenes → `ImageBrief[]`: `{sceneId, prompt, negativePrompt, style (from brandKit), aspect, count}`.
2. Image jobs generate N candidates per brief; all stored as `image` asset versions; creator picks per scene in the Asset Studio (`uiux.md`).
3. Same IP guardrails as thumbnails: no third-party IP, logos, or identifiable real faces without rights; provider safety settings on; violations surface as compliance flags.

## 7. Subtitle Generation

1. **Primary path (deterministic):** subtitles derive from the script's sectioned text + TTS word timestamps → exact, no transcription drift.
2. **Fallback path:** if audio was replaced/edited (creator-uploaded VO), run speech-to-text alignment (Whisper-class provider) against the final audio track.
3. SubtitleAgent segments lines (max chars/line, min duration, reading-speed caps), applies brand-kit styling tokens, and outputs three artifacts stored as one `subtitle` asset: `subtitles.srt`, `subtitles.vtt`, `subtitles.styled.json` (for burned-in rendering).
4. **Multi-language:** optional translation pass per target locale; each locale is a separate asset version; translated factual content inherits the source's fact-check status (no new claims may be introduced — validated by schema: translation output must map 1:1 to source cues).
5. Creator edits cues inline in the editor; edits create a new asset version and re-trigger WF-7 only if *content meaning* changes (cue text hash vs. script hash comparison).

## 8. Render Pipeline

**Input:** immutable snapshot = `(timelineId, timelineVersion)` + the exact asset versions referenced by that timeline. **Output:** a `renders` row + R2 object.

**Steps (Render worker, queue `render`):**
1. Validate the timeline against the render schema (all referenced asset versions exist and are `ready`; total duration within plan limits).
2. Materialize an FFmpeg filter-graph from the timeline JSON: tracks → inputs; clips → trims; transitions/effects/keyframes → filters (catalog in `video-editor.md` §5); subtitle burn-in if enabled, else soft-subs muxed.
3. Render **proxy preset first** (`draft_proxy`, 540p, fast) for creator preview loops; final presets only on explicit request (cost control).
4. Stream progress (`job.progress` events, `api.md` §16); on completion write checksum + duration + size; store to R2.
5. **Local save:** creator downloads via a signed URL (`GET /render/:id/download`); **cloud save** is the R2 object itself with lifecycle rules (`deployment.md` §9). Publishing (WF-5) always uploads from the pinned R2 render — never from a local file.

**Determinism & idempotency:** render jobs are keyed `(projectId, timelineVersion, preset)`; identical inputs → cache hit returns the existing render. Renders are reproducible: the same snapshot always yields the same output (modulo encoder nondeterminism, which checksum tolerance accounts for).

**Failure handling:** transient FFmpeg/provider-asset fetch errors retry with backoff; malformed timelines fail fast with a per-node validation error the editor can highlight; failures never consume render credits (reserved credits released).

## 9. Storage & Version History (owner section for "STORAGE")

- **Buckets/prefixes (R2):** `assets/{projectId}/{assetId}/v{n}/…`, `renders/{projectId}/{renderId}/…`, `exports/…`. Never public; access via short-lived signed URLs only (`security.md` §7).
- **Version history:** append-only `asset_versions` + timeline versions (`video-editor.md` §7); creators can view/restore any prior version; restore = new version pointing at old content (no destructive ops).
- **Lifecycle:** proxies and non-selected candidates expire per plan retention; final renders and published-video sources retained ≥ the plan's retention window; deletes are soft first, purged after the window (`security.md` §9).
- **Dedupe:** content-hash on upload/generation; identical bytes share one R2 object across versions (cost lever, `monetization-framework.md` A3).
- **Provenance immutability:** provenance JSON is written once at version creation and never updated (enforced in the service layer + audit-logged on any attempted mutation).

## 10. API (delta — full surface in `api.md`)

`/voice/spec`, `/voice/generate`, `/voice/:assetId` · `/images/briefs`, `/images/generate`, `/images/:assetId` · `/subtitles/generate`, `/subtitles/:assetId`, `PATCH /subtitles/:assetId/cues` · `/render` (POST, preset), `/render/:id`, `/render/:id/download`. All generation endpoints: budget-checked, `202 + jobId`, idempotent.

## 11. Events

`asset.version.created`, `asset.ready`, `asset.failed`, `subtitle.ready`, `render.progress`, `render.ready`, `render.failed` — emitted on the project WS channel and consumed by the editor and Job Center.

## 12. Caching & Cost

- Voice/image/render results cached by input hash (see §8 idempotency and `token-optimization.md` §5).
- Proxy-first rendering; final render is an explicit, credit-priced action shown in the UI before dispatch (`uiux.md` §5).
- Per-plan media budgets: voice seconds, image count, render minutes — reserved before dispatch, settled on completion (`monetization-framework.md` A5).

## 13. Error Handling

Standard error codes reused (`api.md` §1): `BUDGET_EXCEEDED`, `COMPLIANCE_BLOCKED` (attempted generation pre-pass), `PROVIDER_ERROR`, `VALIDATION_FAILED` (timeline/asset spec), plus `ASSET_NOT_READY` for renders referencing pending assets.

## 14. Security & Compliance Hooks

- Generation only post-compliance-pass; render output is part of the bundle hash — a new render after approval resets `humanApproved` (WF-7 extension).
- Synthetic media (voice, generated video/images) automatically sets disclosure candidates for MetadataAgent (`compliance.md` §3.4).
- Uploaded creator media validated (type/size/scan) before entering the asset store (`security.md` §7).

## 15. Acceptance Criteria

1. A compliance-passed project can produce voice, images, subtitles, an edited timeline, and a rendered MP4 **without leaving the app**.
2. No media-generation or render job dispatches for a non-passed project (test: `testing.md` §3 extension #11).
3. Every asset version has immutable provenance; restore never destroys history.
4. Re-rendering an unchanged timeline+preset returns the cached render (no double spend).
5. Regenerating one script section's voice re-runs exactly one TTS job.
6. Renders after approval reset approval (WF-7).

## 16. Future Extension

Avatar/presenter generation (consent-gated), stock-footage connectors (licensed only), GPU render farm auto-scaling, per-scene style transfer, podcast→video repurposing (roadmap M4).

## 17. Cross References

`video-editor.md` (timeline, EditPlanAgent) · `agents.md` (roster) · `workflows.md` (WF-1 expanded, WF-8) · `database.md` §5a · `api.md` §10a–§12a · `model-routing.md` §7 (media providers) · `token-optimization.md` §5–6 · `compliance.md` · `monetization-framework.md`.
