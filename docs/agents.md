# agents.md — AI CreatorForce

This document is the canonical reference for every AI agent in the platform: the shared base class, the full agent catalogue, the AI client contract, validation rules, compliance specifics, tracing, and the checklist for adding new agents. Read alongside [workflows.md](workflows.md), [prompts.md](prompts.md), and [architecture.md](architecture.md).

---

## 1. Agent Model

AI CreatorForce uses a **supervised multi-agent** design. The `SupervisorWorker` (see §7) decomposes a creator goal into a plan of sub-agent tasks and sequences them via BullMQ. Sub-agents are **stateless, idempotent, single-responsibility**: they accept a typed input, call an AI provider via the shared `aiClient`, and return a Zod-validated typed output. A `QualityControlAgent` audits outputs that fail validation or quality heuristics and either repairs them or routes them to human review.

---

## 2. BaseAgent

**File:** `packages/agents/src/base-agent.ts`

All agents extend `BaseAgent<TInput, TOutput>`. The base class enforces the shared calling convention and cannot be bypassed.

**Abstract fields (must be defined by each subclass):**

| Field | Type | Purpose |
|---|---|---|
| `name` | `string` | Agent identifier used in traces and logs |
| `systemPrompt` | `string` | Prompt key reference (format: `agentname.tasktype@version`) |

**Abstract method:**

```ts
abstract run(input: TInput, ctx: AgentContext): Promise<TOutput>;
```

**Protected methods (provided by BaseAgent):**

| Method | Delegates to | Use when |
|---|---|---|
| `callAI(messages, opts)` | `packages/shared` `callAI` | Free-form text response |
| `callStructured(messages, schema, opts)` | `packages/shared` `callAIStructured` | Typed, schema-validated response |

Neither method calls a provider SDK directly. All provider calls flow through the shared `aiClient`.

---

## 3. AgentContext

```ts
interface AgentContext {
  jobId: string;
  projectId: string;
  userId: string;
}
```

Passed into every `run()` call. Used for correlation in traces, logs, and the `AgentLog` DB record.

---

## 4. Agent Catalogue

All 18 agents, their source files, the BullMQ job types they serve, their output schema, and key dependencies.

| Agent | Class file | Job types served | Output schema | Key dependency |
|---|---|---|---|---|
| ResearchAgent | `research.agent.ts` | `RESEARCH` | `ResearchResultSchema` | External search/web tools |
| ScriptAgent | `script.agent.ts` | `SCRIPT` | `ScriptSchema` | ResearchAgent output |
| FactCheckAgent | `factcheck.agent.ts` | `FACT_CHECK` | `FactCheckResultSchema` | Script + research pack |
| ComplianceAgent | `compliance.agent.ts` | `COMPLIANCE` | `ComplianceResultSchema` | Full content bundle |
| MetadataAgent | `metadata.agent.ts` | `METADATA` | `MetadataSchema` | SEO output + approved title |
| SEOAgent | `seo.agent.ts` | `SEO_OPTIMIZATION` | `SEOResultSchema` | Topic + audience profile |
| TrendAgent | `trend.agent.ts` | `TREND_DISCOVERY` | `TrendResultSchema` | Cached trend signals |
| AudienceAgent | `audience.agent.ts` | `AUDIENCE_STRATEGY` | `AudienceStrategySchema` | Topic + channel profile |
| AnalyticsAgent | `analytics.agent.ts` | `ANALYTICS` | `AnalyticsReportSchema` | YouTube Analytics API data |
| GrowthAgent | `growth.agent.ts` | `GROWTH_REPORT` | `GrowthReportSchema` | AnalyticsAgent output |
| QualityControlAgent | `quality-control.agent.ts` | `QC_REVIEW` | `QCResultSchema` | Any failing agent output |
| EditPlanAgent | `edit-plan.agent.ts` | `EDIT_PLAN` | `EditPlanSchema` | Script + edit commands |
| ImageAgent | `image.agent.ts` | `IMAGE_GENERATION` | `ImageResultSchema` | Thumbnail/asset brief |
| VoiceAgent | `voice.agent.ts` | `VOICE_GENERATION` | `VoiceResultSchema` | Script segments |
| MusicAgent | `music.agent.ts` | `MUSIC_BRIEF` | `MusicBriefSchema` | Scene energy map |
| VideoAgent | `video.agent.ts` | `VIDEO_PLAN` | `VideoScenePlanSchema` | Script + style guide |
| SubtitleAgent | `subtitle.agent.ts` | `SUBTITLE_GENERATION` | `SubtitleSchema` | Transcript/audio data |
| GrowthAgent (alias) | `growth.agent.ts` | `GROWTH_REPORT` | `GrowthReportSchema` | AnalyticsAgent output |

> Note: A fully autonomous `SupervisorAgent` class is **planned but not yet implemented**. Currently, the `SupervisorWorker` (`apps/api/src/workers/supervisor.worker.ts`) dispatches directly based on `JobType`, acting as the orchestrator. See §8 for planned vs. implemented status.

---

## 5. AI Client (shared)

