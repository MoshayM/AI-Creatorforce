# techstack.md — AI CreatorForce

This document is the canonical reference for every technology, library, and tooling choice in the AI CreatorForce monorepo. Versions listed here match the `package.json` files checked into `apps/api` and `apps/web`; the source of truth for exact resolved versions is the pnpm lockfile. Related reading: [architecture.md](architecture.md), [build.md](build.md), [database.md](database.md), [deployment.md](deployment.md), [testing.md](testing.md).

---

## Summary Table

| Layer | Technology | Version | Why |
|---|---|---|---|
| Backend framework | NestJS | ^10.4.7 | Module-per-engine structure, DI, Guards, Interceptors |
| ORM | Prisma | ^6.2.1 | Type-safe DB client, migration runner, schema-first |
| Database | PostgreSQL | 16 | ACID, CHECK constraints for wallet polymorphism |
| Queue | BullMQ | ^5.34.0 | Redis-backed durable job queue for async agent work |
| Cache / Queue broker | Redis | 7 | BullMQ broker + ephemeral cache |
| Real-time | @nestjs/websockets + socket.io-client | ^10.4.7 / ^4.8.1 | Job-progress streaming to browser |
| AI providers | Anthropic Claude, OpenAI, Google Gemini | via shared aiClient | Multi-provider fallback, token accounting |
| Frontend framework | Next.js | ^15.1.4 | App Router, Server Components, file-based routing |
| React | React | ^19.0.0 | Concurrent features, Server Components |
| UI primitives | Radix UI | various | Accessible, unstyled component primitives |
| Styling | Tailwind CSS + tailwind-merge | ^3.4.17 / ^2.6.0 | Utility-first, conflict-safe class merging |
| Server state | TanStack Query | ^5.64.1 | Caching, background refetch, cache invalidation |
| Virtual lists | TanStack Virtual | ^3.13.0 | Windowed rendering for large lists |
| Forms | React Hook Form + Zod | ^7.54.2 / ^3.24.1 | Performant forms, schema-validated inputs |
| Auth (frontend) | next-auth | ^4.24.11 | Session management, coordinates with API JWT |
| Auth (backend) | @nestjs/jwt + passport-jwt | ^10.2.0 | JWT issuance, JwtAuthGuard, refresh-token rotation |
| Media / render | ffmpeg-static | ^5.3.0 | Bundled ffmpeg binary for render pipeline |
| Observability | prom-client + @sentry/nestjs + @sentry/nextjs | ^15.0.0 / ^8.55.2 | Prometheus metrics, error tracking |
| Testing — unit | Jest | ^29.7.0 | Co-located *.spec.ts, API unit tests |
| Testing — e2e | Playwright | (apps/e2e) | Cross-browser: chromium, firefox, webkit |
| API mocking | MSW | ^2.7.0 | API mocking in dev and test (frontend) |
| SAST | Semgrep | CI step | Static analysis in GitHub Actions |
| DAST | OWASP ZAP | CI step (baseline) | Dynamic baseline scan in CI |
| Build / monorepo | Turborepo + pnpm workspaces | pnpm ^11.x | Incremental builds, task graph, shared packages |
| TypeScript | TypeScript | ^5.7.3 | strict:true everywhere |
| Package manager | pnpm | ^11.x | Workspace-aware, fast installs |
| Node version | Node | 24 | Used in CI |

---

## Backend (apps/api)

NestJS 10 runs on the Express adapter. The module structure mirrors the Core Engines defined in [architecture.md](architecture.md): one NestJS module per engine (Auth, Channels, Projects, Content, Compliance, Jobs, Publishing, Shorts Studio, Billing, Analytics, BI, Orgs, Growth, Trial, Dev Portal, Copilot, Metadata, SEO, Trend, Audience, Assets, Media, Render, Timeline, Voice, Image, Music, Approvals, Settings, Notifications, Flags, AI-Ops, Metrics, Health). Guards and interceptors enforce JWT authentication (`JwtAuthGuard`) and Prometheus metrics collection (`MetricsInterceptor`) at the application level.

**Async job processing.** Any operation exceeding ~2 seconds, or any call to an external AI, video, or music provider, runs as a BullMQ job on the `AGENT_QUEUE`. The queue backend is Redis 7. BullMQ 5 provides durable job storage, retries, job-progress events, and dead-letter handling. Workers consume jobs and emit Socket.io events for real-time progress in the browser.

**Database.** Prisma 6 is the ORM. All migrations are the source of truth; never alter the database directly. Schema canonical location: `apps/api/prisma/schema.prisma` (also synced to `infra/db/schema.prisma`). PostgreSQL 16 is used in CI as a Docker service and in production. See [database.md](database.md) for the full model inventory.

**HTTP security.** Helmet 8 sets security headers (CSP, HSTS, X-Frame-Options, etc.) at the Express level. JWT tokens are signed with `@nestjs/jwt` and `jose 5`. Passwords hashed with `bcryptjs 2.4`. Refresh-token rotation tracked via `AuthSession` model.

**API documentation.** `@nestjs/swagger ^8.1.0` generates OpenAPI 3 specs from decorators. Swagger UI is served at `/api/docs` in non-production environments. See [api.md](api.md) for the full route inventory.

**Observability.** `prom-client 15` exposes a `/metrics` endpoint scraped by Prometheus. `MetricsInterceptor` records an `http_request_duration_ms` histogram per route. `@sentry/nestjs 8` captures unhandled exceptions and traces. Structured trace events are emitted per agent call (agent name, model, tokens, latency, cost).

