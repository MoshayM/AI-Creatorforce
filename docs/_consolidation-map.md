# docs/_consolidation-map.md — Consolidation Map

This file records the source-to-target mapping for the June 2026 documentation consolidation. Every `.md` found across `docs/`, `docs/docs1/`, `docs2/`, `docs3/`, and `docs4/` is listed with the target doc that absorbed its relevant content (or the reason it was dropped). The 19 target filenames match exactly what `CLAUDE.md` references.

---

## Source → Target Mapping

### docs/ (pre-consolidation originals — overwritten in place)

| Source file | Gist | Target doc |
|---|---|---|
| `docs/project.md` | Platform overview + 7 golden rules | `docs/project.md` (rewritten) |
| `docs/architecture.md` | Modular monolith, async job backbone | `docs/architecture.md` (rewritten) |
| `docs/agents.md` | Supervised multi-agent design | `docs/agents.md` (rewritten) |
| `docs/workflows.md` | Content + Shorts pipelines | `docs/workflows.md` (rewritten) |
| `docs/features.md` | Feature spec by Core Engine | `docs/features.md` (rewritten) |
| `docs/api.md` | REST API surface | `docs/api.md` (rewritten) |
| `docs/techstack.md` | Tech + library choices | `docs/techstack.md` (rewritten) |
| `docs/database.md` | Prisma schema / DB conventions | `docs/database.md` (rewritten) |
| `docs/security.md` | Auth, RBAC, headers, SAST/DAST | `docs/security.md` (rewritten) |
| `docs/compliance.md` | Compliance gate, categories, invariants | `docs/compliance.md` (rewritten) |
| `docs/monetization-framework.md` | Platform + creator monetization | `docs/monetization-framework.md` (rewritten) |
| `docs/youtube-publishing.md` | YouTube OAuth + publish preconditions | `docs/youtube-publishing.md` (rewritten) |
| `docs/analytics.md` | Analytics agents, snapshots, BI | `docs/analytics.md` (rewritten) |
| `docs/deployment.md` | CI/CD, environments, env vars | `docs/deployment.md` (rewritten) |
| `docs/build.md` | What's built vs. planned | `docs/build.md` (rewritten) |
| `docs/roadmap.md` | Strategic phases + vision | `docs/roadmap.md` (rewritten) |
| `docs/testing.md` | Test strategy, Jest, Playwright, SAST/DAST | `docs/testing.md` (rewritten) |
| `docs/uiux.md` | UI/UX design, component stack | `docs/uiux.md` (rewritten) |
| `docs/prompts.md` | Prompt versioning + engineering rules | `docs/prompts.md` (rewritten) |
| `docs/audit-placeholders.md` | Old audit task checklist | dropped: superseded by actual Semgrep + ZAP implementation in security.md / testing.md |
| `docs/billing-security.md` | Implementation plan for billing + security (docs2 wave) | merged into: `docs/monetization-framework.md` + `docs/security.md` |
| `docs/growth-enterprise.md` | Implementation plan for orgs + growth (docs3 wave) | merged into: `docs/features.md` + `docs/roadmap.md` |
| `docs/video-hub.md` | Implementation plan for Shorts Studio / video hub (ai.md wave) | merged into: `docs/features.md` + `docs/workflows.md` |
| `docs/project-checklist.md` | Phase-by-phase completion checklist | dropped: historical progress tracking; current state covered by `docs/build.md` |
| `docs/risk-register.md` | Risk register with mitigations | dropped: point-in-time risk snapshot; key mitigations absorbed into `docs/security.md` + `docs/compliance.md` |

---

### docs/docs1/ (Wave 1 spec set — stored inside docs/)

