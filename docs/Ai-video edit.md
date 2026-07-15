# AI CreatorForce — Unified Video Analysis & Content Creation Hub
### Production-Ready Specification v2.0 (Copilot + Voice-Controlled Edition)

> This document upgrades the existing **AI CreatorForce Shorts Studio** into a unified **AI Video Analysis and Content Creation Hub**, and adds two major new capability layers on top of the original spec:
> 1. **Copilot Bot Integration** — a conversational AI agent embedded throughout the app that can execute, explain, and orchestrate every step.
> 2. **Voice-Controlled Workflow** — every step in the pipeline (analysis, editing, generation, publishing) can be triggered, reviewed, and confirmed by voice.
>
> All original features, screens, and workflows are preserved exactly as specified. Nothing is removed or redesigned. Everything new is additive and modular.

---

## 0. Compliance With Original Constraints

| Constraint | Status |
|---|---|
| Do not redesign existing UI | ✅ Preserved — new tabs/panels only |
| Do not remove/replace existing features | ✅ All 16 existing features retained |
| Shorts workflow unaffected | ✅ Shorts pipeline untouched, only enriched with new signals |
| Everything happens inside the app | ✅ Copilot + Voice are in-app overlays, no external tools |
| Modular, scalable, production-ready | ✅ See Architecture §3 |
| Optimized for low AI token usage | ✅ See Token Optimization Engine §12 |

---

## 1. Executive Summary

AI CreatorForce evolves from a Shorts-generation tool into a **single-pass, multi-output Video Intelligence Platform**. A video is analyzed **once**; every downstream artifact (chapters, small videos, shorts, social content, devotionals, etc.) is derived from that one shared analysis graph — never re-analyzed.

Two new layers make the platform "hands-free" and "agentic":

- **Copilot Bot**: a persistent, context-aware assistant that sits inside the Video Analysis page and the Content Creation Hub. It can answer questions about the video ("What's the most viral moment?"), execute actions ("Generate a 60-second Short from the sermon highlight"), and chain multi-step tasks ("Create chapter videos for every chapter and publish the Shorts") — all while consulting the cached analysis graph instead of re-running AI models.
- **Voice Control Layer**: a speech-to-intent system that maps spoken commands to the same action/intent schema used by Copilot and the UI, so a user can navigate tabs, scrub the timeline, trim clips, approve highlights, or trigger publishing entirely by voice, with visual + audio confirmation at every step.

Both layers route through the **same Intent Engine and Action Bus** as the manual UI, so there is exactly one execution path to audit, cache, and optimize for tokens.

---

## 2. Feature Overview

### 2.1 Existing Features (Unchanged, Retained)
Video Import · Transcript Generation · Scene Detection · Topic Detection · Highlight Detection · AI Analysis · Short Generation · Caption Editor · Thumbnail Generation · Voice Generation · Background Music · Rendering · Publishing · Projects · Jobs · Approvals · Brand Kit · Settings

### 2.2 New Analysis Capabilities
Speaker Detection · Audio Event Detection · OCR Detection · Semantic Topic Analysis · Chapter Detection · Timeline Generation · Embedding Generation · Natural-Language Search · Analytics Tab

### 2.3 New Content Creation Capabilities
Chapter Videos · Small Videos (1–10 min) · Enhanced Shorts (multi-signal ranking) · Social Content (Reels, TikTok, LinkedIn, Podcast Clips, Quote Cards, Carousels, Blog, Newsletter, Devotional) · Church AI Intelligence · YouTube Chapter Sync

### 2.4 New Interaction Layers (this upgrade)
| Layer | Purpose |
|---|---|
| **Copilot Bot** | Conversational orchestration across every tab and action |
| **Voice Control** | Spoken commands mapped to the same actions as UI clicks |
| **Unified Intent Engine** | Single schema consumed by UI, Copilot, and Voice |
| **Confirmation & Undo Layer** | Every voice/Copilot action is confirmed and reversible |
| **Token Governor** | Hard ceiling + adaptive routing to keep LLM cost minimal |

---

