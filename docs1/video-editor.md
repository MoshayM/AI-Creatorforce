# video-editor.md — AI CreatorForce

> Owner document for the **in-app video editor**: the timeline data model, effects/transitions/animation catalog, real-time preview, undo/redo, autosave, version history, drag & drop, and keyboard shortcuts — plus the **EditPlanAgent** that assembles the first cut automatically. Rendering the timeline is owned by `media-pipeline.md` §8.

**Principle:** the editor is a **structured timeline editor**, not a pixel-level NLE. It operates on generated/uploaded assets and a declarative timeline JSON that the Render worker can compile deterministically. Everything the editor can express, the renderer can render — the schemas are shared in `packages/shared`.

---

## 1. Purpose & Scope

Give creators a complete edit → preview → refine loop inside the app: arrange clips, voice, music, images, subtitles; apply transitions, effects, and simple keyframe animation; preview instantly; render when satisfied. Scope excludes: multi-cam, color grading suites, audio mastering (future extensions §12).

## 2. Timeline Data Model

Stored in Postgres `timelines` with JSONB `tracks`, Zod-validated, `schemaVersion`'d.

```ts
interface Timeline {
  id: string; projectId: string; version: number;      // version bumps on save
  fps: 30; resolution: { w: number; h: number };        // preset-bound
  duration: number;                                     // derived, ms
  tracks: Track[];
  contentHash: string;                                  // for idempotent renders (WF-8)
}

type Track =
  | { kind: "video";    clips: VideoClip[] }            // generated clips, images (Ken-Burns), uploads
  | { kind: "voice";    clips: AudioClip[] }            // narration takes (per script section)
  | { kind: "music";    clips: AudioClip[]; ducking: DuckingRule }
  | { kind: "subtitle"; assetRef: AssetRef; burnIn: boolean }
  | { kind: "overlay";  clips: OverlayClip[] };         // lower-thirds, callouts, logo (brand kit)

interface ClipBase {
  id: string;
  assetRef: { assetId: string; versionId: string };     // pinned asset version
  start: number; end: number;                           // trim within source, ms
  at: number;                                           // position on timeline, ms
  transitionIn?: TransitionRef; transitionOut?: TransitionRef;
  effects?: EffectRef[];
  keyframes?: Keyframe[];                               // animate opacity/scale/x/y/volume
}
```

Rules: clips on one track never overlap (drag snaps resolve); `assetRef` pins **versions**, so editing an asset never silently changes a timeline; deleting an asset version referenced by any timeline version is forbidden (soft-retention).

## 3. EditPlanAgent (first cut)

- **Input:** approved script (sections + timestamps + visual cues), ready asset versions (voice takes, clips, images, music), brand kit.
- **Behavior:** maps script sections → timeline segments: places voice takes sequentially, matches scene clips/images to cues, sets music with ducking under narration, inserts default transitions at section boundaries, adds the subtitle track, applies brand-kit overlays.
- **Output:** a valid `Timeline` (schema above) saved as version 1 — a *starting point*, clearly labeled "AI first cut" in the UI. The agent never bypasses any gate; it only arranges already-compliant assets.
- Registered in `agents.md`; prompt spec `edit.firstcut` in `prompts.md`.

## 4. Editor UI (extends `uiux.md` — Project Workspace gains an **Edit** step)

- **Layout:** preview viewport (top), timeline (bottom, zoomable), asset library panel (left — filterable by kind/scene), inspector panel (right — properties of the selected clip: trim, transitions, effects, keyframes, volume).
- **Drag & drop:** drag assets from the library onto tracks; drag clip edges to trim; drag bodies to move (magnetic snapping to other clips, markers, and the playhead). Keyboard-accessible equivalents for every drag operation (a11y, `uiux.md` §7).
- **Section markers:** script sections (Hook/Problem/…) render as timeline markers so retention analytics can later overlay drop-offs on the exact cut (`analytics.md` §6).
- **Cost meter:** persistent estimate of final-render credit cost; updates as duration/preset changes.

## 5. Effects, Transitions & Animation Catalog

A **closed, versioned catalog** in `packages/shared/editor-catalog` — each entry defines UI controls *and* its FFmpeg filter mapping, so editor and renderer can never disagree.

