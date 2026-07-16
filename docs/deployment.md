# deployment.md — AI CreatorForce

This document covers CI pipeline structure, build commands, runtime startup, required environment variables, observability setup, and the bundle budget gate. Test authoring conventions are in `testing.md`; secrets handling and environment variable security are in `security.md`.

---

## 1. Environments

| Env | Purpose | Notes |
|-----|---------|-------|
| local | Developer workstation | `pnpm dev` — web: 3007, api: 4007 |
| CI | GitHub Actions | Postgres 16 + Redis 7 as services, full test suite |
| staging | Pre-production verification | Planned — not yet deployed |
| production | Live platform | Planned — target: Cloudflare/Vercel + managed Postgres + managed Redis |

---

## 2. CI Pipeline (.github/workflows/ci.yml)

Triggered on: push to `master`, `main`, `develop`; pull requests targeting `master` or `main`. Concurrency group cancels in-progress runs for the same ref on new push.

Runtime: Node 24. pnpm version resolved from the repo's `packageManager` field (not a pinned CI version).

Jobs run in dependency order:

### 2.1 lint
ESLint across all packages and apps.

### 2.2 typecheck
`tsc --noEmit` on all packages. `prisma generate` runs first — NestJS module types depend on the generated Prisma client.

### 2.3 unit-tests
Jest with coverage collection. `prisma generate` runs first (same reason as typecheck). Coverage artifact retained for 7 days.

### 2.4 build
Runs after lint + typecheck + unit-tests all pass. `prisma generate` runs first here too.

- `pnpm build` via Turborepo builds all packages and apps in dependency order.
- Environment: `SKIP_ENV_VALIDATION=true`, `NEXT_TELEMETRY_DISABLED=1`.
- `SENTRY_AUTH_TOKEN` used for source map upload (if set).
- Bundle budget gate runs immediately after build (see Section 5). Hard failure on violation blocks the pipeline.

### 2.5 security
`pnpm audit --audit-level=high` on all packages. `dependency-review-action` runs on pull requests to surface new vulnerable dependencies before merge.

### 2.6 semgrep
Semgrep SAST in two modes:
- Custom rules at `.semgrep/creatorforce.yml` — ERROR severity, blocking.
- `p/typescript` registry rules — informational only.

### 2.7 zap-baseline
OWASP ZAP passive scan against the production web build. High-risk findings fail the job. ZAP report artifact retained for 30 days.

### 2.8 e2e
Playwright cross-browser matrix: chromium, firefox, webkit run in parallel. Full stack required: Postgres + Redis services, API started (`node apps/api/dist/main.js`), web built with `next build` then started with `next start -p 3007` (production build — not dev mode). `TOKEN_ENCRYPTION_KEY` is set in the E2E CI environment. Playwright report artifact retained for 7 days on failure. Job timeout: 40 minutes.

A separate workflow `.github/workflows/nextjs.yml` handles Next.js-specific deployment steps.

---

## 3. Build Commands

```bash
# Install (locked)
pnpm install --frozen-lockfile

# Generate Prisma client (required before typecheck, test, or build)
pnpm --filter @cf/api exec prisma generate

# Build shared packages first (Turborepo handles order, but explicit if needed)
pnpm --filter @cf/tsconfig --filter @cf/eslint-config --filter @cf/shared build

# Build everything
pnpm build

# Run API unit tests
pnpm --filter @cf/api run test

# Run Playwright e2e (per browser)
pnpm --filter @cf/e2e exec playwright test --project=chromium
pnpm --filter @cf/e2e exec playwright test --project=firefox
pnpm --filter @cf/e2e exec playwright test --project=webkit
```

---

## 4. Runtime Startup

### API
```bash
# Production
node apps/api/dist/main.js

# Database migration (run before API start in production)
prisma migrate deploy

# Health check
GET /health
GET /api/docs
```

### Web
```bash
# Production
next start -p 3007

# Local development
next dev -p 3007
```

Default ports: web = 3007, api = 4007 (overridden by `API_PORT`).

---

## 5. Bundle Budget Gate

Script: `apps/web/scripts/check-bundle-budget.mjs`

Thresholds:

| Metric | Limit |
|--------|-------|
| Per-route first-load JS | 800 KB |
| Total unique JS | 1500 KB |

Baseline (2026-07): 571 KB per-route / 1001 KB total. Diffs against `apps/web/scripts/bundle-budget-baseline.json` to detect creep between PRs.

On violation: hard failure, CI blocks merge. Artifact `bundle-budget-report.json` retained for 90 days.

---