| Source file | Gist | Target doc |
|---|---|---|
| `docs/docs1/00_MASTER_CONTEXT.md` | Index/orientation doc routing to owner docs | dropped: replaced by CLAUDE.md §3–4 and the consolidated docs/ |
| `docs/docs1/README.md` | docs1 folder readme | dropped: folder context only |
| `docs/docs1/admin.md` | Admin console, feature flags, prompt ops, abuse monitoring | merged into: `docs/features.md` (Admin section), `docs/security.md` (audit log), `docs/api.md` (admin endpoints) |
| `docs/docs1/agents.md` | Agent model, agent catalogue | merged into: `docs/agents.md` |
| `docs/docs1/api.md` | API surface spec | merged into: `docs/api.md` |
| `docs/docs1/build.md` | Build phases (MVP/Beta/Launch) | merged into: `docs/build.md` + `docs/roadmap.md` |
| `docs/docs1/database.md` | DB schema spec | merged into: `docs/database.md` |
| `docs/docs1/features.md` | Feature list by engine | merged into: `docs/features.md` |
| `docs/docs1/media-pipeline.md` | Voice/image/music/video render pipeline | merged into: `docs/features.md` (Media Pipeline section) + `docs/workflows.md` |
| `docs/docs1/model-routing.md` | AI provider routing policy, multi-provider fallback | merged into: `docs/agents.md` (AI Client section) + `docs/techstack.md` (AI providers); planned providers flagged as not yet implemented |
| `docs/docs1/token-optimization.md` | Context compression, caching, cost efficiency | merged into: `docs/agents.md` (AI Client / caching section) + `docs/prompts.md` (token discipline) |
| `docs/docs1/video-editor.md` | Timeline data model, EditPlanAgent, render | merged into: `docs/features.md` (Media Pipeline / Timeline) + `docs/database.md` (Timeline/Render models) |
| `docs/docs1/workflows.md` | Pipeline workflows | merged into: `docs/workflows.md` |

---

### docs2/ (Billing+Security and Deployment specs)

| Source file | Gist | Target doc |
|---|---|---|
| `docs2/AI-CreatorForce-Billing-Payment-Security-Spec.md` | Full billing system spec (v1.1): wallet, ledger, Stripe, fraud, auth security | merged into: `docs/monetization-framework.md` + `docs/security.md` |
| `docs2/Platform-Deployment-Domain-Spec.md` | Deployment, domain, cross-platform packaging spec | merged into: `docs/deployment.md` + `docs/techstack.md` |

---

### docs3/ (Phase 5 + Phase 6 specs)

| Source file | Gist | Target doc |
|---|---|---|
| `docs3/Phase5-Enterprise-Extensions-Spec.md` | Orgs/teams, org billing, BudgetPeriod, org shared wallet | merged into: `docs/features.md` (Organizations section) + `docs/database.md` (Org models) + `docs/monetization-framework.md` (org billing) |
| `docs3/Phase6-Trial-Growth-Engine-Spec.md` | Free trial, referral program, upgrade engine, marketplace, credit economy | merged into: `docs/features.md` (Trial & Growth section) + `docs/monetization-framework.md` (trial/referral/marketplace) |

---

### docs4/ (51-file detailed spec set)

