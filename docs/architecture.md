# architecture.md — AI CreatorForce

## 1. Architectural Style

AI CreatorForce is a **modular monolith with an async job backbone**, designed to be split into services later without rewrites. Backend modules map 1:1 to the Core Engines. Long-running and external-provider work is offloaded to a queue. Heavy multi-step automations are expressed as n8n workflows that call back into the API.

Principles: clear module boundaries, async-by-default for external calls, every AI output validated, compliance as a hard gate, and full observability (traces, metrics, cost).

## 2. High-Level Diagram

```
                         ┌────────────────────────────────────────┐
                         │              Client (Web)               │
                         │   Next.js App Router · Tailwind · shadcn │
                         └───────────────┬──────────────────────────┘
                                         │ HTTPS / WSS (Cloudflare)
                         ┌───────────────▼──────────────────────────┐
                         │            API Gateway (NestJS)           │
                         │  Auth · Rate limit · Validation · RBAC    │
                         └───┬───────────┬───────────┬───────────┬───┘
                             │           │           │           │
              ┌──────────────▼┐ ┌────────▼───────┐ ┌─▼──────────┐ ┌▼───────────┐
              │ Engine Modules│ │  Agent Runtime │ │  Billing   │ │ Publishing │
              │ (Trend, SEO,  │ │ (Supervisor +  │ │  (Stripe)  │ │ (YouTube   │
              │  Audience,    │ │  sub-agents)   │ │            │ │  Data API) │
              │  Content, …)  │ └───────┬────────┘ └────────────┘ └─────┬──────┘
              └───────┬───────┘         │                               │
                      │        ┌────────▼─────────┐                     │
                      │        │  AI Client Layer │  Claude/OpenAI/     │
                      │        │  (retry/fallback/ │  Gemini · Veo/Kling │
                      │        │   trace/cost)     │  /Runway/Pika/Luma  │
                      │        └────────┬─────────┘  · Suno/Udio/Stable │
                      │                 │                               │
        ┌─────────────▼─────────────────▼───────────────────────────────▼─────┐
        │                        Async Backbone                                │
        │     Redis · BullMQ queues (research, generate, render, publish)      │
        └─────────────┬───────────────────────────────────────┬───────────────┘
                      │                                         │
            ┌─────────▼─────────┐                     ┌─────────▼─────────┐
            │   PostgreSQL      │                     │  Cloudflare R2    │
            │ (relational core) │                     │ (assets/objects)  │
            └───────────────────┘                     └───────────────────┘

        Observability: Sentry (errors) · Prometheus (metrics) · Grafana (dash)
        Automation:    n8n (long workflows) calls API + queues
```

## 3. Layers

### 3.1 Presentation (apps/web)
Next.js App Router. Server Components fetch via the API; Client Components handle interactivity (editors, drag-drop scene planner, A/B thumbnail picker). Real-time job status via WebSocket/SSE.

### 3.2 API Gateway (apps/api)
Single NestJS app. Responsibilities: authentication (Auth.js sessions / JWT for service calls), RBAC, request validation (Zod via pipe), rate limiting, and routing to engine modules. Stateless; horizontally scalable behind Cloudflare.

### 3.3 Engine Modules (packages + apps/api/src/modules)
One NestJS module per Core Engine. Each exposes a service interface and emits/consumes jobs. Modules never call each other's internals directly—only through services or the orchestrator.

### 3.4 Agent Runtime (packages/agents)
The `SupervisorAgent` decomposes a goal into agent tasks and sequences them. Each sub-agent is stateless, takes a typed input, returns a Zod-validated output. The agent runtime is invoked from jobs, not directly from HTTP handlers.

### 3.5 AI Client Layer (packages/shared/ai)
Single abstraction over all model providers. Handles: provider selection per task, automatic fallback (e.g., Claude → Gemini), exponential-backoff retries, token + cost accounting, prompt-version tagging, and OpenTelemetry tracing. No agent calls a provider SDK directly.

### 3.6 Async Backbone (Redis + BullMQ)
Queues by domain: `research`, `content`, `compliance`, `assets-music`, `assets-video`, `assets-thumbnail`, `publish`, `analytics`. Workers are horizontally scalable. Jobs are idempotent and carry a correlation ID.

### 3.7 Persistence
- **PostgreSQL**: users, channels, projects, content items, scripts, scores, compliance reports, jobs, billing, analytics snapshots. See `database.md`.
- **Redis**: queues, caching (trend/SEO lookups), rate-limit counters, ephemeral session data.
- **Cloudflare R2**: generated/imported media — audio, video, thumbnails, exports. Postgres stores R2 object keys + provenance.

### 3.8 Automation (n8n)
n8n hosts long, branchy workflows (e.g., full "idea → publish" pipeline with human-approval pauses). It calls the API and enqueues jobs; it never touches the database directly.

## 4. Request → Pipeline Lifecycle

1. Client triggers an action (e.g., "Plan video from trend X").
2. API validates, authorizes, creates a `ContentProject`, enqueues the first job, returns a job/correlation ID.
3. Workers execute agent tasks via the orchestrator; each writes results + traces.
4. Compliance gate runs; failures route back to QA/creator with reasons.
5. Client subscribes to job status over WS/SSE and renders results progressively.
6. On approval, the publish job calls the YouTube Data API and records the result.

## 5. Cross-Cutting Concerns

- **Validation**: Zod at every boundary.
- **Idempotency**: jobs keyed by `(projectId, step, attempt)`.
- **Provenance**: every generated asset records provider, model, prompt version, params, timestamp.
- **Cost control**: AI Client meters tokens/credits; budgets enforced per plan before dispatch.
- **Observability**: structured logs, Prometheus metrics (latency, queue depth, cost/job), Sentry errors, trace IDs spanning HTTP → job → provider.
- **Security**: secrets in a secret manager; OAuth tokens encrypted at rest; least-privilege IAM. See `security.md`.

## 6. Scalability & Evolution

- Stateless API + worker pools scale horizontally.
- Provider calls isolated in the AI Client, so adding/swapping providers is config-level.
- A module can be extracted into its own service by promoting its service interface to an RPC boundary; the queue contract already decouples it.
- Caching layer (Redis) shields external rate-limited APIs (YouTube, Google Trends data sources).

## 7. Environments

`local` (docker-compose) → `staging` (full infra, test providers/sandbox keys) → `production` (Cloudflare + AWS). See `deployment.md`.
