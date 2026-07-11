# build.md — AI CreatorForce

> The implementation playbook. A team should be able to start building from this document plus the others in `docs/`. Phasing follows MVP → Beta → Public Launch. This file is the **owner of the folder structure** (§2); other docs reference it.

---

## 1. Phases

### Phase 1 — MVP (prove the core loop)
**Goal:** A single creator can go Idea → Script → Compliance → Manual asset workflow → Publish to YouTube, with human approval.

In scope:
- Auth (Auth.js) + single YouTube channel connect (OAuth, encrypted tokens).
- Engines: Trend (basic), SEO (basic), Audience (basic), Content (script + research + fact-check), **Compliance (full gate)**, Metadata, Publishing.
- Agents: Supervisor, Trend, SEO, Audience, Script, Research, FactCheck, Compliance, Metadata, Publishing, QualityControl.
- Workflows: WF-2 (trend), WF-3 (script studio), WF-5 (publish), WF-7 (re-review). WF-1 wired end-to-end without in-app asset generation (asset *briefs* only; generation via guided external workflow; creator uploads the finished render for publish).
- **AI Client + routing v1:** provider registry with ≥ 2 LLM providers, task classes, quality floors, budget-before-dispatch, fallback (`model-routing.md`); config-driven from day one so adding providers is config work.
- **Token-optimization baseline:** context builders (allow-list inputs), output caching, section-level script hashes, streaming script output (`token-optimization.md`).
- Async backbone (Redis/BullMQ), Postgres schema (incl. `asset_versions` groundwork), R2 storage.
- Basic dashboard, project center, approval center, job/progress center.
- Stripe: Free + Creator plans, budget enforcement (reservation model).
- Observability baseline (Sentry, basic metrics).

Out of scope (MVP): in-app voice/image/video/music/thumbnail generation, editor/render, teams/RBAC, agencies, advanced analytics, n8n long workflows, admin console beyond flags.

**MVP exit criteria:** end-to-end publish of an original, compliance-passed video; zero compliance-bypass paths; tests green.

### Phase 2 — Beta (in-app production + analytics + teams)
- **Media pipeline (`media-pipeline.md`):** VoiceAgent + TTS jobs, ImageAgent + image jobs, Music (Suno/Udio/Stable Audio) and Video (Veo/Kling/Runway/Pika/Luma) generation via official APIs, SubtitleAgent, asset versioning + provenance. WF-4 enabled.
- **Editor + Render (`video-editor.md`, WF-8):** EditPlanAgent first cut, timeline editor (drag & drop, effects catalog v1, undo/redo, autosave, version history, shortcuts), proxy preview loop, deterministic Render worker with presets, local download + R2 retention. WF-1 steps 10–14 live.
- **Model routing full matrix:** all eight providers (Claude/OpenAI/Gemini/DeepSeek/Grok/Mistral/OpenRouter/Ollama) in the registry; routing simulation tests; provider health circuits.
- **Token optimization full:** semantic channel memory (pgvector), duplicate detection, diff-based compliance re-review, conversation summaries.
- Analytics Intelligence: AnalyticsAgent + GrowthAgent, WF-6 loop, retention-over-sections overlay, creator dashboards.
- n8n long workflows for full WF-1 with human-pause checkpoints.
- Teams & RBAC, multiple channels, Pro plan, A/B thumbnail testing.
- **Admin console v1 (`admin.md`):** users/plans, feature flags, prompt ops, abuse queue basics.
- Hardened observability (Prometheus/Grafana dashboards incl. cost-per-video, alerts), staging E2E.

### Phase 3 — Public Launch (scale + agencies + polish)
- Agency tier: many channels, pooled credits, outbound webhooks, SSO, audit export, MFA.
- Scaling: heavy/light worker pool separation (render fleet sized separately), read replicas, provider load-balancing, quota-aware scheduling.
- Cost/margin dashboards, advanced budgeting/overage; admin console v2 (trust & safety full, billing ops, compliance rule-set management).
- Full DR (backups, restore drills, runbooks).
- Marketing site, onboarding, docs, support tooling.
- Performance + security hardening pass; penetration test.

---

## 2. Folder Structure (owner)