| Source file | Gist | Target doc |
|---|---|---|
| `docs4/00_Master_PRD.md` | Master PRD index | merged into: `docs/project.md` + `docs/features.md` |
| `docs4/01_Product_Vision.md` | Product vision and mission | merged into: `docs/project.md` + `docs/roadmap.md` |
| `docs4/02_System_Architecture.md` | System architecture spec | merged into: `docs/architecture.md` |
| `docs4/03_Database_Architecture.md` | Database schema + conventions spec | merged into: `docs/database.md` |
| `docs4/04_Channel_Workspace.md` | Channel workspace feature spec | merged into: `docs/features.md` (Channel Workspace) |
| `docs4/05_AI_Workflow.md` | AI workflow / content pipeline spec | merged into: `docs/workflows.md` + `docs/agents.md` |
| `docs4/06_Edit_Studio.md` | Edit Studio / video editor spec | merged into: `docs/features.md` (Media Pipeline/Timeline) + `docs/workflows.md` |
| `docs4/07_Shorts_Studio.md` | Shorts Studio feature spec (channel-first, library picker) | merged into: `docs/features.md` (Shorts Studio) + `docs/workflows.md` (Shorts pipeline) |
| `docs4/08_Playlists_and_Library.md` | Playlists + library management spec | merged into: `docs/features.md` (Channel Workspace / Library) + `docs/database.md` (LibraryVideo/LibraryPlaylist) |
| `docs4/09_Asset_Management.md` | Asset/AssetVersion versioning spec | merged into: `docs/features.md` (Media Pipeline / Assets) + `docs/database.md` (Asset models) |
| `docs4/10_AI_Credits.md` | Credit system spec (ledger, lots, reserve-settle) | merged into: `docs/monetization-framework.md` |
| `docs4/11_AI_Models.md` | AI provider routing and model selection | merged into: `docs/agents.md` (AI Client section) + `docs/techstack.md`; planned providers noted as not yet implemented |
| `docs4/12_Background_Jobs.md` | BullMQ job queue architecture | merged into: `docs/architecture.md` (job pipeline) + `docs/workflows.md` |
| `docs4/13_Performance.md` | Performance budget + optimization | merged into: `docs/deployment.md` (bundle budget gate) + `docs/uiux.md` (TanStack Virtual, Server Components) |
| `docs4/14_Security.md` | Security spec (headers, RBAC, secrets) | merged into: `docs/security.md` |
| `docs4/15_Authentication.md` | Auth flows (email, OAuth, sessions, JWT) | merged into: `docs/security.md` (Authentication section) |
| `docs4/16_API_Architecture.md` | API conventions, versioning, error formats | merged into: `docs/api.md` |
| `docs4/17_Frontend_UI_UX.md` | Frontend architecture + UX spec | merged into: `docs/uiux.md` + `docs/architecture.md` (frontend section) |
| `docs4/18_Component_Guidelines.md` | React component guidelines | merged into: `docs/uiux.md` |
| `docs4/19_Design_System.md` | Design tokens, Radix + Tailwind system | merged into: `docs/uiux.md` |
| `docs4/20_Observability.md` | Prometheus, Grafana, Sentry, structured logging | merged into: `docs/deployment.md` (Observability section) + `docs/architecture.md` |
| `docs4/21_Testing_Strategy.md` | Overall testing strategy | merged into: `docs/testing.md` |
| `docs4/22_Playwright_Testing.md` | Playwright E2E specifics | merged into: `docs/testing.md` (E2E section) |
| `docs4/23_OWASP_ZAP.md` | OWASP ZAP DAST setup | merged into: `docs/testing.md` + `docs/security.md` |
| `docs4/24_BurpSuite.md` | BurpSuite active scan spec | dropped: not implemented in CI — pnpm audit + ZAP used instead; noted as planned in security.md |
| `docs4/25_Snyk.md` | Snyk dependency monitoring spec | dropped: not implemented — pnpm audit + dependency-review-action used instead; noted in security.md |
| `docs4/26_Dependabot.md` | Dependabot auto-update config | merged into: `docs/security.md` (Dependency security section) |
| `docs4/27_Semgrep.md` | Semgrep SAST rules and CI integration | merged into: `docs/security.md` + `docs/testing.md` |
| `docs4/28_Prometheus_Grafana.md` | Prometheus/Grafana observability stack | merged into: `docs/deployment.md` (Observability section) + `docs/analytics.md` |
| `docs4/29_CI_CD.md` | CI/CD pipeline spec | merged into: `docs/deployment.md` |
| `docs4/30_Deployment.md` | Deployment targets and environments | merged into: `docs/deployment.md` |
| `docs4/31_Coding_Standards.md` | TypeScript conventions, naming, patterns | merged into: `docs/techstack.md` (Coding standards section) |
| `docs4/32_Error_Handling.md` | Typed domain errors, Sentry, error filter | merged into: `docs/architecture.md` (Errors section) + `docs/api.md` (error format) |
| `docs4/33_AI_Agent_Architecture.md` | Agent framework, BaseAgent, AIClient | merged into: `docs/agents.md` |
| `docs4/34_Background_Workers.md` | SupervisorWorker, worker modules | merged into: `docs/architecture.md` (job pipeline) + `docs/workflows.md` |
| `docs4/35_Queues.md` | BullMQ queue configuration | merged into: `docs/architecture.md` |
| `docs4/36_Caching.md` | Redis caching, AI response cache | merged into: `docs/architecture.md` + `docs/agents.md` (AICacheAdapter) |
| `docs4/37_State_Management.md` | TanStack Query, client state | merged into: `docs/uiux.md` |
| `docs4/38_Logging.md` | Structured logging, StructuredLogger | merged into: `docs/architecture.md` (Observability section) |
| `docs4/39_Monitoring.md` | Runtime monitoring, alerts | merged into: `docs/deployment.md` (Observability section) |
| `docs4/40_Backup_Recovery.md` | DB backup and recovery spec | dropped: not yet implemented; noted as planned in deployment.md |
| `docs4/41_Disaster_Recovery.md` | DR plan spec | dropped: not yet implemented; noted as planned in deployment.md |
| `docs4/42_Accessibility.md` | a11y guidelines and tooling | merged into: `docs/uiux.md` (Accessibility section) + `docs/testing.md` (a11y.spec.ts) |
| `docs4/43_Internationalization.md` | i18n spec | dropped: not yet implemented (Project.targetLang field exists but UI i18n not built); noted as planned in build.md |
| `docs4/44_Performance_Budget.md` | Bundle size budget, check-bundle-budget.mjs | merged into: `docs/deployment.md` (Bundle budget section) + `docs/uiux.md` |
| `docs4/45_Release_Process.md` | Release and tagging process | merged into: `docs/deployment.md` (CI pipeline section) |
| `docs4/46_Roadmap.md` | Product roadmap phases | merged into: `docs/roadmap.md` |
| `docs4/47_Risk_Register.md` | Risk register with mitigations | dropped: point-in-time snapshot; key architectural risks reflected in security.md + build.md planned/not-implemented sections |
| `docs4/48_Project_Checklist.md` | Per-phase completion checklist | dropped: historical tracking; current state in build.md |
| `docs4/49_CLAUDE_RULES.md` | Claude agent rules (mirrors CLAUDE.md) | dropped: content belongs in CLAUDE.md (not edited); no duplication in docs/ |
| `docs4/50_IMPLEMENTATION_PLAN.md` | Wave-by-wave implementation plan | dropped: historical execution tracking; outcomes reflected in build.md |

