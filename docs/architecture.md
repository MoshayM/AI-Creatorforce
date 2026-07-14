# architecture.md — AI CreatorForce

AI CreatorForce is a **modular monolith with an async job backbone**: a NestJS API where each module maps to a Core Engine, all long-running and AI work is offloaded to a single `AGENT_QUEUE` via BullMQ, and a Next.js 15 frontend communicates with the API over REST and WebSocket. The design allows individual modules to be extracted into independent services later without rewrites; for now everything runs in one API process and one worker process.

---

## Related docs

- [project.md](project.md) — what the platform is and its golden rules
- [features.md](features.md) — per-feature breakdown
- [agents.md](agents.md) — agent contracts and provider configuration
- [database.md](database.md) — Prisma schema reference
- [api.md](api.md) — REST and WebSocket surface
- [security.md](security.md) — auth, secrets, encryption
- [deployment.md](deployment.md) — Docker, CI, infrastructure
- [build.md](build.md) — build phases and scope

---

## Backend

**Runtime:** Node.js, NestJS with Express adapter.

**Database:** PostgreSQL accessed via Prisma ORM. All schema changes are managed as Prisma migrations. The schema lives at `apps/api/prisma/schema.prisma`.

**Queue:** BullMQ backed by Redis. A single logical queue named `AGENT_QUEUE` carries all agent jobs. Job types are enumerated in the `JobType` Prisma enum (~50 types covering every agent step and media generation step).

**Real-time:** Socket.io gateway (`AgentJobGateway`) pushes job progress events to connected clients keyed by user ID. Clients subscribe on job creation and receive `progress`, `completed`, and `failed` events.

**NestJS modules (one per Core Engine):**

| Module | Responsibility |
|---|---|
| `auth` | Email+password login, OAuth (Google/Apple/Facebook), JWT access + refresh rotation, `AuthSession` model |
| `channels` + `library` | Channel connection, sync, niche/voice/brand profile, `LibraryVideo`/`LibraryPlaylist` |
| `content` | Long-form content projects, `Project` model |
| `jobs` + `admin-jobs` | Job enqueue, status, admin inspection |
| `compliance` | `ComplianceService.enforce()` / `check()`, SHA-256 cache, `ComplianceResult`/`ComplianceFlag` |
| `approvals` | Human-in-the-loop approval records, `Approval` model |
| `publishing` | YouTube upload gate (checks `Approval.status = 'APPROVED'`), PublishingService |
| `shorts-studio` | Channel-first Shorts flow (import picker, transcript, scenes, clips, timeline, social factory) |
| `media` | Asset/AssetVersion storage, R2 keys |
| `render` | Timeline → RenderPreset → ffmpeg-static → `Render` model |
| `voice` | VoiceAgent job orchestration |
| `image` | ImageAgent job orchestration |
| `music` | MusicAgent job orchestration |
| `assets` | Asset versioning |
| `seo` | SeoAgent job orchestration |
| `trend` | TrendAgent job orchestration |
| `audience` | AudienceAgent job orchestration |
| `metadata` | MetadataAgent job orchestration |
| `analytics` | AnalyticsAgent, `AnalyticsSnapshot`, YouTube Analytics polling |
| `bi` | Business intelligence queries |
| `growth` | Growth reports, referral codes, upgrade engine, marketplace, offers |
| `trial` | `TrialGrant`, trial credit bucket, trial limits |
| `billing` + `wallet` | Stripe subscription, `Wallet`, `CreditLedger`, `CreditLot`, `CreditReservation`, `Payment` |
| `orgs` | `Organization`, `OrgMembership`, `Team`, `TeamMembership` |
| `dev-portal` + `dev-api` | `DeveloperKey`, `DeveloperWebhook`, external API access, developer-key guard |
| `copilot` + `intents` + `token-usage` | Platform AI assistant, intent routing, token accounting UI |
| `notifications` | `Notification` model, push/in-app delivery |
| `flags` | Feature flags |
| `settings` | User/org settings |
| `ai-ops` | Prompt version management (`PromptVersion` model), AI provider config |
| `metrics` | Prometheus metrics via prom-client, `MetricsInterceptor` |
| `health` | Healthcheck endpoints |

---

## Frontend

**Framework:** Next.js 15, App Router. Server Components are the default; Client Components (`'use client'`) are used only when interactivity, browser APIs, or real-time updates are required.

**Server state:** TanStack Query v5 (`@tanstack/react-query`). All API calls go through typed query/mutation hooks. Optimistic updates and background refetch are used on mutation-heavy views.

**Real-time:** Socket.io-client subscribes to job progress events from the API gateway. Job status panels update without polling.

**Forms:** React Hook Form + Zod resolvers. Validation schemas are imported from `packages/shared` to keep frontend and backend validation in sync.