## 3. System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          CLIENT (Web/App)                        │
│  Video Analysis Page  │  Content Creation Hub  │  Timeline Editor│
│  ─────────────────────┴────────────────────────┴─────────────── │
│              Copilot Panel (chat)   │   Voice Control Bar        │
└───────────────────────────┬───────────────────┬──────────────────┘
                            │                   │
                     ┌──────▼───────┐    ┌──────▼───────┐
                     │ Intent Engine │◄──►│ Speech-to-   │
                     │ (NLU router)  │    │ Intent (STT +│
                     │               │    │ intent model)│
                     └──────┬───────┘    └──────────────┘
                            │
                     ┌──────▼───────┐
                     │  Action Bus  │  (single execution path)
                     └──────┬───────┘
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
 ┌─────────────┐    ┌───────────────┐    ┌───────────────┐
 │ Analysis     │    │ Content        │    │ Job / Worker  │
 │ Graph Store  │◄──►│ Generation     │◄──►│ Orchestrator  │
 │ (cached)     │    │ Services       │    │ (async queue) │
 └─────────────┘    └───────────────┘    └───────────────┘
        ▲                   ▲                   ▲
        └───────────────────┴───────────────────┘
                     ┌──────▼───────┐
                     │ Token Governor│  (rate/route/cache all LLM calls)
                     └──────────────┘
```

**Key principle:** Copilot and Voice never call AI models directly. They emit **Intents** onto the Action Bus, exactly like a UI button click. This guarantees:
- One code path to test, cache, and secure.
- No duplicate/re-analysis triggered by conversational or spoken requests.
- Every action is logged, undoable, and billable in the same way regardless of input modality.

---

## 4. Folder Structure

```
ai-creatorforce/
├── apps/
│   ├── web/                          # Existing UI (unchanged) + new panels
│   │   ├── components/
│   │   │   ├── video-analysis/       # existing tabs
│   │   │   ├── content-creation/     # existing + new sub-tabs
│   │   │   ├── copilot/              # NEW: Copilot chat panel
│   │   │   │   ├── CopilotPanel.tsx
│   │   │   │   ├── CopilotMessage.tsx
│   │   │   │   ├── CopilotActionCard.tsx
│   │   │   │   └── CopilotSuggestions.tsx
│   │   │   └── voice/                # NEW: Voice control bar
│   │   │       ├── VoiceControlBar.tsx
│   │   │       ├── VoiceWaveform.tsx
│   │   │       ├── VoiceConfirmationToast.tsx
│   │   │       └── VoiceCommandHistory.tsx
│   │   └── hooks/
│   │       ├── useIntentEngine.ts
│   │       ├── useCopilot.ts
│   │       └── useVoiceControl.ts
│   └── worker/                       # background job workers (existing + new)
├── services/
│   ├── analysis-service/             # transcript, scenes, topics, speakers, OCR
│   ├── chapter-service/
│   ├── timeline-service/
│   ├── highlight-service/
│   ├── content-generation-service/   # shorts, small videos, social content
│   ├── publishing-service/
│   ├── search-service/               # embeddings + NL search
│   ├── copilot-service/              # NEW
│   │   ├── intent-router.ts
│   │   ├── conversation-memory.ts
│   │   └── action-executor.ts
│   ├── voice-service/                # NEW
│   │   ├── stt-adapter.ts
│   │   ├── intent-classifier.ts
│   │   └── tts-confirmation.ts
│   └── token-governor/               # NEW
│       ├── cache-layer.ts
│       ├── router.ts
│       └── usage-ledger.ts
├── packages/
│   ├── intent-schema/                # shared Intent/Action types (UI, Copilot, Voice)
│   ├── analysis-graph-sdk/           # typed access to cached analysis
│   └── ui-kit/                       # existing design system (untouched)
├── infra/
│   ├── queues/
│   ├── cache/ (Redis)
│   └── vector-db/ (embeddings)
└── docs/
```

---

## 5. Unified Workflow

```
Import Video
   ↓
Video Metadata
   ↓
Transcript
   ↓
Scene Detection
   ↓
Speaker Detection
   ↓
Audio Event Detection
   ↓
OCR Detection
   ↓