| Category | Entries (v1) |
|----------|--------------|
| Transitions | cut, crossfade, dip-to-black/white, slide (4 dirs), wipe (4 dirs), zoom |
| Video effects | brightness/contrast/saturation, blur, sharpen, vignette, speed (0.25×–4×), crop/pan (Ken-Burns for stills), LUT (brand kit) |
| Audio effects | gain, fade in/out, music ducking (side-chain under voice), normalize |
| Overlay/animation | position/scale/opacity keyframes (linear + ease presets), lower-third templates, logo watermark, progress bar |
| Text | title cards and callouts from brand-kit typography tokens |

Adding a catalog entry = shared-package change + renderer mapping + fixture test (never editor-only).

## 6. Real-Time Preview

- **Strategy:** client-side compositing of **proxy assets** (low-res transcodes generated automatically when an asset becomes `ready`) using `<video>`/WebAudio/canvas — instant scrubbing without server round-trips for the common case.
- Effects preview via CSS/canvas approximations flagged "preview-approximate" where the FFmpeg result may differ subtly; exact check via **draft_proxy server render** of a selected range (cheap, cached).
- Playhead-synced subtitle and ducking preview in-client.

## 7. Undo/Redo, Autosave & Version History

- **Command pattern:** every edit is a serializable command (`addClip`, `trim`, `move`, `setEffect`, …) on an in-memory stack → **undo/redo** is instant and unlimited within a session (`Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z`).
- **Autosave:** debounced (2 s idle) PATCH persists the working draft; the working draft is version *n+1-pending* and never mutates a saved version.
- **Versions:** explicit "Save version" (and every render) freezes an immutable `timeline` version with a label; the history panel lists versions with diff summaries (clips added/removed/moved); **restore** creates a new version copying an old one.
- **Conflict safety:** optimistic locking via `version` — a stale save returns `409 CONFLICT` and the UI offers merge-or-fork. (Realtime co-editing is a future extension, not v1.)
- **WF-7 hook:** timeline edits after final approval reset `humanApproved` (content changed); they do **not** reset compliance unless script/metadata/subtitle *text* changed — arrangement of already-passed assets is an approval matter, not a compliance one. Subtitle text edits re-hash against the script (see `media-pipeline.md` §7.5).

## 8. Keyboard Shortcuts (v1)

`Space` play/pause · `J/K/L` shuttle · `←/→` frame step (`Shift` = 1 s) · `I/O` set in/out · `S` split at playhead · `Del` delete clip · `Ctrl/Cmd+Z / Shift+Ctrl/Cmd+Z` undo/redo · `Ctrl/Cmd+S` save version · `+/-` zoom timeline · `M` marker · `B` toggle snap. Fully remappable later; all actions also reachable via menus (a11y).

## 9. API (delta — full surface in `api.md`)

`GET/POST /editor/:projectId/timeline` · `PATCH /editor/:projectId/timeline` (autosave, optimistic-locked) · `POST /editor/:projectId/timeline/versions` (freeze) · `GET …/versions` · `POST …/versions/:v/restore` · `POST /editor/:projectId/firstcut` (EditPlanAgent, `202 + jobId`).

## 10. Events

`timeline.saved`, `timeline.version.created`, `firstcut.ready` on the project WS channel; render events per `media-pipeline.md` §11.

## 11. Error Handling & Performance

- Validation errors reference timeline node paths so the UI highlights the offending clip.
- Target: timeline ops < 16 ms frame budget in-client; proxy generation SLA < 2× asset duration; autosave p95 < 300 ms.
- Large timelines: tracks virtualized; commands batched; proxies capped at 540p.

## 12. Acceptance Criteria & Future Extension

1. First cut auto-assembles from a compliant bundle and is fully editable.
2. Every catalog effect renders identically (within tolerance) to its preview semantics.
3. Undo/redo covers 100% of edit commands; autosave never loses > 2 s of work.
4. Version restore is non-destructive; renders pin exact timeline+asset versions.
5. Post-approval edits reset approval (and compliance only when text meaning changes).

Future: collaborative editing (CRDT), waveform-accurate audio editing, motion templates marketplace (compliance-screened), color grading, auto-Shorts recut from long-form (originality-preserving).

## 13. Cross References

`media-pipeline.md` (assets, proxies, render) · `agents.md` (EditPlanAgent) · `workflows.md` (WF-1 §steps 10–12, WF-8) · `database.md` (timelines) · `api.md` · `uiux.md` (Editor screen) · `testing.md` (catalog fixtures).