**UI primitives:** Radix UI (accessible, unstyled headless components). Styled with Tailwind CSS.

**Auth session:** next-auth v4 with a custom credentials provider (email+password) and OAuth providers. The JWT session contains `accessToken` and `refreshToken`; the web layer handles silent token refresh.

**Error tracking:** Sentry browser SDK, initialized in `instrumentation.ts`.

**Dev/test mocking:** MSW (Mock Service Worker) intercepts API calls in Storybook and test environments.

---

## Packages

**`packages/agents`** — Stateless, idempotent agent implementations. Each agent: imports its input/output Zod schemas from `packages/shared`, pulls its prompt from `packages/prompts`, calls the shared `aiClient`, validates output against its schema, retries on failure, emits a trace event. Agents: `base-agent`, `research`, `script`, `factcheck`, `compliance`, `metadata`, `seo`, `trend`, `audience`, `analytics`, `growth`, `quality-control`, `edit-plan`, `image`, `voice`, `music`, `video`, `subtitle`.

**`packages/shared`** — Zod schemas for all agent inputs/outputs, `aiClient`, `AICacheAdapter` interface, media error types, shared utility functions. This package is the single source of truth for types shared between `apps/api`, `packages/agents`, and `apps/web`.

**`packages/prompts`** — Versioned prompt templates referenced by agents. Prompts are never inlined in agent code; they are loaded from this package by version ID and stored in the `PromptVersion` model for auditability.

**`packages/config`** — Shared ESLint config, tsconfig presets, Tailwind config preset. Consumed by all apps and packages.

---

## AI client (`packages/shared/src/ai/index.ts`)

Wraps all AI provider calls with a uniform interface:

- **Providers:** `anthropic`, `openai`, `gemini` — selected per call or by agent-level config.
- **`AICacheAdapter` interface** — Redis-backed implementation in the API (keyed by prompt hash), no-op implementation in tests. Agents pass `bypassCache: true` for non-deterministic or time-sensitive calls.
- **`onUsage` hook** — Called after every completion with token counts and cost estimate; used by `token-usage` module and `CreditLedger` to attribute spend.
- **Retry + fallback** — Configurable retry count; on exhaustion can fall back to a secondary provider if configured.
- **Structured output** — `callAIStructured(schema)` wraps the completion and validates the response against a Zod schema, throwing on failure so the caller can retry.

---

## Job pipeline

```
HTTP request
  → JobsService.enqueue(jobType, payload)
  → BullMQ AGENT_QUEUE
  → SupervisorWorker (picks up job, reads JobType)
  → dispatches sub-jobs as child BullMQ jobs
  → agent-specific BullMQ workers
  → agent calls aiClient → validates output (Zod)
  → writes result to DB (AgentLog, Script, etc.)
  → emits Socket.io event to client
```

Every worker is registered in `workers.module.ts`. Job options (attempts, backoff, TTL) are set per job type in `JobsService`. Failed jobs after `MAX_AGENT_RETRIES` are routed to `QualityControlAgent` and flagged in `AgentLog`.

---

## Observability

**Error tracking:** Sentry is initialized in both `apps/api` (NestJS exception filter) and `apps/web` (`instrumentation.ts`). All unhandled exceptions and agent failures are captured with structured context.

**Metrics:** `prom-client` runs in `apps/api`. A `MetricsInterceptor` records request count, latency, and error rate for every NestJS route. A `/metrics` endpoint exposes Prometheus-format data. Grafana dashboards are defined in `infra/monitoring/`.

**Audit trail:** `AuditLog` model records all state-changing actions (approval, publish, compliance override, billing event).

**Tracing:** Each agent emits a structured trace event (agent name, model, provider, token counts, latency, cost estimate) to `AgentLog` in the database.

---

## Security headers

**API:** Helmet middleware applies standard HTTP security headers to all responses.

**Web:** `next.config.ts` sets:
- `X-Frame-Options: DENY`
- `Strict-Transport-Security` (HSTS)
- `Permissions-Policy` (restricts camera/mic/geolocation)
- Strict Content Security Policy (CSP) with explicit `script-src`, `connect-src`, and `img-src` directives

OAuth tokens stored in `AuthSession` are encrypted at rest using `TOKEN_ENCRYPTION_KEY`.

---

## Planned / not yet implemented

**n8n workflow runtime** — The `n8n/` directory holds exported workflow JSON definitions. A running n8n instance with access to the API's webhook endpoints has not yet been provisioned. When deployed, n8n workflows will orchestrate multi-step automations that currently require manual job chaining.

**Horizontal worker scaling** — All BullMQ workers run in a single Node.js process alongside the API. The queue is designed for horizontal scaling (multiple worker replicas), but the deployment currently runs single-process. Worker extraction is a deployment-time change requiring no code changes.