Semantic Topic Analysis
   ↓
Highlight Detection
   ↓
Chapter Detection
   ↓
Timeline Generation
   ↓
Embedding Generation
   ↓
AI Video Intelligence  ──► cached as the single "Analysis Graph"
   ↓
Content Creation Hub  ◄──── Copilot Bot (chat)  +  Voice Control (speech)
   ↓
Rendering → Publishing → Analytics
```

Every arrow above runs **once** per video (or per modified segment). Copilot and Voice sit at the **Content Creation Hub** layer and read the Analysis Graph — they do not re-trigger the pipeline unless the source video changes.

---

## 6. Copilot Bot — Detailed Design

### 6.1 Placement
- A persistent, collapsible **Copilot Panel** docked in the Video Analysis page and Content Creation Hub (does not replace or cover existing tabs).
- Accessible from every tab via a floating action button — same visual language as existing UI, no redesign.

### 6.2 Capabilities
| Category | Example Prompt | Resulting Intent |
|---|---|---|
| Query | "What's the most engaging moment in this sermon?" | `query.highlights.top(1)` — reads cached highlight scores, **no LLM call** |
| Navigation | "Take me to the worship chapter" | `navigate.chapter(name="Worship")` |
| Generation | "Make a 30-second Short from the testimony" | `generate.short(source="chapter:testimony", duration=30)` |
| Batch action | "Create chapter videos for all chapters and publish drafts" | `batch([generate.chapter_video(*), publish.draft(*)])` |
| Editing | "Trim the intro to start at 0:45" | `edit.trim(chapter="intro", start="00:45")` |
| Explain | "Why was this clip ranked #1?" | `explain.ranking(clip_id)` — reads stored scoring breakdown, no LLM call |
| Social | "Turn the announcement into an Instagram Reel and a quote card" | `generate.social([reel, quote_card], source="chapter:announcements")` |

### 6.3 Grounding Rule
Copilot **must answer from the Analysis Graph and Action Bus results first**. It only invokes a generative LLM call when:
1. The question requires synthesis not already cached (e.g., "Write a devotional based on today's sermon"), or
2. No cached answer exists for the query.

This is enforced by the **Token Governor** (see §12), not left to Copilot's discretion.

### 6.4 Conversation Memory
- Scoped per-video, per-project.
- Stores only intent/action history + short summaries — not full transcripts — to keep context windows (and cost) small.

### 6.5 Action Confirmation
Every generation, publish, or destructive edit triggered via Copilot renders an **Action Card** in the chat (preview, cost estimate in tokens/credits, Confirm/Cancel) before execution. Read-only queries execute immediately.

---

## 7. Voice Control Layer — Detailed Design

### 7.1 Components
- **Voice Control Bar**: mic button + live waveform, available on every screen in the pipeline (Analysis tabs, Timeline, Content Creation Hub).
- **Push-to-talk or wake-word** ("Hey CreatorForce") — configurable in Settings (existing Settings screen, extended with a Voice section).
- **Visual + spoken confirmation**: every recognized command shows a transcript chip and reads back a short confirmation via TTS before executing irreversible actions.

### 7.2 Pipeline
```
Microphone → STT (streaming) → Intent Classifier → Intent Schema
     → Action Bus → (same execution path as UI/Copilot)
     → Result → Visual update + TTS confirmation