**Validation.** `class-validator 0.14` and `class-transformer 0.5` validate incoming HTTP request DTOs. Zod 3.24 validates agent outputs and env vars — all agent outputs are validated against Zod schemas before use; schema failures trigger a retry up to `MAX_AGENT_RETRIES`, then route to `QualityControlAgent`.

**Other notable backend dependencies.** `googleapis 144` for YouTube Data API v3. `stripe 17` for payment processing. `ioredis 5` for direct Redis access (cache, session checks). `rxjs 7` for NestJS observable patterns. `axios 1.7` for outbound HTTP in service layer. `passport`, `passport-jwt`, `passport-local` for strategy wiring.

---

## Frontend (apps/web)

Next.js 15 with the App Router. Server Components are the default; Client Components are used only where interactivity is required. The App Router handles file-based routing, layouts, loading states, and streaming.

**Session management.** `next-auth v4` manages browser sessions. It coordinates with the API's JWT system: on sign-in, next-auth stores the API-issued access token and refresh token in the encrypted session cookie. The API's `/auth/refresh` endpoint is called when the access token expires.

**Server state.** TanStack Query v5 manages all API data: caching, background refetching, optimistic updates, and cache invalidation. Query keys are namespaced by resource. TanStack Virtual v3 provides windowed rendering for large lists (library videos, clips).

**Real-time.** `socket.io-client v4` connects to the NestJS WebSocket gateway to receive job-progress events. Progress is rendered via Radix UI Progress primitives.

**UI components.** Radix UI primitives (Dialog, DropdownMenu, Progress, Tabs, Toast) provide accessible, headless components. `lucide-react 0.469` supplies the icon set. Tailwind CSS 3.4 is the styling system; `tailwind-merge 2.6` resolves class conflicts; `clsx 2.1` handles conditional class composition. `date-fns 4` for date formatting.

**Forms.** React Hook Form 7 + `@hookform/resolvers` + Zod 3.24: every form has a Zod schema; resolvers bridge RHF and Zod so validation is co-located with the schema.

**API mocking.** MSW v2 intercepts `fetch` calls in development and test environments. Handlers live alongside the routes they mock, enabling deterministic Playwright e2e tests that do not hit a live API.

**Error tracking.** `@sentry/nextjs 8` captures client-side and server-side errors, sourcemaps, and transactions.

---

## Shared Packages

| Package | Contents |
|---|---|
| `packages/shared` | Shared Zod schemas, TypeScript types, `aiClient` (multi-provider AI wrapper), media-error types, utilities |
| `packages/agents` | All agent implementations (ResearchAgent, ScriptAgent, ComplianceAgent, FactCheckAgent, etc.) |
| `packages/prompts` | Versioned prompt templates (loaded by agents; never inlined in code) |
| `packages/config` | Shared ESLint config, shared tsconfig presets, shared Tailwind preset |

---

## AI Providers

All AI calls go through the shared `aiClient` in `packages/shared`. The provider is selected per call via an `AICallOptions.provider` field or a default fallback chain. Providers:

- **Anthropic Claude** — primary (via `@anthropic-ai/sdk`)
- **OpenAI** — secondary / fallback (via `openai`)
- **Google Gemini** — tertiary / fallback

`aiClient` handles retries, provider fallback, token accounting, and structured trace event emission. Agent outputs are always validated against a Zod schema before use; schema failures trigger a retry up to `MAX_AGENT_RETRIES`, then route to `QualityControlAgent`.

`ffmpeg-static 5` bundles a static ffmpeg binary used by the render pipeline for video assembly and transcoding.

---

## Infrastructure

| Component | Technology | Notes |
|---|---|---|
| Database | PostgreSQL 16 | Docker service in CI; managed instance in production |
| Cache / Queue | Redis 7 | Docker service in CI; managed instance in production |
| Metrics | Prometheus + Grafana | Config in `infra/monitoring/` |
| Containerisation | Docker | CI services + monitoring compose |
| Asset storage | Cloudflare R2 | Planned — `r2Key` field present in schema, not yet wired |
| CDN | Planned | Not yet implemented |

---

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs the following pipeline on every PR and push:

1. Lint (ESLint 10)
2. Typecheck (`tsc --noEmit`, strict mode)
3. Unit tests (Jest 29, PostgreSQL 16 + Redis 7 Docker services)
4. Build (Turborepo)
5. Security audit (`pnpm audit`)
6. SAST (Semgrep)
7. DAST (OWASP ZAP baseline scan)
8. e2e (Playwright — chromium, firefox, webkit)

CI runs on Node 24.

---

## Coding Standards

- TypeScript `strict: true` everywhere. No `any` without a `// @reason:` comment.
- Zod at every boundary: API inputs (DTOs), agent outputs, environment variables.
- File naming: `kebab-case`. Types / classes: `PascalCase`. Variables / functions: `camelCase`. Environment variables: `SCREAMING_SNAKE_CASE`.
- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Co-located tests: `*.spec.ts` alongside the file under test.
- Async work > 2s or calling external providers: BullMQ job, never inline in a request handler.

---

## Planned / Not Yet Implemented

- **Cloudflare R2 integration** — `r2Key` field exists on `AssetVersion`, integration not wired.
- **External video generation providers** — Veo, Kling, Runway, Pika, Luma (referenced in compliance and asset kind enums).
- **Music generation providers** — Suno, Udio, Stable Audio.
- **n8n workflow runtime** — `n8n/` directory contains exported workflow definitions; runtime not deployed.
- **Per-route rate limiting** — Helmet present; per-route rate limiter not yet configured.
- **Full Swagger decorator coverage** — partial; not all controllers decorated yet.
