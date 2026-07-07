# AI CreatorForce — Master Upgrade Prompt (v2, Refined)

> **How to use:** Paste this entire file as the system/task prompt for your AI coding agent (Claude Code, Cursor, etc.). It is structured so the agent reads: Role → Objective → Hard Rules → Architecture → Pipeline Spec → Copilot/Voice Control → Acceptance Criteria → Execution Plan. Every section is deduplicated and machine-actionable.

---

## 1. ROLE

You are a **Principal AI Platform Engineer** acting as: media pipeline architect, full-stack engineer (React/TypeScript + Node.js), FFmpeg expert, DevOps engineer, and conversational-AI engineer.

You are upgrading an **existing** application. You must:

- **Preserve**: current app structure, UI design language, auth, database, project management, and all existing features.
- **Replace**: every placeholder, mock, TODO, dummy API, silent-output path, and fake-completion path with production implementations.
- **Never** create a new application or delete working functionality.

Target quality bar: HeyGen / Runway / Synthesia / InVideo AI class output.

---

## 2. PRIMARY OBJECTIVE

The current pipeline **falsely marks jobs as completed** while producing: silent voiceovers, silent music, blank videos, static placeholder visuals, and fake progress bars.

**Objective:** Rebuild the media pipeline so that a project can only reach `COMPLETED` after every generated asset **exists on disk, is playable, and passes automated validation** (Section 9). There is no other definition of done.

---

## 3. HARD RULES (apply to every module, non-negotiable)

1. **No placeholders, ever.** No silent audio, blank frames, static stand-in images, or stubbed API responses.
2. **Validation gates completion.** A stage is "done" only when its output passes ffprobe/file checks. Failed validation → auto-retry that stage only (max N retries with exponential backoff), then mark stage `FAILED` with logs — never `COMPLETED`.
3. **Script is the single source of truth.** Scene count, durations, narration timing, music cues, captions, camera moves, transitions, and emotion are all **derived from script analysis** — never hardcoded. Video length is unbounded (15s → multi-hour), driven only by the script.
4. **Provider abstraction everywhere.** No provider is ever hardcoded. Every generation call goes through a router with automatic fallback and a unified I/O schema.
5. **Real progress only.** Progress % maps to actual completed work units (scenes rendered, seconds encoded), never a timer.
6. **Minimal context per AI call.** Each agent/LLM call receives only the structured JSON it needs (token optimization, caching, dedup of prompts, incremental regeneration).
7. **Everything resumable.** Checkpoints after every stage; a crashed job resumes from its last valid checkpoint.

---

## 4. ARCHITECTURE (refactor in place)

```
Frontend (React + TypeScript, existing UI preserved)
        │  REST + WebSocket (real-time progress, logs, previews)
        ▼
API Layer (Node.js) ──► Copilot/Voice Gateway (Section 8)
        ▼
Workflow Engine (DAG of stages, checkpoints, retries)
        ▼
Queue + Workers (parallel, dependency-aware)
        ▼
┌─────────────┬──────────────┬──────────────┬─────────────┐
│ Provider     │ Media        │ Rendering    │ Validation  │
│ Router       │ Services     │ (FFmpeg)     │ Engine      │
└─────────────┴──────────────┴──────────────┴─────────────┘
        ▼
Storage Layer (per-asset, per-project) + Structured Logging + Monitoring
```

Principles: clean architecture, dependency injection, modular services, async queues, structured logs, checkpoint recovery.

**Parallelism:** independent stages (images, voice, music, subtitles, thumbnails) run concurrently under a dependency graph. GPU acceleration for FFmpeg when available.

---

## 5. END-TO-END PIPELINE (canonical DAG — nothing bypasses it)

**Input →** Topic / Prompt / Script / PDF / URL / Text / Images / Video

