# AI Video Analysis & Content Creation Hub — Implementation Plan

> Working plan for the `Ai-video edit.md` v2.0 specification, mapped onto the
> existing NestJS/Next.js architecture. The spec's own phasing (§23) is
> followed; this doc records what each phase means **in this codebase** and
> what has shipped.

## Phase status

| Spec phase | Scope | Status |
|---|---|---|
| 1 — Intent Schema + Action Bus | `CopilotCommandSchema` (packages/shared) is the unified intent schema; `CopilotService.execute()` is the action bus. `POST /intents` gives UI code the same entry point as chat/voice. `actions` audit table records every turn from every modality. | ✅ shipped |
| 2 — Token Governor | `token_usage` ledger populated by a global `setAIUsageListener` hook in the shared aiClient (covers agents + workers + copilot). Phrase→intent Redis cache (`IntentCacheService`) answers repeated commands with zero tokens. Cache-hit rate + cost surfaced on the Analytics page via `GET /token-usage/summary`. | ✅ shipped |
| 3 — Copilot Panel | Chat + voice panel with confirmation gates, multilingual replies (spoken), hands-free conversation loop, spoken approvals. | ✅ shipped (predates this doc) |
| 4 — Voice Control | Voice input inside the copilot panel incl. spoken confirmation of gated commands; `voice_commands` history now recorded per spoken turn. Wake-word + standalone Voice Control Bar | ⏳ partial |
| 5 — Chapters, Small Videos, Social Content, Church AI | New analysis signals (speakers, OCR, embeddings), chapter detection, small-video + social-content factories | ⏳ chapter detection shipped |
| 6 — Analytics dashboard + YouTube chapter sync | AI Usage card shipped; full per-video cost breakdown + chapter sync | ⏳ partial |
| 7 — Hardening / load tests | 4–8 hr video loads | ❌ not started |

## What shipped in this slice

### Unified Intent/Action layer (§8, §14, §15)
- **`actions` table** (`ActionRecord`): every copilot/voice/UI intent lands here
  with `source` (UI | COPILOT | VOICE), `intentType`, payload, status
  (EXECUTED | NEEDS_CONFIRMATION | FAILED), `fromCache`, `tokensUsed`.
- **`POST /intents`** executes any validated `CopilotCommand` with
  `source: 'UI'`; confirmation-gated commands require `confirmed: true` —
  the same `EXPENSIVE_ACTIONS` gate as chat and voice, so intent parity (§24)
  holds by construction. `GET /intents/:id` returns the audit record.
- **`voice_commands` table**: raw transcript + resolved intent per spoken turn.
- **`copilot_sessions` table**: compressed per-user memory (recent intent
  chain), never raw transcripts (§12.2.6).

### Token Governor v1 (§12)
- **Ledger**: `setAIUsageListener` in `packages/shared/src/ai` fires on every
  successful provider call; `UsageLedgerService` persists to `token_usage`
  (provider, model, tokens, estimated USD). Per-turn attribution flows through
  the new `onUsage` call option into `ActionRecord.tokensUsed`.
- **Phrase→intent cache** (`IntentCacheService`, Redis, 7-day TTL):
  - only decisions that carry a command are cached;
  - an id-bearing command is cacheable **only if every id appears verbatim in
    the phrase** — a cached intent can never smuggle a stale id into a new
    conversation;
  - confirmation turns (`pendingCommand`) never touch the cache;
  - cache hits still pass the confirmation gate and re-execute against live
    data — only the LLM interpretation is reused.
- **Visibility**: `GET /token-usage/summary` → totals, per-model breakdown,
  copilot cache-hit rate (spec target ≥80 %, §12.3). Rendered as the
  "AI Usage" card on the Analytics page; cached copilot replies show an
  "⚡ instant" badge in the panel.

## Deliberate deviations from the spec doc

- No separate `services/` microservice tree — engines live as NestJS modules
  per `claude.md` conventions; the spec's components map to:
  `copilot-service` → `modules/copilot`, `token-governor` →
  `IntentCacheService` + `UsageLedgerService` + shared aiClient hooks.
- `copilot_sessions` is keyed per **user** (current copilot spans projects),
  not per project; revisit when the Video Analysis page gets its own scoped
  panel.
- Undo ring buffer (§7.4) deferred: `actions` records everything needed to
  build it, but no inverse-operations engine exists yet.
