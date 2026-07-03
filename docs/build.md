# build.md — AI CreatorForce

> The implementation playbook. A team should be able to start building from this document plus the others in `docs/`. Phasing follows MVP → Beta → Public Launch.

---

## 1. Phases

### Phase 1 — MVP (prove the core loop)
**Goal:** A single creator can go Idea → Script → Compliance → Manual asset workflow → Publish to YouTube, with human approval.

In scope:
- Auth (Auth.js) + single YouTube channel connect (OAuth, encrypted tokens).
- Engines: Trend (basic), SEO (basic), Audience (basic), Content (script + research + fact-check), **Compliance (full gate)**, Metadata, Publishing.
- Agents: Supervisor, Trend, SEO, Audience, Script, Research, FactCheck, Compliance, Metadata, Publishing, QualityControl.
- Workflows: WF-2 (trend), WF-3 (script studio), WF-5 (publish), WF-7 (re-review). WF-1 wired end-to-end without auto-asset-generation (asset *briefs* only; generation via guided external workflow).
- AI Client layer with one primary + one fallback provider, cost metering.
- Async backbone (Redis/BullMQ), Postgres schema, R2 storage.
- Basic dashboard, project center, approval center, job/progress center.
- Stripe: Free + Creator plans, budget enforcement.
- Observability baseline (Sentry, basic metrics).

Out of scope (MVP): in-app video/music/thumbnail generation, teams/RBAC, agencies, advanced analytics, n8n long workflows.

**MVP exit criteria:** end-to-end publish of an original, compliance-passed video; zero compliance-bypass paths; tests green.

### Phase 2 — Beta (assets + analytics + teams)
- Asset generation in-app: Music (Suno/Udio/Stable Audio), Video (Veo/Kling/Runway/Pika/Luma), Thumbnail — via official APIs/workflows, provenance stored. WF-4 enabled.
- Analytics Intelligence: AnalyticsAgent + GrowthAgent, WF-6 loop, creator dashboards.
- n8n long workflows for full WF-1 with human-pause checkpoints.
- Teams & RBAC, multiple channels, Pro plan.
- A/B thumbnail testing.
- Hardened observability (Prometheus/Grafana dashboards, alerts), staging E2E.

### Phase 3 — Public Launch (scale + agencies + polish)
- Agency tier: many channels, pooled credits, outbound webhooks, SSO, audit export, MFA.
- Scaling: worker pool separation, read replicas, provider load-balancing, quota-aware scheduling.
- Cost/margin dashboards, advanced budgeting/overage.
- Full DR (backups, restore drills, runbooks).
- Marketing site, onboarding, docs, support tooling.
- Performance + security hardening pass; penetration test.

---

## 2. Folder Structure

```
creatorforce-ai/
├── claude.md
├── docs/                      # all design docs
├── apps/
│   ├── web/                   # Next.js (App Router)
│   │   ├── app/               # routes (server components by default)
│   │   ├── components/        # UI (shadcn-based)
│   │   ├── lib/               # api client, hooks, ws
│   │   └── ...
│   └── api/                   # NestJS
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   ├── channels/
│       │   │   ├── projects/
│       │   │   ├── jobs/
│       │   │   ├── trend/
│       │   │   ├── seo/
│       │   │   ├── audience/
│       │   │   ├── content/        # script, research, factcheck
│       │   │   ├── compliance/
│       │   │   ├── music/
│       │   │   ├── video/
│       │   │   ├── thumbnail/
│       │   │   ├── metadata/
│       │   │   ├── publishing/
│       │   │   ├── analytics/
│       │   │   └── billing/
│       │   ├── workers/            # BullMQ processors
│       │   ├── common/             # guards, pipes, filters, interceptors
│       │   └── main.ts
│       └── ...
├── packages/
│   ├── agents/                # Supervisor + sub-agents
│   ├── shared/                # types, Zod schemas, ai client, utils
│   ├── prompts/               # versioned prompt templates
│   └── config/                # eslint/tsconfig/tailwind presets
├── infra/
│   ├── docker/                # Dockerfiles
│   ├── db/                    # prisma schema, migrations, seed
│   ├── github-actions/        # CI/CD workflows (or .github/workflows)
│   └── grafana/               # dashboards
├── n8n/                       # exported workflow JSON
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── .env.example
```