```

### 7.3 Voice Command Coverage (maps 1:1 to existing UI actions — nothing new is invented, only voice-accessible)
| Step | Example Voice Command |
|---|---|
| Import | "Import the video from Drive titled Sunday Service" |
| Transcript | "Jump to where he mentions John 3:16" |
| Scenes | "Merge scene 4 and scene 5" |
| Topics | "Show me all topics about hope" |
| Highlights | "Approve highlight 2" |
| Chapters | "Rename this chapter to Main Sermon" |
| Timeline | "Split the clip at 12 minutes 30 seconds" |
| Content Creation | "Generate a 60-second Short from the highlight" |
| Publishing | "Publish this Short to TikTok and Instagram" |
| Approvals | "Approve all pending Shorts" |

### 7.4 Safety & Control
- **Confirm-before-execute** for: publish, delete, merge, overwrite, and any spend of render/API credits.
- **Instant execute** for: navigation, playback, search, read-only queries.
- **Undo** available via voice ("Undo that") or UI for the last N actions (ring buffer, default 20).
- Voice commands never bypass approval workflows (existing **Approvals** feature is respected — voice can *request* publish, not skip approval where required).

### 7.5 Accessibility Benefit
Because Copilot and Voice both route through the same Intent Schema, a user can start a task by voice and finish it in the UI (or vice versa) — state stays consistent.

---

## 8. Unified Intent Schema (shared by UI, Copilot, Voice)

```typescript
type Intent =
  | { type: "query"; target: string; params?: Record<string, any> }
  | { type: "navigate"; target: string; params?: Record<string, any> }
  | { type: "generate"; artifact: ArtifactType; source: SourceRef; params?: GenParams }
  | { type: "edit"; action: "trim" | "split" | "merge" | "rename"; target: ClipRef; params: any }
  | { type: "publish"; target: ClipRef; channels: Channel[] }
  | { type: "batch"; intents: Intent[] }
  | { type: "explain"; target: ClipRef | string }
  | { type: "undo"; steps?: number };

