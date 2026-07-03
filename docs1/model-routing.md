# model-routing.md — AI CreatorForce

> Owner document for the **AI Client's provider abstraction and routing policy**: how every model call selects a provider/model across **Claude, OpenAI, Gemini, DeepSeek, Grok, Mistral, OpenRouter, and Ollama** (plus future providers) using task complexity, latency, context length, quality, budget, provider health, and user preference — with deterministic fallback rules. The AI Client's mechanics (retry, metering, tracing) are introduced in `architecture.md` §3.5; this document is the routing law.

> **Volatility note:** model names, capabilities, context windows, and prices change frequently. All values live in **config** (`packages/shared/ai/providers.config.ts` + env/remote config), never in code. Verify against current provider documentation at build time.

---

## 1. Principles

1. **Never hardcode a provider.** Agents declare a *task class* and constraints; the router picks the model.
2. **Config over code.** Provider registry, model capability matrix, weights, and fallback chains are configuration, hot-reloadable where safe.
3. **Deterministic and explainable.** Given the same inputs and health state, routing is reproducible; every call's trace records *why* a model was chosen (`routingReason`).
4. **Budget is a hard constraint,** not a preference (`monetization-framework.md` A4).
5. **Local option exists.** Ollama enables self-hosted/dev/offline routing for non-critical task classes.

## 2. Provider Registry

```ts
interface ProviderConfig {
  id: "claude" | "openai" | "gemini" | "deepseek" | "grok" | "mistral" | "openrouter" | "ollama" | string;
  enabled: boolean;
  auth: SecretRef;                       // secret manager reference, never inline
  models: ModelConfig[];
  rateLimits: { rpm: number; tpm: number };
  healthCheck: { intervalS: number; errorThresholdPct: number; latencyP95Ms: number };
}

interface ModelConfig {
  id: string;                            // provider's model identifier (config-managed)
  taskClasses: TaskClass[];              // which classes it may serve
  contextTokens: number;                 // max context
  maxOutputTokens: number;
  qualityScore: Record<TaskClass, number>; // 0–100, from internal evals (prompts.md §7)
  costPer1kIn: number; costPer1kOut: number; // USD, config-updated
  latencyP50Ms: number;                  // rolling observed
  supports: { json: boolean; streaming: boolean; vision: boolean; tools: boolean };
}
```

**OpenRouter** is registered as a meta-provider: it expands to its own model list and is preferred when it offers the cheapest equivalent-quality route for a class. **Ollama** models carry `deployment: "local"` and are excluded from compliance/fact-check classes by default (quality floor, §4).

## 3. Task Classes

Every `aiClient.run()` call declares one class (extends `ai` contract in `architecture.md`):

| Class | Used by (examples) | Needs |
|-------|--------------------|-------|
| `reason` | Supervisor, Compliance, FactCheck | Highest quality, strict JSON |
| `write` | Script, SEO copy, Metadata, growth narrative | High quality, style control |
| `extract` | Research summarization, trend-signal parsing | Mid quality, high volume |
| `classify` | Intent labels, flag triage, dedupe checks | Low cost, fast |
| `embed` | Semantic memory, similarity (token-optimization.md §7) | Embedding models |
| `vision` | Thumbnail/CTR critique, image QC | Vision-capable |
| `mediaSpec` | Voice/image/edit specs (media-pipeline.md) | Mid quality, strict JSON |

## 4. Selection Algorithm

For a call `{taskClass, estInputTokens, estOutputTokens, constraints, userPref?, budgetRemaining}`:

1. **Filter (hard constraints):**
   - model serves `taskClass`; `contextTokens ≥ estInputTokens + headroom` (context-window protection, `token-optimization.md` §9);
   - required capabilities (json/streaming/vision) supported;
   - provider healthy (circuit not open, §5);
   - projected cost ≤ per-call cap and ≤ `budgetRemaining`;
   - **quality floor:** `qualityScore[taskClass] ≥ floor(taskClass)` — compliance/fact-check floors are high and non-configurable below a safety minimum.