---

## 3. Database Schema

Source of truth: Prisma schema in `infra/db`. Entities and rules are specified in `docs/database.md` (users, teams, channels, projects, scripts, research_packs, factcheck_results, compliance_reports, assets, metadata_drafts, publish_records, jobs, analytics_snapshots, subscriptions, usage_records, prompt_versions, audit_logs). Key safety rule: no `publish_record` without `compliancePassed && humanApproved`.

---

## 4. API Design

Full surface in `docs/api.md`. MVP implements: auth, channels, trends, seo, audience, content (research/script/factcheck), compliance, metadata, publish, projects, jobs, billing, realtime. Beta adds music, video, thumbnails, analytics, growth, teams. All endpoints Zod-validated; long ops return `202 + jobId`.

---

## 5. Deployment Architecture

See `docs/deployment.md`. MVP: Cloudflare + AWS (Fargate), managed Postgres/Redis, R2, GitHub Actions CI/CD, Sentry. Beta/Launch add Prometheus/Grafana, worker pool separation, read replicas, DR.

---

## 6. Testing Strategy

See `docs/testing.md`. Required: unit tests for agents/services, integration tests for pipelines (esp. compliance gate), E2E for the publish flow. A test must prove the compliance gate cannot be bypassed.

---

## 7. CI/CD Pipeline

See `docs/deployment.md` §4. PR: lint → typecheck → unit → build → integration → security scans. Merge: image build/scan → staging migrate/deploy → E2E. Release: prod migrate → deploy (blue/green) → smoke. Migrations gated and backward-compatible.

---

## 8. Cost Estimation

See `docs/monetization-framework.md` (Part A/C) and `docs/deployment.md` §9. Headline metric: **cost per published video**. Levers: model tiering, caching, creator-initiated generation, plan budgets, autoscaled batched workers.

---

## 9. Scaling Strategy

See `docs/architecture.md` §6 and `docs/deployment.md` §6. Stateless web/api autoscale; workers scale by queue depth with heavy/light pool separation; DB read replicas + pooling; Redis cluster as needed; provider fallback + quota-aware scheduling.

---

## 10. Security Strategy

See `docs/security.md`. Non-negotiables: secrets in secret manager, OAuth tokens encrypted at rest, RBAC + tenant scoping, Zod validation, prompt-injection defenses, webhook signature verification, no compliance bypass.

---

## 11. Build Order (suggested first sprints)

1. Monorepo scaffold (pnpm + turbo), config packages, `.env.example`, docker-compose.
2. Prisma schema + migrations + seed; Postgres/Redis/R2 wiring.
3. AI Client layer (provider abstraction, retry/fallback, metering, tracing) + Zod shared schemas.
4. Auth + YouTube channel connect (OAuth, encrypted tokens).
5. Agent runtime + Supervisor + Script/Research/FactCheck agents.
6. **Compliance engine + gate + tests proving no bypass.**
7. Metadata + Publishing (YouTube Data API) with precondition gate + idempotency.
8. Frontend: dashboard, project/approval/job centers, script editor.
9. Stripe (Free/Creator) + budget enforcement.
10. Observability baseline + CI/CD to staging.

Then proceed to Phase 2/3 per §1.

---

## 12. Definition of Done (per feature)

Strict TS compiles, tests pass, lint clean, docs updated, secrets externalized, traces/metrics emitted, and—if it touches the content pipeline—compliance gating intact and test-verified. (Mirrors `claude.md` §8.)