interface ActionResult {
  intentId: string;
  status: "executed" | "needs_confirmation" | "failed";
  fromCache: boolean;      // true if answered without new AI/LLM call
  tokensUsed: number;      // 0 if fromCache
  payload: any;
}
```

All three input modalities (click, chat, speech) compile down to this schema before touching the Action Bus. This is the single biggest lever for both **auditability** and **token optimization**.

---

## 9. Video Analysis Page (tabs — unchanged structure, Copilot/Voice-aware)

Overview · Transcript · Scenes · Topics · Highlights · Chapters · Timeline · Search · Content Creation · Analytics

Each tab exposes a small set of **registered intents** (e.g., Scenes tab registers `edit.split`, `edit.merge`, `edit.rename`) so Copilot/Voice discovery is automatic — no per-feature custom wiring is needed when new tabs are added later.

*(Per-tab field lists are unchanged from the original spec — Video Information/Duration/Resolution/etc. in Overview; searchable transcript with speaker labels in Transcript; scene thumbnails/duration/quality in Scenes; and so on. See Appendix A for the full unchanged field reference.)*

---

## 10. Content Creation Hub (sub-tabs — unchanged, now Copilot/Voice-operable)

- **Full Video** — Export, Publish, Thumbnail, SEO, Metadata
- **Chapter Videos** — Trim, Split, Merge, Rename, Thumbnail, Description, Tags, Publish
- **Small Videos** (1/2/3/5/10 min) — auto-generated from chapters/highlights; Edit, Trim, Merge, Split, Rename, Export, Publish
- **Shorts** (existing system, preserved) — 15/30/45/60/90s, enriched ranking signals (Virality, Emotion, Educational Value, Engagement, Hook Strength, Thumbnail/Audio/Visual Quality, Motion Analysis, Face Detection, Transcript Semantics, Visual Importance, Engagement Prediction)
- **Social Content** — Instagram Reel, Facebook Reel, TikTok, LinkedIn Clip, Podcast Clip, Audio Clip, Quote Cards, Carousel, Blog, Newsletter, Devotional

Every action button in these sub-tabs is **also** a registered intent, so "Generate a Devotional from today's sermon" (Copilot) and tapping "Generate Devotional" (UI) execute the identical function.

---

## 11. Church AI Intelligence & YouTube Chapter Support

Unchanged from original spec:
- Auto-detects Opening, Welcome, Prayer, Praise, Worship, Offering, Announcements, Children Time, Bible Reading, Scripture References, Testimony, Special Song, Main Sermon, Communion, Invitation, Closing Prayer, Blessing.
- Generates Chapter Titles, Summaries, Bible References, Key Points, Discussion Questions, Devotionals, Daily Shorts, Quote Cards.
- Imports existing YouTube chapters if present, allows editing, syncs updates; generates and publishes chapter timestamps back to YouTube if none exist.

Voice/Copilot add: "List all sermons that mention grace this month" (Search + Analytics combined query, answered from embeddings — no re-analysis).

---

## 12. Token Optimization Strategy (Critical — Expanded)

### 12.1 Core Rule
**AI analyzes each video exactly once.** Every tab, every Copilot answer, every voice command reads from the cached **Analysis Graph** unless the underlying video segment changes.

### 12.2 Token Governor (new component)
A middleware in front of every LLM/embedding call:

1. **Cache-first lookup** — hash of (video_id, segment, intent_type) checked against Redis/vector cache before any model call.
2. **Deterministic-first routing** — anything answerable by stored scores, timestamps, or metadata (e.g., "top highlight", "chapter list", "why was this ranked high") is served with **zero tokens**, via direct data lookup, not an LLM.
3. **Model-tiering** — only genuinely generative asks (new devotional text, new quote card copy) go to a capable model; short/templated asks use a lightweight model.
4. **Batch prompting** — Copilot batches multi-step requests ("chapters + descriptions + tags") into a single structured prompt instead of N separate calls.
5. **Incremental re-processing** — if a video is edited (trim/re-upload segment), only the changed time-range is re-analyzed; embeddings/transcripts elsewhere are untouched.
6. **Context compression** — Copilot conversation memory stores compressed summaries, not raw transcript, to keep prompt size minimal on follow-up turns.
7. **Streaming + lazy loading** — heavy tabs (Timeline, Transcript) load data incrementally, not as one large payload/prompt.
8. **Usage ledger** — every ActionResult logs `tokensUsed` and `fromCache`; a per-project dashboard (extends existing Analytics tab) shows cache-hit rate and cost trend, so token usage is visible and tunable.

### 12.3 Target Cache-Hit Rate
Design target: **≥80% of Copilot/Voice interactions answered with zero new tokens** once a video has completed its one-time analysis pass.

---

## 13. Background Job Architecture

Existing jobs (Import, Transcript, Analysis, Rendering, Publishing, Retry, Progress Tracking) are retained. New jobs added:

| Job | Trigger | Notes |
|---|---|---|
| Embedding Generation | after Transcript + OCR complete | powers Search + Copilot grounding |
| Chapter Detection | after Topic + Speaker detection | reused by Chapter Videos, Church Intelligence |
| Small Video Generation | on-demand or auto after Chapters | batched, not per-request |
| Voice Command Execution | on confirmed voice intent | routes through same Action Bus as UI jobs — no special-cased queue |
| Copilot Batch Execution | on confirmed multi-step Copilot request | decomposed into existing job types, executed in parallel where independent |

All jobs: async, retryable, progress-tracked, never block the UI — unchanged principle, now also applies to voice/Copilot-triggered jobs.

---

## 14. Database Schema (extended)

Existing tables retained: `videos, projects, jobs, scenes, topics, transcript, highlights, chapters, timeline, generated_clips, generated_shorts, exports, analytics, publishing, embeddings, cache`.

New tables:

```sql
-- Unified intent/action audit log (UI + Copilot + Voice)
CREATE TABLE actions (
  id UUID PRIMARY KEY,
  video_id UUID REFERENCES videos(id),
  source ENUM('ui','copilot','voice'),
  intent_type VARCHAR(64),
  intent_payload JSONB,
  status ENUM('executed','needs_confirmation','failed'),
  from_cache BOOLEAN DEFAULT false,
  tokens_used INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

-- Copilot conversation memory (compressed, per project)
CREATE TABLE copilot_sessions (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  summary TEXT,          -- compressed context, not raw transcript
  last_intent_ids UUID[],
  updated_at TIMESTAMP DEFAULT now()
);

-- Voice command history (for undo + transcript chips)
CREATE TABLE voice_commands (
  id UUID PRIMARY KEY,
  video_id UUID REFERENCES videos(id),
  raw_transcript TEXT,
  resolved_intent JSONB,
  confidence FLOAT,
  executed BOOLEAN,
  created_at TIMESTAMP DEFAULT now()
);

-- Token usage ledger (feeds Analytics tab)
CREATE TABLE token_usage (
  id UUID PRIMARY KEY,
  video_id UUID REFERENCES videos(id),
  action_id UUID REFERENCES actions(id),
  model VARCHAR(64),
  tokens_in INT,
  tokens_out INT,
  from_cache BOOLEAN,
  created_at TIMESTAMP DEFAULT now()
);
```

---

## 15. API Design (extended)

Existing REST namespaces retained: `/video, /analysis, /timeline, /transcript, /highlights, /chapters, /small-videos, /shorts, /rendering, /publishing, /analytics, /search`.

New endpoints:

```
POST /intents                  # unified entry point for UI/Copilot/Voice actions
GET  /intents/:id               # poll status of an executed/queued intent

POST /copilot/message           # send chat message, returns ActionResult or reply
GET  /copilot/session/:videoId  # fetch compressed conversation memory

POST /voice/command              # submit STT transcript for intent classification
GET  /voice/history/:videoId     # command history for undo/review

GET  /token-usage/:videoId       # cache-hit rate + cost breakdown for a video
GET  /token-usage/summary        # project/org-level dashboard data
```

All new endpoints funnel into the same `Action Bus` used by existing feature endpoints — no parallel execution logic is introduced.

---

## 16. Sequence Diagram — Voice-Triggered Short Generation

```
User (voice): "Make a 45 second Short from the worship highlight"
   │
   ▼
Voice Service: STT → transcript
   │
   ▼
Intent Classifier: → { generate.short, source: chapter:"Worship", duration: 45 }
   │
   ▼
Confirmation: TTS "Generating a 45 second Short from Worship. Confirm?"
   │  (user: "yes")
   ▼
Action Bus → Content Generation Service
   │
   ▼
Analysis Graph lookup (cached highlight/scene/topic data for Worship chapter)
   │  [no re-analysis, no new transcript/embedding call]
   ▼
Render Job queued → Progress tracked in existing Jobs tab
   │
   ▼
Result: Short appears in Content Creation → Shorts, awaiting existing Approval flow
```

---

## 17. State Management

- Global state (existing): video, analysis graph, job status.
- New slices:
  - `copilotState`: panel open/closed, conversation, pending confirmations.
  - `voiceState`: listening/idle, last transcript, confidence, pending confirmation.
  - `intentState`: in-flight intents, undo stack.
- All new slices are additive to the existing store — no refactor of current state shape.

---

## 18. Caching Strategy

| Layer | What's Cached | TTL / Invalidation |
|---|---|---|
| Analysis Graph | transcript, scenes, topics, speakers, OCR, chapters, embeddings | invalidated only on source video edit (per-segment) |
| Copilot answer cache | Q→A pairs keyed by (video_id, normalized query) | invalidated on analysis graph change |
| Voice intent cache | phrase→intent mapping (common commands) | long-lived, org-wide |
| Render cache | generated clip binaries | invalidated only if source clip params change |

---

## 19. Security

- Voice and Copilot actions carry the same auth/session context as UI actions — no privilege escalation path.
- Destructive/publish intents require the same **Approvals** gate as manual UI actions (existing feature, unchanged).
- Conversation memory and voice transcripts are project-scoped and access-controlled like existing project data.
- All new endpoints validated against the shared `intent-schema` package to prevent malformed or injected intents.

---

## 20. Error Handling

- STT low-confidence → Voice bar shows transcript chip with "Did you mean...?" instead of executing.
- Copilot ambiguous request → asks one clarifying question, then proceeds (never silently guesses on destructive actions).
- Failed jobs → existing Retry Failed Jobs mechanism reused for voice/Copilot-triggered jobs.
- Token Governor failure (cache miss + model unavailable) → graceful fallback message, no partial/duplicate generation.

---

## 21. Scalability & Performance

- Supports 30min–8hr videos (unchanged target).
- Voice/Copilot add negligible load: they emit intents, not new analysis jobs.
- Horizontal scaling of `copilot-service` and `voice-service` independent of core analysis workers.
- Streaming STT and streaming Copilot responses avoid blocking UI, consistent with "never block the UI" principle.

---

## 22. Developer Task Breakdown

1. **Intent Schema package** — shared types, validators.
2. **Action Bus** — single execution router (wraps existing feature services).
3. **Token Governor** — cache-first middleware in front of all AI calls.
4. **Copilot Service** — intent-router, conversation-memory, action-executor.
5. **Copilot UI Panel** — chat surface, Action Cards, suggestions.
6. **Voice Service** — STT adapter, intent classifier, TTS confirmation.
7. **Voice UI Bar** — mic control, waveform, confirmation toasts, command history.
8. **Analytics extension** — cache-hit rate & token usage dashboard.
9. **DB migrations** — `actions, copilot_sessions, voice_commands, token_usage`.
10. **API additions** — `/intents, /copilot/*, /voice/*, /token-usage/*`.
11. **Regression suite** — verify all existing Shorts/analysis flows untouched.

---

## 23. Implementation Phases

| Phase | Scope |
|---|---|
| Phase 1 | Intent Schema + Action Bus wrapping existing features (no visible change) |
| Phase 2 | Token Governor + cache layer live on existing AI calls |
| Phase 3 | Copilot Panel (read-only queries first, then generation actions) |
| Phase 4 | Voice Control Bar (navigation + read-only first, then confirmed generation/publish) |
| Phase 5 | Chapters, Small Videos, Social Content, Church AI Intelligence (per original spec) |
| Phase 6 | Analytics dashboard for token usage; YouTube chapter sync |
| Phase 7 | Hardening, load testing on 4–8hr videos, full regression pass |

---

## 24. Testing Plan

- **Regression**: full existing Shorts pipeline test suite must pass unchanged (P0 gate before merging any new feature).
- **Intent parity**: automated tests asserting UI click, Copilot message, and Voice command for the same action all produce identical `ActionResult`.
- **Token audit tests**: assert repeated identical queries return `fromCache: true, tokensUsed: 0` after first run.
- **Voice confidence tests**: low-confidence transcripts must not auto-execute destructive intents.
- **Load tests**: 8-hour video analysis + concurrent Copilot/Voice sessions.

---

## 25. Acceptance Criteria

- [ ] All 16 original features function identically to current production behavior.
- [ ] Every Content Creation Hub action is reachable via UI, Copilot, and Voice with identical results.
- [ ] No feature triggers a second full analysis pass on an unmodified video.
- [ ] Cache-hit rate ≥80% on repeated/derived Copilot & Voice interactions (measured in Analytics).
- [ ] Destructive/publish actions always require confirmation regardless of input modality.
- [ ] 8-hour video completes analysis without blocking the UI.

---

## 26. Future Roadmap

- Multi-language voice control.
- Proactive Copilot suggestions ("This looks like a strong Short — want me to generate it?").
- Cross-video Copilot queries ("Find every time Pastor Mike mentions forgiveness across all 2026 sermons").
- Auto-tuned model tiering based on historical token-usage ledger.

---

## Appendix A — Unchanged Field References (from original spec)

- **Overview Tab**: Video Information, Duration, Resolution, Language, Speakers, Topics, Scenes, Highlights, Detected Chapters, Generated Content, Processing Status.
- **Transcript Tab**: Searchable transcript, Speaker labels, Timestamp navigation, Jump to timeline, Editable transcript, Subtitle generation.
- **Scenes Tab**: Detected scenes, Scene thumbnails, Scene duration, Scene quality, Split, Merge, Rename.
- **Topics Tab**: Detected topics, Topic confidence, Keywords, Summary, Emotion, Speaker, Timeline position.
- **Chapters Tab fields**: Title, Start, End, Duration, Speaker, Confidence, Summary, Keywords, Thumbnail, Editable Name, Color, Notes; actions: Rename, Split, Merge, Trim, Export, Publish.
- **Timeline Tab**: Video Preview, Waveform, Transcript Layer, Scene Layer, Topic Layer, Highlight Layer, Chapter Layer, Generated Clips, Generated Shorts, Zoom, Split, Trim, Merge, Snap, Undo, Redo, Keyboard Shortcuts.
- **Search Tab**: Natural language search (e.g., "Find Prayer", "Find John 3:16"), jump directly to timestamp.
