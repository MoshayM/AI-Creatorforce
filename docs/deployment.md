# deployment.md — AI CreatorForce

## 1. Environments

| Env | Purpose | Notes |
|-----|---------|-------|
| local | Development | docker-compose: Postgres, Redis, n8n, api, web, worker |
| staging | Pre-prod testing | Full infra; sandbox/test provider keys; seeded data |
| production | Live | Cloudflare + AWS; real keys via secret manager |

Promotion path: `local → staging → production`, gated by CI and manual approval to prod.

## 2. Topology (production)

```
                 Cloudflare (DNS · CDN · WAF · R2)
                          │
                   ┌──────▼───────┐
                   │  Web (Next)  │  containers, autoscaled
                   └──────┬───────┘
                          │
                   ┌──────▼───────┐
                   │  API (Nest)  │  containers, autoscaled
                   └──┬────────┬──┘
                      │        │
        ┌─────────────▼┐   ┌───▼───────────┐
        │ Workers      │   │ n8n           │  long workflows
        │ (BullMQ)     │   │ (container)   │
        └──┬────────┬──┘   └───────────────┘
           │        │
   ┌───────▼┐  ┌────▼────────┐
   │Postgres│  │   Redis     │  managed (AWS)
   └────────┘  └─────────────┘
        R2 (objects) · Sentry · Prometheus/Grafana
```

- **Compute:** AWS ECS (Fargate) or EKS for web/api/worker/n8n containers.
- **Data:** managed PostgreSQL (RDS/Aurora) + managed Redis (ElastiCache).
- **Objects:** Cloudflare R2.
- **Edge:** Cloudflare in front of web/api.

## 3. Containerization

- Each app (`web`, `api`, `worker`, `n8n`) has its own Dockerfile (multi-stage, pinned base images, non-root user).
- Images built in CI, scanned for vulnerabilities, pushed to a registry (ECR), tagged by commit SHA.
- `docker-compose.yml` for local parity.

## 4. CI/CD (GitHub Actions)

### Pipeline stages
```
on PR:
  1. install (pnpm, cached)
  2. lint (eslint) + format check (prettier)
  3. typecheck (tsc --noEmit)
  4. unit tests (vitest/jest)
  5. build (turbo build)
  6. integration tests (api + queue, against ephemeral Postgres/Redis)
  7. SAST + dependency scan + secret scan
on merge to main:
  8. build & scan Docker images → push (SHA tag)
  9. run DB migrations against staging
 10. deploy to staging
 11. smoke/E2E (Playwright) on staging
on tagged release (manual approval):
 12. run migrations against production
 13. blue/green or rolling deploy to production
 14. post-deploy smoke checks + alert on failure
```

- **Migrations:** Prisma migrations run as a gated CI step; never manual. Backwards-compatible migrations preferred (expand/contract pattern) to allow zero-downtime deploys.
- **Secrets:** injected from secret manager at deploy; never in workflow files. CI uses OIDC to assume AWS roles (no long-lived cloud keys).
- **Rollback:** keep previous image; rollback = redeploy prior SHA. Migrations designed to be backward-compatible to allow app rollback without DB rollback.

## 5. Configuration & Secrets

- All config via environment variables; documented in `.env.example`.
- Secrets from AWS Secrets Manager/SSM (see `security.md`).
- Feature flags via config for gradual rollout of new agents/providers.

## 6. Scaling Strategy

- **Stateless web/api:** horizontal autoscale on CPU/RPS.
- **Workers:** scale per queue depth (separate worker pools for heavy queues: video/music render vs light queues: research/seo).
- **Database:** read replicas for analytics-heavy reads; connection pooling (PgBouncer).
- **Redis:** sized for queue throughput + cache; cluster mode if needed.
- **Providers:** AI Client load-balances/falls back across providers; generation jobs batched and rate-limited to respect provider + YouTube quotas.
- **Cost-aware autoscale:** scale down idle worker pools; budget alerts prevent runaway spend.

## 7. Observability in Prod

- **Sentry:** errors across web/api/workers.
- **Prometheus:** scrape app/worker metrics; **Grafana** dashboards + alerts (queue backlog, error rate, p95 latency, budget burn, provider failures).
- **Tracing:** OpenTelemetry; correlation IDs across HTTP → job → provider.
- **Health checks:** `/healthz` (liveness), `/readyz` (readiness incl. DB/Redis).
- **Alerting:** pager on prod outages, queue stalls, payment webhook failures, compliance-gate errors.

## 8. Backups & DR

- Automated daily Postgres backups + point-in-time recovery; periodic restore drills.
- R2 versioning/lifecycle for assets.
- Documented disaster-recovery runbook with RTO/RPO targets.

## 9. Cost Estimation (planning, order-of-magnitude)

> Indicative only; validate with real provider pricing at build time.

| Cost area | Driver | Lever |
|-----------|--------|-------|
| LLM tokens | per script/agent run | model tiering, caching |
| Video gen | per clip | plan credits, creator-initiated |
| Music gen | per track | plan credits |
| Compute | container hours | autoscale, batch workers |
| DB/Redis | instance size | right-size, replicas only as needed |
| Storage/egress | R2 GB + ops | lifecycle, dedupe |
| Edge | Cloudflare plan | fixed/usage |

Track **cost per published video** as the headline unit metric (see `monetization-framework.md`).

## 10. Release Hygiene

- Conventional commits → automated changelog.
- Database and provider changes flagged in PRs.
- No deploy on red CI; no manual hotfix bypassing migration gate.