**File:** `packages/shared/src/ai/index.ts`

The shared `aiClient` is the single call site for all provider interactions. Agents must never import a provider SDK directly.

**Providers (implemented):**

| Enum value | Provider |
|---|---|
| `anthropic` | Anthropic (Claude) |
| `openai` | OpenAI |
| `gemini` | Google Gemini |

Model selection is passed via call options or falls back to per-provider defaults defined in config.

**AICacheAdapter interface:**

```ts
interface AICacheAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}
```

Redis-backed in the API. Pass `bypassCache: true` for non-deterministic calls (e.g., creative script generation). Set `ttlSeconds` on cache writes; compliance and fact-check results are cached by SHA-256 content hash.

**onUsage callback:**

Fires after every provider call with an `AIUsageEvent`:

```ts
interface AIUsageEvent {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  fromCache: boolean;
  cacheKind?: string;
}
```

The API layer uses this hook for credit accounting (`WalletService`) and Prometheus metrics.

**aiClient responsibilities:** retries with backoff, fallback to secondary provider on outage/rate-limit, token accounting, and trace emission. Agents do not implement retry logic themselves.

---

## 6. Validation Contract

Every `callStructured()` call passes a Zod schema. The flow is:

1. Provider returns a response.
2. `callAIStructured` parses against the Zod schema.
3. **On parse success:** return typed output to agent.
4. **On parse failure:** retry the call, appending the validation error to the prompt, up to `MAX_AGENT_RETRIES` (env var).
5. **After exhausting retries:** route the job to `QualityControlAgent` with the last error attached.
6. Raw, unvalidated output is never surfaced to callers or stored as a result.

---

## 7. Long-Form Content Pipeline

Orchestrated by `SupervisorWorker`. Compliance and human-approval are hard gates; neither can be bypassed in code.

```
ResearchAgent
  → ScriptAgent
  → FactCheckAgent
  → ComplianceAgent       [HARD GATE: score < 70 or BLOCK severity = job fails]
  → MetadataAgent
  → SEOAgent
  → Approval (human gate) [PublishingService throws ForbiddenException if not APPROVED]
  → PublishingService     → YouTube Data API
```

See [workflows.md](workflows.md) for the full job-status transition model and the Shorts Studio pipeline.

---

## 8. ComplianceAgent Specifics

**File:** `packages/agents/src/compliance.agent.ts`

Output is Zod-validated against `ComplianceResultSchema` before any downstream action.

**Categories:**

`COPYRIGHT` | `MISINFORMATION` | `HATE_SPEECH` | `VIOLENCE` | `ADULT_CONTENT` | `SPAM` | `IMPERSONATION` | `PRIVACY` | `ADVERTISER_FRIENDLY`

**Severity levels:**

`INFO` | `WARNING` | `CRITICAL` | `BLOCK`

**Gate rules:**

- `score < 70` = not passed; content is blocked.
- Any flag with severity `BLOCK` = absolute block, regardless of score. There is no override path.

**Invocation:** `ComplianceService.enforce()` wraps `callAIStructured` and caches results by SHA-256 hash of the content bundle. Any edit to the bundle invalidates the cache and requires a fresh compliance run.

---

## 9. Tracing

Each agent call emits a structured trace event persisted to the `AgentLog` DB model and to Prometheus metrics:

| Field | Source |
|---|---|
| `agentName` | `BaseAgent.name` |
| `model` | Resolved model string from aiClient |
| `tokensIn` | From `AIUsageEvent` |
| `tokensOut` | From `AIUsageEvent` |
| `latencyMs` | Wall-clock time of the provider call |

Cost (`costUsd`) is recorded via the `onUsage` hook and posted to the credit ledger separately.

---

## 10. Adding a New Agent — Checklist

1. Define input and output Zod schemas in `packages/shared`.
2. Pull the prompt from `packages/prompts` using the `agentname.tasktype@version` key format. Never inline a large prompt in the agent class.
3. Extend `BaseAgent<TInput, TOutput>`. Implement `name`, `systemPrompt`, and `run()`.
4. Use `callStructured()` (not `callAI()`) for any response that will be stored or passed downstream.
5. Emit a trace event (handled automatically by `BaseAgent` if using the shared call methods; verify the `AgentLog` write).
6. Register the new `JobType` in the shared `JobType` enum (`packages/shared`).
7. Add a handler in `SupervisorWorker` (`apps/api/src/workers/supervisor.worker.ts`).
8. Write co-located unit tests (`*.spec.ts`) with a fixture for schema validation failure → retry → QC routing.

---

## 11. Planned / Not Yet Implemented

| Item | Status |
|---|---|
| `SupervisorAgent` as an independent agent class | Planned. Currently `SupervisorWorker` dispatches directly by `JobType`. |
| DeepSeek, Grok, Mistral, Ollama, OpenRouter providers | Referenced in design docs. Only `anthropic`, `openai`, and `gemini` are implemented in `packages/shared/src/ai/index.ts`. |
| Full versioned prompt library for all 18 agents | In progress. Some agents still have system prompts inline; see [prompts.md](prompts.md). |