2. **Score (soft preferences):**
   `score = wq·quality + wc·(1 − normCost) + wl·(1 − normLatency) + wh·healthScore + wp·prefBonus`
   Default weights per class (config): `reason` {wq .55, wc .10, wl .10, wh .15, wp .10}; `classify`/`extract` {wq .25, wc .40, wl .15, wh .10, wp .10}; others between. `prefBonus` applies when the user/plan pinned a provider (Pro+ feature) — preference can *bias*, never violate a hard constraint.
3. **Pick highest score;** tie-break by lower cost, then lower latency.
4. **Budget-aware downgrade:** if the top pick would exceed the pipeline's remaining budget but a floor-passing cheaper model fits, route down and tag the trace `downgraded=true`; if nothing fits, refuse with `BUDGET_EXCEEDED` **before any spend**.
5. Record `{chosenModel, candidates, scores, routingReason}` on the trace/`agent_steps`.

## 5. Provider Health & Circuit Breaking

- Rolling window per provider+model: error rate, timeout rate, p95 latency, rate-limit hits.
- Breach of thresholds → **circuit open** (excluded from routing) for a cool-down; half-open probes restore it.
- Health state is shared via Redis so all workers route consistently; Grafana panels + alerts on open circuits (`deployment.md` §7).

## 6. Fallback Rules

- **Per-call fallback chain** derived from the ranked candidate list: on retryable failure (5xx, timeout, rate-limit) after in-provider backoff retries, advance to the next candidate. Max 2 provider hops per call; then fail the job to normal queue retry (`agents.md` shared rules).
- **Schema-repair retries stay on the same model** (a validation failure is a prompt problem, not a provider problem) — one repair pass, then QualityControlAgent (`prompts.md` §3).
- Fallback events are traced and counted; sustained fallback on a class triggers an ops alert (mispriced or degraded default).

## 7. Non-LLM Media Providers (same abstraction, separate registries)

Voice (ElevenLabs, OpenAI TTS, Google Cloud TTS), image (gpt-image, Imagen, Flux, SD endpoints), music (Suno, Udio, Stable Audio), video (Veo, Kling, Runway, Pika, Luma) each get a typed connector registry with the **same pattern**: config-driven registry, capability matrix (voices/styles/max duration/aspect ratios), health checks, cost-per-unit metering, budget-before-dispatch, provenance on output. Routing here is usually **creator choice within plan-allowed providers** rather than automatic scoring — quality is subjective; the platform routes automatically only for `draft_proxy`-quality generations. Contracts live in `packages/shared/ai/media/`.

## 8. Configuration & Change Management

- Model/price/weight changes ship as reviewed config PRs; hot-reload for weights/prices, deploy for new providers.
- Changing a default model for `reason`/`write` classes requires passing the prompt-eval regression set first (`prompts.md` §7); results attached to the PR.
- Per-environment overrides: local defaults may pin Ollama for `classify`/`extract` to develop offline at zero cost.

## 9. Observability & Cost Accounting

Every call records tokens, cost, latency, provider, model, promptVersion, routingReason, cached?, downgraded?, fallbackHops → `agent_steps` + Prometheus. Dashboards: cost per class, per agent, per provider; routing distribution; downgrade/fallback rates. Roll-ups feed `usage_records` (`monetization-framework.md`).

## 10. Security

Provider keys only via secret manager (`security.md` §4); per-provider egress allow-list; prompts never contain secrets; Ollama endpoints must be platform-controlled hosts (no user-supplied URLs — SSRF guard).

## 11. Acceptance Criteria

1. No provider SDK import outside `packages/shared/ai`.
2. Disabling any single provider in config leaves every task class routable (with possible quality/cost trade-off), verified by a routing simulation test.
3. A budget-exhausted call is refused with zero provider spend.
4. Compliance/fact-check classes never route below their quality floor, even under total-outage fallback — they fail rather than degrade.
5. Every production call's trace contains a `routingReason`.

## 12. Future Extension

Learned routing (bandit optimization on quality/cost feedback), per-tenant fine-tuned/custom models, regional routing for data-residency, speculative parallel calls for latency-critical paths.

## 13. Cross References

`architecture.md` §3.5 · `token-optimization.md` (budgets, caching, context protection) · `prompts.md` §7 (eval gates) · `agents.md` §5 · `media-pipeline.md` §5–8 · `monetization-framework.md` A3–A5 · `security.md` §4/§10 · `testing.md` (routing simulation, fallback tests).