---

## Contradictions Found: Old Docs vs. Built App

The following are meaningful discrepancies found during consolidation where old docs described something as implemented that the code tells a different story:

1. **SupervisorAgent as independent agent** — docs1/docs4 describe `SupervisorAgent` as a running agent that receives goals and decomposes them. The built system uses `SupervisorWorker` (apps/api/src/workers/supervisor.worker.ts) which dispatches directly based on `JobType` — no independent LLM-orchestrating supervisor agent exists yet. Flagged as "planned/not yet implemented" in agents.md.

2. **Multi-provider AI routing (DeepSeek, Grok, Mistral, Ollama, OpenRouter)** — docs1/model-routing.md and docs4/11_AI_Models.md describe routing across 8+ providers. The actual `packages/shared/src/ai/index.ts` supports only `anthropic | openai | gemini`. Other providers are not implemented. Flagged as planned in techstack.md and agents.md.

3. **n8n workflow runtime** — Multiple docs describe n8n as an active component handling long-running automations. The `n8n/` folder exists for exported workflow definitions but no runtime is deployed. Flagged as planned in deployment.md, workflows.md, and architecture.md.

4. **In-app video generation** — docs4/06_Edit_Studio.md and docs4/09_Asset_Management.md describe end-to-end video generation via Veo/Kling/Runway/Pika. `PublishingService.publish()` contains the comment: "In-app video generation is a Phase 2 feature." `videoFilePath` must be supplied externally. Flagged in youtube-publishing.md and build.md.

5. **Cloudflare R2 storage** — Docs describe R2 as the asset storage backend. `AssetVersion.r2Key` field exists in schema. The actual R2 SDK integration is not wired in the codebase (no `@cloudflare/r2` or AWS S3 SDK present in package.json). Flagged as planned in techstack.md and database.md.

6. **BurpSuite and Snyk** — docs4/24_BurpSuite.md and docs4/25_Snyk.md are full specification documents. Neither tool appears in the CI workflow. CI uses `pnpm audit` + `dependency-review-action` (not Snyk) and ZAP (not BurpSuite active scan). Both dropped and noted as planned in security.md.

7. **Prompt library completeness** — docs4/49_CLAUDE_RULES.md and prompts.md imply all agent prompts are in `packages/prompts`. In reality, `packages/prompts/src/` contains only `index.ts` and `templates/compliance.ts`. Most agent system prompts are inline in their agent files. Flagged in prompts.md.

8. **Database backup / DR** — docs4/40_Backup_Recovery.md and docs4/41_Disaster_Recovery.md are full specification documents. No backup tooling or DR scripts exist in `infra/`. The infra folder contains only `monitoring/`. Dropped; noted as planned in deployment.md.
