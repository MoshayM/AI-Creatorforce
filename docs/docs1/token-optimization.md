# token-optimization.md — AI CreatorForce

> Owner document for **AI cost and token efficiency**: context compression, prompt discipline, output/response caching, semantic memory, conversation summaries, incremental regeneration, partial updates, parallelism, duplicate detection, streaming, budget limits, and context-window protection. Provider *selection* economics are owned by `model-routing.md`; this document governs **what we send, what we reuse, and what we refuse to spend**.

**North-star metric:** tokens (and USD) **per published video**, tracked per agent/class in Grafana (`deployment.md` §7, `monetization-framework.md` C).

---

## 1. Principles

1. **Never pass unnecessary context.** Every prompt receives the minimum sufficient input for its schema — enforced by typed input builders, not convention.
2. **Never pay twice for the same answer.** Deterministic caching on every call.
3. **Regenerate the delta, not the document.** Section-level hashes make partial regeneration the default.
4. **Budgets are checked before spend, always.**
5. **Measure, then optimize.** Every call's tokens/cost are recorded; optimizations must show up in the per-video metric.

## 2. Context Assembly Discipline

- Each agent has a **context builder** in `packages/agents/<agent>/context.ts` that selects fields explicitly (allow-list) from project state. Passing whole rows/bundles is forbidden by type: builders accept narrow input types only.
- **Tiered context:** (T1) task-critical (always) → (T2) helpful (include if token headroom) → (T3) background (summarized reference only). Builders emit tiers; the AI Client drops T3→T2 under pressure (§9).
- Static instructions live in versioned prompts (`prompts.md`), enabling provider-side **prompt caching** where supported (shared preamble + agent instructions form a stable cache prefix; volatile data goes last).

## 3. Context Compression

- **Research packs:** stored in full, but agents receive per-claim **summaries** (already paraphrased by ResearchAgent); full excerpts only for the specific claims under review (FactCheck receives claim-scoped slices, not the whole pack).
- **Channel context:** compressed **channel profile card** (~300 tokens: niche, voice descriptors, top-performing patterns, constraints) regenerated on a schedule from raw history — agents never receive raw analytics rows.
- **Long scripts:** downstream agents receive the section under work + one-line summaries of sibling sections ("script map"), not the full script, unless the task class requires global coherence (`write` final pass).
- **Conversation/iteration summaries:** when a creator iterates with an agent (regenerate hooks, revise section), prior turns collapse into a rolling summary (map-reduce) capped at a fixed token budget; raw turns persist in DB for audit but are not re-sent.

## 4. Prompt Templates & Versioning

Owned by `prompts.md`; the optimization rules layered on top: templates are token-audited in CI (a template exceeding its token budget fails the eval gate); few-shot examples must pay for themselves in eval quality per `prompts.md` §7; schema descriptions are minimized (field names + one-line constraints, not prose essays).

## 5. Output & Response Caching

- **Key:** `(agentName, promptKey@version, modelId, inputHash)` where `inputHash` = stable hash of the built context. Store: Redis with per-class TTL (trend/SEO lookups: hours; script/spec generations: until input changes — effectively content-addressed).
- Cache hits are traced (`cached=true`) and cost $0; hit rate per agent is a first-class dashboard metric.
- **External data caching:** YouTube/Google-Trends/provider reads cached per `architecture.md` §6 so agents consume cached signals rather than re-fetching.
- **Media caching:** voice/image/render idempotency keys make identical regenerations free (`media-pipeline.md` §8).
- Invalidation: input-hash keying makes explicit invalidation unnecessary for generations; signal caches expire by TTL.

## 6. Incremental Regeneration & Partial Updates

- **Scripts:** each section carries a `contentHash`. "Improve the hook" re-runs ScriptAgent with `{section: hook, scriptMap, reason}` — one section in, one section out; unchanged sections are never re-generated, re-fact-checked, or re-billed. FactCheck re-runs only for claims whose text hash changed.
- **Compliance re-review (WF-7):** ComplianceAgent receives the **diff** (changed sections/fields + bundle map); hard-block screening still considers the full bundle map, but token cost scales with the edit, not the video.
- **SEO/metadata:** title-only edits re-score metadata without regenerating descriptions.
- **Voice:** per-section TTS jobs (`media-pipeline.md` §5) — changing one paragraph re-synthesizes one take.
- **Timeline/render:** version+preset-keyed render cache (`media-pipeline.md` §8).