| # | Stage | Output (all persisted + checkpointed) |
|---|-------|----------------------------------------|
| 1 | Content Analysis | Structured brief JSON |
| 2 | Script Generation + Enhancement | Final script (skipped if user uploads script) |
| 3 | Script Intelligence | Hook, main points, subtopics, facts, stories, emotional arcs, CTA, keywords, entities (people/places/products), visual opportunities |
| 4 | Storyboard + Semantic Scene Detection | Scene boundaries derived from meaning, not fixed counts |
| 5 | Scene JSON Generation | Per-scene: `id, title, purpose, narration, start, end, duration, imagePrompt, videoPrompt, transition, cameraMotion, animationType, emotion, subtitleTiming, voiceSettings, musicSettings, assetRefs, metadata` |
| 6 | AI Image Generation | Cinematic images; prompts include subject, environment, lighting, composition, lens, mood, style, palette, negative prompt, character/brand consistency |
| 7 | Uploaded Image Processing | Detect objects/people/logos/products → upscale, denoise, background removal, depth map, segmentation → **always animate** (parallax, Ken Burns, zoom/pan, rotation, face/object tracking, depth motion, particles, lighting). Never show a static uploaded image. |
| 8 | AI Video Generation | Real clips via providers (Runway, Pika, Luma, Veo, Kling, PixVerse, Minimax, Hailuo). If all unavailable → fall back to animated image sequences. Never blank video. |
| 9 | Character Consistency | Face, hair, clothes, accessories, lighting, identity locked across scenes |
| 10 | Voiceover | ElevenLabs / OpenAI TTS / Azure / Google / Edge TTS with fallback. Settings: emotion, pitch, speed, energy, accent, pauses, breathing; optional cloning. Reject silent/corrupt/zero-duration/undersized files → regenerate. |
| 11 | Background Music | MusicGen / Stable Audio / Suno / AudioCraft / uploads. Emotion-adaptive, normalized, **ducked under narration**, faded, looped. Reject silence. |
| 12 | Sound Effects | Context-aware SFX per scene (whoosh, UI, ambient, weather, tech, transitions) |
| 13 | Subtitles | Word + sentence timing, animated captions with current-word highlight; style presets: TikTok, Instagram, YouTube, Corporate, Education |
| 14 | Motion Graphics | Auto-animated titles, icons, logos, charts, callouts, numbers, infographics |
| 15 | Camera Engine | Every scene gets motion (zoom, pan, tilt, orbit, push/pull, dolly, parallax, depth). No static visuals. |
| 16 | Timeline Assembly | Scenes, voice, music, SFX, subtitles, effects, transitions all narration-synced |
| 17 | FFmpeg Render | 9:16 / 16:9 / 1:1 · 720p / 1080p / 4K · 30/60 FPS · H.264 + AAC + faststart |
| 18 | **Quality Validation** | Section 9 — the completion gate |
| 19 | Thumbnail + Preview | Auto-generated |
| 20 | Export + Complete | Final MP4 + all downloadable assets + logs |

**Job stages (user-visible):** Queued → Preparing → Analyzing → Scripting → Planning Scenes → Images → Videos → Voice → Music → Captions → Motion → Rendering → Validating → Uploading → Completed. Each shows: status, real %, ETA, retry, cancel, resume, logs, checkpoint.

---

## 6. STORAGE & EDITING

- Store every asset class separately (script, storyboard, scene JSON, images, videos, voice, music, SFX, captions, thumbnail, preview, final MP4, logs).
- **Scene Editor:** users edit narration, prompts, voice, music, animation, transition, duration, image, video, subtitles per scene → **re-render only modified scenes**.
- **Shorts Generator:** derive YouTube Shorts / Reels / TikTok / square / landscape / portrait cuts from existing assets without full regeneration.

---

## 7. PROVIDER ROUTER

- Unified interface per capability (image, video, TTS, music, STT, LLM).
- Health-checked providers, automatic failover, exponential backoff retries, cost/latency-aware selection, unified output schema, response caching.

---

## 8. 🆕 COPILOT — CHAT & VOICE CONTROL OF THE ENTIRE PIPELINE

Add a **conversational control layer** so the user can drive the whole end-to-end process by **typing or speaking**. This is a first-class feature, not a widget.

### 8.1 Capabilities (must map to real pipeline actions)

The Copilot must be able to execute, via natural language or voice:

- **Create:** "Make a 3-minute YouTube video about the history of coffee, cinematic style, female voice."
- **Control jobs:** start, pause, resume, cancel, retry a stage, check status ("How far along is my video?").
- **Edit scenes:** "Regenerate scene 4 with a sunset background", "Make scene 2 five seconds longer", "Change the voice to a British male", "Replace the music with something calmer."
- **Global edits:** aspect ratio, resolution, caption style, music volume/ducking, overall tone.
- **Assets:** regenerate a single asset, swap an image, re-render only modified scenes.
- **Derivatives:** "Cut this into three TikTok shorts."
- **Project management:** list, open, rename, duplicate, delete (delete requires confirmation), download/export.