```
creatorforce-ai/
├── claude.md
├── docs/                      # all design docs (00_MASTER_CONTEXT.md is the index)
├── apps/
│   ├── web/                   # Next.js (App Router)
│   │   ├── app/               # routes (server components by default)
│   │   ├── components/        # UI (shadcn-based) incl. editor/ (timeline, inspector, preview)
│   │   ├── lib/               # api client, hooks, ws
│   │   └── ...
│   └── api/                   # NestJS
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/  channels/  projects/  jobs/
│       │   │   ├── trend/  seo/  audience/
│       │   │   ├── content/        # script, research, factcheck
│       │   │   ├── compliance/
│       │   │   ├── music/  video/  voice/  image/   # media engines
│       │   │   ├── subtitles/  editor/  render/     # editor + render (render = worker-heavy)
│       │   │   ├── thumbnail/  metadata/  publishing/
│       │   │   ├── analytics/  billing/
│       │   │   └── admin/          # internal back-office (separate guard chain)
│       │   ├── workers/            # BullMQ processors (incl. render fleet entrypoint)
│       │   ├── common/             # guards, pipes, filters, interceptors
│       │   └── main.ts
│       └── ...
├── packages/
│   ├── agents/                # Supervisor + sub-agents (+ per-agent context builders)
│   ├── shared/                # types, Zod schemas, ai client (llm + media registries), editor-catalog
│   ├── prompts/               # versioned prompt templates
│   └── config/                # eslint/tsconfig/tailwind presets
├── infra/
│   ├── docker/                # Dockerfiles (web, api, worker, render-worker, n8n)
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

Source of truth: Prisma schema in `infra/db`. Entities and rules in `docs/database.md` (users, teams, channels, projects, scripts, research_packs, factcheck_results, compliance_reports, assets, **asset_versions**, **timelines**, **renders**, metadata_drafts, publish_records, jobs, analytics_snapshots, **memory_embeddings**, subscriptions, usage_records, prompt_versions, audit_logs). Key safety rules: no `publish_record` without `compliancePassed && humanApproved && bundleHash match`; no generation/render on a non-passed project; provenance write-once.

---

## 4. API Design

Full surface in `docs/api.md`. MVP implements: auth, channels, trends, seo, audience, content, compliance, metadata, publish, projects, jobs, billing, realtime. Beta adds voice, images, music, video, subtitles, editor/timeline, render, thumbnails, analytics, growth, teams, admin. All endpoints Zod-validated; long ops return `202 + jobId`.

---

## 5. Deployment Architecture

See `docs/deployment.md`. MVP: Cloudflare + AWS (Fargate), managed Postgres/Redis, R2, GitHub Actions CI/CD, Sentry. Beta adds the **render worker fleet** (CPU-optimized, scaled on `render` queue depth, isolated from light queues), Prometheus/Grafana. Launch adds read replicas, DR.

---

## 6. Testing Strategy

See `docs/testing.md`. Required: unit tests for agents/services, integration tests for pipelines (esp. compliance gate), routing simulation tests, editor-catalog render fixtures, E2E for the publish flow. Tests must prove: the compliance gate cannot be bypassed; renders/generation refuse pre-pass; budget refusal spends nothing.

---

## 7. CI/CD Pipeline

See `docs/deployment.md` §4. PR: lint → typecheck → unit → build → integration → security scans. Merge: image build/scan → staging migrate/deploy → E2E. Release: prod migrate → deploy (blue/green) → smoke. Migrations gated and backward-compatible. Prompt-version promotions gated by evals (`prompts.md` §7).

---

## 8. Cost Estimation

See `docs/monetization-framework.md` (Part A/C), `docs/token-optimization.md`, and `docs/deployment.md` §9. Headline metric: **cost per published video**. Levers: routing/model tiering, caching + incremental regeneration, proxy-first rendering, creator-initiated final renders, plan budgets, autoscaled batched workers.

---

## 9. Scaling Strategy

See `docs/architecture.md` §6 and `docs/deployment.md` §6. Stateless web/api autoscale; workers scale by queue depth with heavy (render, video-gen) / light (research, seo) pool separation; DB read replicas + pooling; Redis cluster as needed; provider fallback + quota-aware scheduling.

---

## 10. Security Strategy

See `docs/security.md` and `docs/admin.md`. Non-negotiables: secrets in secret manager, OAuth tokens encrypted at rest, RBAC + tenant scoping, Zod validation, prompt-injection defenses, webhook signature verification, no compliance bypass (including via admin), provenance immutability.

---

## 11. Build Order (suggested first sprints)

1. Monorepo scaffold (pnpm + turbo), config packages, `.env.example`, docker-compose.
2. Prisma schema + migrations + seed (incl. pgvector, asset_versions groundwork); Postgres/Redis/R2 wiring.
3. **AI Client + routing v1** (registry, task classes, floors, fallback, metering, tracing) + Zod shared schemas + context-builder pattern.
4. Auth + YouTube channel connect (OAuth, encrypted tokens).
5. Agent runtime + Supervisor + Script/Research/FactCheck agents (streaming output).
6. **Compliance engine + gate + tests proving no bypass.**
7. Metadata + Publishing (YouTube Data API) with precondition gate + idempotency.
8. Frontend: dashboard, project/approval/job centers, script editor.
9. Stripe (Free/Creator) + budget reservation/enforcement.
10. Observability baseline + CI/CD to staging.

**Beta sprint seed order:** 11. asset_versions + media queues + VoiceAgent/TTS → 12. ImageAgent + images → 13. editor-catalog + timeline schema + EditPlanAgent → 14. editor UI (drag/drop, undo/redo, autosave) → 15. SubtitleAgent → 16. Render worker + WF-8 (+ fixtures) → 17. music/video generation → 18. analytics loop + memory → 19. full routing matrix + admin v1 → 20. teams/RBAC + n8n WF-1.

---

## 12. Definition of Done (per feature)

Strict TS compiles, tests pass, lint clean, docs updated, secrets externalized, traces/metrics emitted, and—if it touches the content pipeline—compliance gating intact and test-verified. (Mirrors `claude.md` §8.)