- **No pgvector** (spec §10 vector-db): this deployment runs a native Windows
  Postgres 16 without the extension. Embeddings live in the existing
  `TranscriptSegment.embedding Float[]` column as unit-normalized 768-dim
  vectors; search is an in-process dot-product scan (milliseconds for a
  single video's few thousand segments). Revisit pgvector when cross-library
  search at scale lands.
- Embeddings use openai → gemini (Anthropic has no embeddings API); on this
  machine Gemini (`gemini-embedding-001`) is the live path.

### Chapter detection (§5/§11, Phase 5 slice 1)

- **`chapters` table** (`Chapter`): contiguous partition of the video —
  startMs/endMs, title, summary, keyPoints, confidence, `source`
  (DETECTED | IMPORTED, the latter reserved for Phase 6 YouTube sync),
  `editedByUser` so re-detection never clobbers a manual rename.
- **`CHAPTER_DETECTION` job**: final SHORTS_ANALYZE stage. Consumes the stored
  topic segments (never the raw transcript — §12 token rules) in ONE batched
  LLM call; boundaries are snapped server-side to real topic starts, first
  chapter anchored to 0:00, sub-10s chapters merged (YouTube rules). Self-skips
  when chapters exist. `POST /videos/:id/detect-chapters` runs it standalone
  for videos analyzed before this shipped.
- **REST**: `GET /videos/:id/chapters`, `PATCH /chapters/:id` (rename/edit).
- **Copilot**: `list_chapters` command — deterministic zero-token lookup (§12.1
  names "chapter list" explicitly).
- **UI**: Chapters tab on the analysis page — accordion with key points,
  inline rename, and a Detect-chapters button when empty.

### Embeddings + NL search (§5, Phase 5 slice 2)

- **`embedTexts` in the shared aiClient**: openai → gemini chain, batched
  (100/request), unit-normalized 768-dim vectors, metered into the
  `token_usage` ledger like every other AI call (§12.2.8).
- **`EMBEDDING_GENERATION` job**: last SHORTS_ANALYZE stage (deliberately —
  a missing embeddings key never blocks topics/highlights/chapters). Embeds
  only segments without a vector, persisting per chunk → naturally resumable,
  self-skips when complete. `POST /videos/:id/generate-embeddings` runs it
  standalone.
- **Search**: `GET /videos/:id/search?q=` — one embedding call for the query,
  dot-product scan over stored vectors, results carry timestamps + containing
  chapter. Dimension-mismatched (stale) vectors are skipped, not mis-scored.
- **Copilot**: `search_video` command ("find John 3:16" → spoken timestamp
  list, §22 Search tab example).
- **UI**: Search tab on the analysis page — query box, timestamp-chip results
  with chapter context and match %, generate-embeddings empty state.

### Small videos (§10, Phase 5 slice 3)

- **`SMALL_VIDEO` ClipType** (16:9, ≤10 min preset) flowing through the
  UNCHANGED ShortClip machinery — timeline editor, captions, render, export,
  approval, publish all work on small videos for free.
- **Provenance split on ShortClip**: `topicSegmentId` is now optional and
  `chapterId` was added — exactly one is set (highlight-based Shorts vs
  chapter-based Small Videos). Every consumer (captions, export metadata,
  thumbnails, render labels, AI editing assistant, clip lists) resolves
  title/summary/keywords/importedVideoId from whichever side exists;
  chapter `keyPoints` become the export hashtags/tags.
- **Batched generation** (§12.4): `POST /videos/:id/small-videos` creates one
  candidate per chapter in one call — zero AI, chapters ARE the analysis
  graph. Chapters under 60s are skipped (Shorts territory); over-cap chapters
  are clipped to 10 min from their start. Resumable: existing chapter clips
  are reused.
- **Copilot**: `generate_small_videos` command; **UI**: Generate button on the
  Chapters tab, small videos appear in the Clips list titled by chapter.

### Church AI pack (§11, Phase 5 slice 4)

- **Chapter extension**: `bibleRefs[]`, `discussionQuestions[]`, `devotional`
  live on the chapter row — the pack is an overlay on the analysis graph, and
  `GET /videos/:id/chapters` carries it with no new endpoint.
- **`CHURCH_PACK_GENERATION` job**: on-demand only (never in the default
  pipeline). ONE batched call over all chapters (§12.4) using stored
  titles/summaries/keyPoints — the transcript is never re-read. The prompt
  forbids invented scripture (empty `bibleRefs` when none is cited) and
  degrades gracefully for non-faith content (practical reflection instead).
  Chapters with a devotional are skipped → re-runs fill gaps, never clobber.
- **Copilot**: `generate_church_pack`, confirmation-gated (EXPENSIVE_ACTIONS —
  real LLM spend on request).
- **UI**: "Church pack" button on the Chapters tab; expanded chapters show
  Scripture, numbered discussion questions, and the devotional.

### YouTube chapter sync (§11, Phase 6 slice 1)

- **Publish**: `POST /videos/:id/sync-chapters` writes the "0:00 Title" block
  into the live YouTube description via the channel's OAuth (videos.list →
  upsert block → videos.update, preserving title/category/tags). The local
  description and `chaptersSyncedAt` are updated to match. Needs ≥3 chapters
  (YouTube's own render rule).
- **Import (reverse direction, zero tokens)**: CHAPTER_DETECTION now parses
  the video description FIRST — a description that already defines valid
  YouTube chapters (≥3, 0:00 first, ascending) is imported as
  `source: IMPORTED` rows with no LLM call (§12 deterministic-first).
- **Copilot**: `sync_chapters_to_youtube`, confirmation-gated — it mutates
  the public video. **UI**: "Sync to YouTube" button (with confirm) on the
  Chapters tab.
- All block handling (`format`/`parse`/`upsert`) is pure and unit-tested,
  including YouTube's validity rules and replacing an existing block without
  touching the surrounding description.

## Next steps (Phase 5/6 remainder)

1. Per-video AI cost breakdown on Analytics (needs token_usage → video
   attribution).
2. Embedding-grounded copilot answers ("list sermons that mention grace" —
   §11 cross-video query) once cross-video search exists.
3. Social-content factory (quote cards, carousels, blog/newsletter drafts)
   from the same chapter/highlight graph.