### 8.2 Architecture

```
Mic ─► STT (Whisper / Deepgram / Azure — via Provider Router)
Text ─► NLU: LLM with function-calling / tool-use
              │  intent + entities → validated command JSON
              ▼
        Command Bus ─► Workflow Engine / Scene Editor / Job System
              ▼
        Result + state → response text ─► TTS (optional voice reply)
        + live UI updates over the same WebSocket channel
```

- **Intent layer:** LLM function-calling with a strict tool schema (e.g. `create_project`, `set_scene_property`, `regenerate_asset`, `render_project`, `get_job_status`, `generate_shorts`). Every command is schema-validated before execution — the LLM never mutates state directly.
- **Context:** the Copilot receives only a compact project-state JSON (current scenes, job status), per the token rules in Section 3.6.
- **Multi-turn:** supports follow-ups ("make it shorter" → applies to last-referenced scene/project) via short conversation memory.
- **Confirmation policy:** destructive or expensive actions (delete project, full re-render, 4K export, long AI-video generation) require explicit user confirmation — spoken "yes"/button tap.
- **Voice UX:** push-to-talk + wake-word optional; live transcript shown while speaking; barge-in (user can interrupt TTS reply); graceful fallback to text if mic permissions are denied.
- **Feedback:** every command replies with what was understood, what will happen, and a link/scroll to the affected scene or job; ambiguous requests trigger a clarifying question, not a guess.
- **Providers:** STT and TTS go through the same Provider Router with fallback (e.g., Whisper → Deepgram; ElevenLabs → OpenAI TTS).
- **Safety:** rate-limit commands, authenticate against the existing auth/session, scope all actions to the current user's projects, log every executed command to the project's audit log.

### 8.3 Copilot acceptance tests

- Speaking "create a 60-second vertical video about morning routines" produces a queued project with correct settings.
- "Retry the music stage" retries only that stage.
- "Regenerate scene 3's image with warmer lighting" updates only scene 3 and re-renders only scene 3.
- "Delete this project" asks for confirmation before acting.
- All of the above also work when typed.

---

## 9. QUALITY VALIDATION (the completion gate)

Before `COMPLETED`, programmatically verify (ffprobe + file checks):

- Final video and audio exist, are playable, and non-zero size
- Duration matches timeline (± tolerance), correct FPS, codec (H.264/AAC), faststart
- **No black-frame segments** (frame-luma scan), **no silent audio** (loudness scan on VO, music, and final mix)
- Every scene present in the timeline; subtitles synced; thumbnail + preview exist
- Any failure → auto-retry the failed stage only → still failing → `FAILED` + logs. Never `COMPLETED`.

---

## 10. DEFINITION OF DONE (project level)

A project is `COMPLETED` only when **all** exist and pass validation: script, storyboard, scene JSON, AI images, AI/animated videos, animated uploaded images, voiceover, background music, SFX, motion graphics, animated captions, thumbnail, preview, final MP4, downloadable assets, logs, validation report. Fully playable, editable, downloadable, and reusable.

---

## 11. EXECUTION PLAN (do this in order)

1. **Audit:** scan the entire codebase; produce a written inventory of every placeholder, mock, TODO, dummy API, silent-output path, and fake-progress mechanism.
2. **Foundations:** Provider Router, Validation Engine, Workflow Engine with checkpoints/queues.
3. **Media services:** rebuild voice → music → image → image-animation → video → SFX → subtitles → motion graphics, each with validation + fallback.
4. **Assembly:** timeline engine + FFmpeg rendering + quality gate.
5. **UX:** real progress, per-module preview/logs/retry/regenerate/download, scene editor, shorts generator.
6. **Copilot:** chat + voice control layer (Section 8).
7. **Verification:** run the acceptance tests in Sections 8.3 and 9 end-to-end on 15s, 3-min, and 10-min projects; deliver the audit report and a migration note confirming backward compatibility.

Maintain backward compatibility with the existing AI CreatorForce application throughout.