## 6. Required Environment Variables

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | PostgreSQL 16 connection string |
| `REDIS_URL` | Redis 7 connection string |
| `JWT_SECRET` | Token signing secret |
| `TOKEN_ENCRYPTION_KEY` | Min 32 characters — used for OAuth token encryption |
| `API_PORT` | Defaults to 4007 |
| `NODE_ENV` | `development` / `production` |
| `ANTHROPIC_API_KEY` | Primary LLM provider |
| `OPENAI_API_KEY` | Fallback LLM provider |
| `GEMINI_API_KEY` | Fallback LLM provider |
| `STRIPE_SECRET_KEY` | Billing |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |
| `SUPER_ADMIN_EMAILS` | RBAC: comma-separated super-admin email list |
| `OWNER_EMAILS` | RBAC: comma-separated owner email list |
| `SENTRY_DSN` | Optional — enables Sentry error tracking |
| `SENTRY_AUTH_TOKEN` | Optional — CI build for source map upload |
| `COMPLIANCE_CACHE_TTL_MS` | Optional — defaults to 86400000 (24 hours) |

CI pipelines accept placeholder values for provider keys (ANTHROPIC_API_KEY, etc.) in non-e2e jobs. E2e jobs require real or sandbox credentials.

---

## 7. Observability

### Error tracking
- `@sentry/nestjs` on the API, `@sentry/nextjs` on the web app.
- Both are conditional on `SENTRY_DSN` being set — no Sentry calls if unset.

### Metrics
- `prom-client` on the API exposes `GET /metrics` in Prometheus text format.
- `MetricsInterceptor` records `http_request_duration_ms` histogram on every request.
- Prometheus config: `infra/monitoring/prometheus.yml`.
- Grafana dashboards: `infra/monitoring/grafana/provisioning/dashboards/`.
- Alert rules: `infra/monitoring/alerts.yml`.
- Full monitoring stack (Prometheus + Grafana): `infra/monitoring/docker-compose.monitoring.yml`.

---

## 8. Vercel Split-Deploy

The frontend (`apps/web`) can be deployed to Vercel while the backend (API, workers, Postgres, Redis, FFmpeg) must run on a persistent host (Railway, Render, Fly.io, or a VPS). Vercel's serverless model is incompatible with the long-running NestJS process and multi-minute FFmpeg renders. See [deployment-vercel.md](deployment-vercel.md) for step-by-step instructions.

---

## 9. Go-Live Runbook (one-time steps at first production deploy)

These are the readiness-report items that can only be executed against live
production infrastructure. Everything needed to run them ships in the repo.

### 9.1 Channel OAuth reconnect (readiness item 7)

Channels that authorized before the final OAuth scope set lack
`youtube.upload` and cannot publish. The app already detects this — channel
access level is computed from stored scopes (`accessLevelFromScopes`,
`channels.service.ts`) and `invalid_grant` errors surface a reconnect prompt.

At go-live:
1. Count affected channels:
   `SELECT COUNT(*) FROM "Channel" WHERE active AND NOT ('https://www.googleapis.com/auth/youtube.upload' = ANY(scopes));`
2. Email/notify those users: "Reconnect your channel to enable publishing" —
   the reconnect button is on the Channels page.
3. Verify the count trends to zero before enabling auto-publish automations.

### 9.2 Production ZAP baseline scan (readiness item 10)

CI already runs a ZAP baseline against a local production build on every push.
The one-time production-URL scan (needs Docker + the deployed site):

```sh
docker run --rm -v "$PWD/.zap:/zap/wrk" ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t https://aicreatorforce.net -J zap-prod-summary.json
node .zap/check-zap-summary.mjs .zap/zap-prod-summary.json   # gates on High-risk findings
```

Pass criterion: zero High-risk (riskcode 3) findings. Archive the JSON report
with the release notes.

### 9.3 k6 load baseline (readiness item 15)

Script: `infra/load/k6-baseline.js` (read-only endpoints, no AI spend).
Run against a production-like environment — never a shared dev box:

```sh
k6 run infra/load/k6-baseline.js -e BASE_URL=https://api.aicreatorforce.net
```

Ramps 0 → 500 VUs over 5 minutes, holds 5 minutes. Pass criteria are encoded
as k6 thresholds: p95 latency < 500 ms, error rate < 1%. A 30-second smoke
variant for any environment: append `-e SMOKE=1`. Record the summary output
in the release notes.

---

## 10. Planned / Not Yet Implemented

- Staging environment
- Database backup automation
- CDN configuration
- n8n workflow runtime deployment
- Blue/green or rolling deploy strategy
- Infrastructure-as-code (IaC) for cloud resources beyond monitoring stack

For container/Kubernetes deployment (Dockerfiles, manifests, HPA, ingress) see [deployment-kubernetes.md](deployment-kubernetes.md).