## 7. Semantic Memory (pgvector)

- **Store:** `memory_embeddings(id, channelId, kind enum(topic, hook_pattern, retention_finding, style_note), text, embedding vector, sourceRef, createdAt)` — Postgres + pgvector.
- **Writes:** GrowthAgent findings, accepted hooks, per-channel winning patterns — distilled statements (≤ 2 sentences each), not raw data.
- **Reads:** context builders retrieve top-k (k ≤ 5) relevant memories by similarity for Trend/Audience/Script tasks — replacing "send the whole channel history" with ~200 tokens of relevant memory.
- **Honesty rule:** memories are advisory context; factual claims still require ResearchAgent sourcing (`compliance.md` §3.5). Memory is tenant-scoped; never crosses channels (`security.md` §9).

## 8. Duplicate Detection

- Before dispatching a generation, embed the request intent and compare against recent project requests (cosine ≥ threshold within a time window) → surface "you generated a nearly identical script 10 minutes ago — reuse or continue?" in the UI instead of silently spending.
- Cross-project: TrendAgent dedupes candidate topics against the channel's existing projects/memory to avoid paying to rediscover the same opportunity.

## 9. Context-Window Protection

- The AI Client counts tokens (provider-appropriate tokenizer) for every built context **before** dispatch; requirement: `input + maxOutput + safetyMargin ≤ model.contextTokens` (hard filter in routing, `model-routing.md` §4.1).
- Overflow handling order: drop T3 tier → summarize T2 → route to a larger-context model (if floor-passing and budget-fitting) → fail with `VALIDATION_FAILED` and a precise "context too large" reason. Never silent truncation of T1 content.

## 10. Parallelism & Batching

- Independent agent tasks run concurrently (WF-1 assets fan-out; per-section voice jobs; per-scene image jobs) — latency, not tokens, but it protects the creator's time budget.
- Embedding writes and analytics diagnoses batch on schedules; low-priority batch work runs on cheaper models per routing weights.

## 11. Streaming

- All `write`-class outputs stream to the UI (script sections render as they generate) via the existing WS/SSE channel — perceived latency win at zero token cost.
- Streaming still terminates in schema validation: the client renders provisional text; only the validated final object persists. Analytical `reason` outputs (compliance, fact-check) do **not** stream partial verdicts (no half-verdicts in the UI).

## 12. Budget Limits (enforcement summary)

Owned by `monetization-framework.md` A4–A5; restated as invariants: (1) reserve estimated cost before dispatch, settle actuals after; (2) `BUDGET_EXCEEDED` refuses with zero spend; (3) per-pipeline caps circuit-break runaway loops (a Supervisor plan that would exceed the cap is trimmed or refused up-front, not mid-flight); (4) per-call caps prevent any single call from consuming a period budget.

## 13. Acceptance Criteria

1. No agent context builder passes unbounded/whole-entity inputs (lint rule + type enforcement).
2. Cache hit returns identical output at $0 and is visible in traces.
3. Editing one script section triggers exactly one section-scoped generation + claim-scoped fact-check.
4. A context exceeding the window is degraded tier-by-tier or refused — never silently truncated.
5. Cost per published video is reported per tier and alerting on regression.

## 14. Future Extension

Provider-side prompt-cache optimization per provider, learned context selection (which T2 items actually improve quality), cross-user (privacy-safe, aggregate) trend-signal caching, distillation of frequent tasks onto self-hosted models via Ollama.

## 15. Cross References

`model-routing.md` (selection, floors, downgrade) · `prompts.md` (templates, evals) · `monetization-framework.md` (budgets, metering) · `media-pipeline.md` (media idempotency) · `architecture.md` §5–6 · `database.md` (memory_embeddings) · `analytics.md` §8 (ops metrics).
