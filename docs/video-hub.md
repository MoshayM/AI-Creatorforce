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
| 5 — Chapters, Small Videos, Social Content, Church AI | New analysis signals (speakers, OCR, embeddings), chapter detection, small-video + social-content factories | ❌ not started |
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

## Next steps (Phase 5 entry points)

1. Chapter detection job (`CHAPTER_DETECTION`) after topic analysis; `chapters`
   table + Chapters accordion on the analysis page.
2. Embeddings job + pgvector for NL search ("find John 3:16").
3. Small-video generation service reusing the Shorts render path with
   horizontal presets.
