# techstack.md — AI CreatorForce

## 1. Summary Table

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend framework | Next.js (App Router) | SSR/RSC, routing, great DX |
| Language | TypeScript (strict) | End-to-end type safety |
| Styling | Tailwind CSS | Utility-first, consistent |
| UI components | shadcn/ui | Accessible, composable, owned-in-repo |
| Backend framework | NestJS (Node.js) | Modular, DI, maps to engines |
| Database | PostgreSQL | Relational core, JSONB for flexible bundles |
| ORM | Prisma | Type-safe schema + migrations |
| Cache | Redis | Caching, rate limits, ephemeral state |
| Queue | BullMQ (on Redis) | Async jobs, retries, scheduling |
| Object storage | Cloudflare R2 | S3-compatible, low egress cost |
| Auth | Auth.js | Sessions + OAuth (incl. Google/YouTube) |
| Payments | Stripe | Subscriptions, metered billing |
| AI (LLM) | Claude, OpenAI, Gemini | Multi-provider with fallback |
| Video gen | Runway, Kling, Veo, Pika, Luma | Provider-agnostic prompts |
| Music gen | Suno, Udio, Stable Audio | Creator-owned generation |
| Workflow automation | n8n | Long, human-paused pipelines |
| Errors | Sentry | Exception tracking |
| Metrics | Prometheus | Metrics scraping |
| Dashboards | Grafana | Visualization/alerting |
| Containers | Docker | Reproducible environments |
| CI/CD | GitHub Actions | Lint/test/build/deploy |
| Edge/CDN | Cloudflare | CDN, WAF, DNS, R2 |
| Cloud | AWS | Compute (ECS/EKS), managed Postgres/Redis |

## 2. Monorepo & Tooling

- **Package manager:** pnpm (workspaces).
- **Build orchestration:** Turborepo (task caching across `apps/*`, `packages/*`).
- **Lint/format:** ESLint + Prettier, shared config in `packages/config`.
- **Validation:** Zod (shared schemas in `packages/shared`).
- **Testing:** Vitest/Jest (unit), Supertest (API), Playwright (E2E). See `testing.md`.
- **Tracing:** OpenTelemetry → Grafana/Tempo (or compatible).

## 3. Frontend Stack Detail

- Next.js App Router; Server Components by default, Client Components for interactivity.
- Data fetching via typed API client generated from the API's Zod/OpenAPI contract.
- State: React Server Components + lightweight client state (Zustand) where needed; TanStack Query for client-side cache of job/status data.
- Realtime: native WebSocket client with SSE fallback.
- Forms: React Hook Form + Zod resolver.
- Charts (analytics): Recharts.

## 4. Backend Stack Detail

- NestJS modules: one per engine (`trend`, `seo`, `audience`, `content`, `compliance`, `music`, `video`, `thumbnail`, `publishing`, `analytics`) plus cross-cutting (`auth`, `billing`, `projects`, `jobs`, `channels`).
- **AI Client layer** (`packages/shared/ai`): provider abstraction with retry, fallback, token/cost metering, prompt-version tagging, tracing. The only place provider SDKs are imported.
- **Agent runtime** (`packages/agents`): stateless agents invoked from workers.
- **Queue workers:** separate process(es) consuming BullMQ queues; scale independently from the API.

## 5. Data & Storage

- **PostgreSQL** for relational data; JSONB columns for flexible content bundles and agent outputs (with Zod-validated shapes).
- **Redis** for queues (BullMQ), caching trend/SEO lookups, rate-limit counters.
- **Cloudflare R2** for media; Postgres stores object keys + provenance metadata.

## 6. AI Provider Strategy

- Model assignment per agent lives in **config**, not code, so it can change without redeploys where possible.
- Reasoning-heavy agents default to a strong reasoning model; high-volume/cheap tasks use lighter models.
- Automatic fallback to a secondary provider on outage/rate-limit.
- All calls metered for cost; budgets enforced before dispatch.
- Video/music providers integrated via official APIs/export workflows; provenance + ToS notes recorded per asset.

> Verify exact model names, capabilities, pricing, and provider API details against current provider documentation at build time, as these change frequently.

## 7. Observability & Ops

- **Sentry** for errors (web + api + workers).
- **Prometheus** scrapes app/worker metrics (latency, queue depth, job duration, cost/job, provider error rates).
- **Grafana** dashboards + alerts (queue backlog, error spikes, budget burn).
- Structured JSON logs with correlation IDs spanning HTTP → job → provider.

## 8. Security Tooling

- Secret manager (AWS Secrets Manager / SSM) — no secrets in repo.
- Dependency scanning (Dependabot) + SAST in CI.
- OAuth tokens encrypted at rest. See `security.md`.

## 9. Local Development

- `docker-compose` brings up Postgres, Redis, n8n, and the app/worker containers.
- `.env.example` documents all required variables; real `.env` is git-ignored.
- Seed scripts populate demo channel/projects.

## 10. Why a Modular Monolith

Faster to build and operate at launch scale; module boundaries + the queue contract make it straightforward to extract any engine into its own service later without rewriting callers. See `architecture.md` §6.
