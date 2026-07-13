# project-checklist.md — AI CreatorForce

> Consolidated readiness roll-up per `docs4/48_Project_Checklist.md`: every
> spec's acceptance criteria with live status and evidence. Companion to
> [risk-register.md](risk-register.md) — blocked items reference its rows.
> Update on every wave that closes or regresses a criterion.
> Last updated: 2026-07-14 (Wave 34).

**Legend** — ✅ done · ◐ partial (gap noted) · ⛔ blocked (external/infra; see risk register) · ▫ deferred by design

## P0 completeness (Master PRD / plan Phases 0–1)

All Phase 0 and Phase 1 exit criteria are ✅: multi-method auth with linking and
revocable sessions; resumable channel sync; virtualized 10k+ library; full AI
workflow with estimate→accept→run, versioning, and approval gates; Edit +
Shorts Studios; YouTube publish; analytics loop; CI gates green (480 API unit
tests, Playwright e2e, Semgrep, bundle budget). Phase 2 is ✅ except the two ◐
items under specs 13/42. Phase 3 (teams-at-scale, multi-platform) is ▫ future.

## Per-spec status

### 00 Master PRD
- ✅ Connect channel → background sync (channels module, `CHANNEL_SYNC` job, e2e)
- ✅ Workspace auto-loads; ✅ full workflow, every stage editable (`overrideResult`)
- ✅ Paid actions show model/credits/time/cost + acceptance; ✅ versioned/revertible
- ✅ Publish to YouTube + analytics in workspace; ✅ P0 automated tests in CI

### 01 Product Vision
- ✅ Features map to principles (docs/project.md); ✅ no anti-goal violations
- ✅ North-star metric designated: hero tile "published videos per active channel (30d)" on the admin BI dashboard (`bi.service.enterpriseMetrics` northStar field + `northStarRate` unit tests, Wave 24)

### 02 System Architecture
- ✅ channel_id on domain tables; ✅ expensive ops via queue; ✅ estimate/accept/run
- ✅ Resumable sync; ✅ correlation IDs gateway→service→worker (`correlation.context.ts`)

### 03 Database Architecture
- ✅ channel-first indexes; ✅ immutable versions (write-once AgentJob/AssetVersion)
- ✅ Balance reconciles from ledger (wallet.service tests); ✅ expand/contract migrations (31 applied)
- ✅ Cursor pagination everywhere: shared keyset util (`common/pagination/cursor.ts` + spec); projects, approvals (pending/history), assets, notifications, admin audit-logs/DLQ, and dev-API project lists all cursor-paginated (Wave 25). Intentional top-N queries (top models, recent jobs, latest versions) are not pagination and keep `take`.

### 04 Channel Workspace / 08 Playlists & Library
- ✅ Shell within budget; ✅ virtual+infinite scroll (virtualization e2e)
- ✅ Channel-scoped URL-reflected filters; ✅ sync streams into view; ✅ no re-sync duplicates; ✅ reorder persists

### 05 AI Workflow / 33 Agent Architecture
- ✅ Editable versioned artifacts per stage; ✅ selective downstream regeneration
- ✅ Revert-not-overwrite; ✅ enter/exit at any stage; ✅ approval gates before publish
- ✅ Structured schema-validated agent output; ✅ input/instruction isolation

### 06 Edit Studio / 07 Shorts Studio
- ✅ Non-destructive modes, multi-track timeline, versions + comparison + revert, undo/redo
- ✅ Section-scoped regeneration; ✅ estimates on AI edits
- ✅ Shorts: from-scratch + from-video, overridable highlights, safe zones/hook/captions, 9:16 + duration enforcement

### 09 Asset Management
- ✅ Channel-scoped, version-traceable assets; ✅ upload validation (validation engine)
- ✅ Brand Kit editable + consumed by stages
- ✅ Unreferenced-asset GC: daily two-stage sweep (mark soft-deleted → purge past grace, FK + timeline-JSON reference checks, audit-logged; `asset-gc.job.ts`, Wave 22)
- ✅ Signed media URLs: HMAC-SHA256 expiring capability URLs (`GET .../signed-url` behind JWT+ownership → `?exp=&sig=` accepted by file routes, 15-min default TTL, constant-time verify; `signed-url.util` + 13 unit tests, Wave 34). ◐ Serving through an actual CDN still needs a CDN target (local-first)

### 10 AI Credits
- ✅ All five criteria: transparency+acceptance, ledger reconciliation, reserve/settle/refund (incl. Wave 17 reaper release), budget alerts + hard-cap, dashboard with history/forecast/recommendations

### 11 AI Models
- ✅ Capability interfaces only; ✅ catalog-driven (AiProvider/ProviderCostRate/PricingRule)
- ✅ Model recorded on versions + ledger; ✅ retry/fallback + refund on exhaustion; ✅ config-only model addition

### 12 Background Jobs / 34 Workers / 35 Queues
- ✅ All long work jobbed (202 + job id, Wave 13); ✅ cursor resume; ✅ retry/backoff + cancel
- ✅ Credits reserve/settle/refund; ✅ progress + events observable (WS + AgentLog)
- ✅ Reaper (Wave 17); ✅ idempotent processing (Idempotency-Key, Wave 17)
- ✅ DLQ replay tooling: `GET /admin/jobs/failed` + `POST /admin/jobs/:id/replay` (audit-logged, `admin:jobs` permission, Wave 21)
- ⛔ Autoscaling on queue depth — single-instance local (risk R-08 posture)

### 13 Performance / 44 Performance Budget
- ✅ No blocking >1s in request path; ✅ budgets defined + CI-enforced (bundle gate, docs4/44)
- ✅ p75 workspace ≤2.0s load-verified on production builds via `scripts/load-verify-workspace.mjs`: p75 1198ms @ 10k videos, 1132ms @ 100k videos (n=20 cold loads each, 2026-07-14, Wave 32). ◐ Long-video (4–8h) pipeline load test still needs real source media (risk R-11)
- ✅ Budget trend tracking: every run writes `bundle-budget-report.json` (uploaded as CI artifact, 90d), diffed against committed `scripts/bundle-budget-baseline.json` with >10% growth WARNs; budget stays the hard gate (Wave 26)

### 14 Security
- ✅ OWASP controls + Semgrep custom rules (`.semgrep/creatorforce.yml`); ✅ prompt-injection isolation
- ✅ Secrets out of DB/logs (envelope encryption; Wave 15 redaction); ✅ audit log; ✅ RBAC (rbac.spec)

### 15 Authentication
- ✅ All six criteria: Email+Google+Apple+Facebook (provider registry `auth/providers/`), safe linking, adapter-only extension, rotating revocable sessions with reuse detection (sessions e2e), separate channel OAuth, PKCE/state/nonce

### 16 API Architecture / 32 Error Handling
- ✅ Channel-scoped + authorized; ✅ boundary contracts (zod); ✅ estimate/accept/run; ✅ 202 + job id (Wave 13)
- ✅ Envelope everywhere with correlation id; ✅ refund + last-good-version; ✅ no sensitive leakage; ✅ actionable outage copy (Wave 19)

### 17 UI/UX / 18 Components / 19 Design System
- ✅ Auto-load/scroll/focus; ✅ estimates before paid actions; ✅ responsive; ✅ shared components, injected data, virtualized lists
- ✅ Tokens in tailwind config; no hard-coded values (lint)
- ◐ WCAG 2.2 AA: jsx-a11y error gate + axe-core e2e gate over 8 core surfaces incl. color-contrast, all passing (Wave 23); manual screen-reader passes outstanding
- ✅ Theming via token overrides (docs4/19): brand palette lives as CSS variables in globals.css consumed by tailwind with alpha support; `[data-theme]` scope rethemes app-wide (ocean example theme + e2e retheme test); default theme verified pixel-identical via visual snapshots (Wave 33)

### 20 Observability / 28 Prometheus-Grafana / 39 Monitoring
- ✅ Correlation end-to-end; ✅ /metrics + dashboards (infra/monitoring); ✅ SLO alerts + runbooks (docs); ✅ no secrets/PII in telemetry; ✅ health checks (Wave 13); ✅ cardinality controlled
- ◐ Escalation: single-operator; no paging rotation

### 21 Testing / 22 Playwright
- ✅ Unit (480) + integration + e2e layers in CI; ✅ critical-flow e2e; ✅ a11y + security gates
- ✅ Coverage threshold pinned to measured baseline minus ~2pts (stmts 15 / lines 14 / fns 12 / branches 13; measured 17.08/16.47/14.82/15.68 on 2026-07-13) — regressions now fail CI (Wave 27)
- ✅ Playwright: a11y assertions (axe, Wave 23); traces/screenshots on failure; visual snapshots on login/register/projects (Wave 28); firefox/webkit projects gated behind CI/CROSS_BROWSER with per-browser CI matrix sharding (Wave 31; smoke-verified locally on all three browsers)

### 23 ZAP / 24 Burp / 25 Snyk / 26 Dependabot / 27 Semgrep
- ⛔ ZAP, Burp, Snyk — external accounts/licenses (risk R-10); `pnpm audit --audit-level=high` gates as interim SCA
- ✅ Dependabot (`.github/dependabot.yml`); ✅ Semgrep on every PR with custom architecture rules, high findings gate

### 29 CI/CD / 30 Deployment / 45 Release
- ✅ Gated pipeline (lint, typecheck, tests+coverage, build+bundle budget, audit, Semgrep, e2e); ✅ zero-downtime DB changes (expand/contract)
- ⛔ Progressive deploy/rollback, IaC environments, autoscaling — no hosted target (local-first)
- ✅ Feature flags: SystemConfig-backed FlagsService (env `FEATURE_FLAGS` override > DB > default, 30s cache) + audit-logged `/admin/flags` surface behind `admin:flags` permission (Wave 29). ✅ Automated changelogs: `pnpm changelog` regenerates CHANGELOG.md from conventional commits (Wave 30)

### 31 Coding Standards
- ✅ Lint/format/type gates; ✅ architecture invariants via Semgrep; ✅ documented public APIs (Swagger + dev-docs); ✅ dedup enforced in review

### 36 Caching / 37 State Management
- ✅ Read-through hot caches (analysis cache Wave 9, intent cache); ✅ event-driven invalidation; ✅ channel-scoped keys; ✅ no stale/sensitive leakage
- ✅ URL filters; ✅ channel-switch state preservation; ✅ operation-based undo/redo; ✅ optimistic reconcile

### 38 Logging
- ✅ Structured JSON + correlation id + redaction (Wave 15); ✅ AI actions fully logged (AgentLog/TokenUsage)
- ⛔ Central aggregation + retention tiers — infra-blocked (risk R-04, app side done)

### 40 Backup & Recovery / 41 Disaster Recovery
- ✅ Automated daily dumps + monitoring; ✅ DR runbooks; ✅ degradation modes (fail-closed adapter chains)
- ⛔ PITR (risk R-05), restore drills to RPO/RTO, failover drills, game days — infra-blocked locally
- ✅ Deletion lifecycle: soft-delete → grace → purge enforced by scheduled GC (Wave 22)

### 42 Accessibility
- ✅ jsx-a11y error-severity gate; keyboard flows on core surfaces
- ✅ Automated contrast + ARIA checks: axe-core (WCAG 2.2 AA tags) gates 8 surfaces in e2e; all serious/critical violations fixed (Wave 23)
- ◐ Manual screen-reader passes and editor-control audit

### 43 Internationalization
- ▫ Deferred until a second locale is committed (risk R-09); ✅ multi-language AI content

### 46 Roadmap / 47 Risk Register / 49 Rules / 50 Plan
- ✅ Phases with exit criteria; ✅ living risk register (Wave 13→19, R-C1…R-C8 closed); ✅ rules followed per wave
- ✅ Plan Phases 0–2 delivered in dependency order; ▫ Phase 3 future

### 48 Project Checklist (this document)
- ✅ All spec checklists rolled up · ✅ P0 completeness visible · ✅ Mapped to acceptance criteria · ✅ Updated per release (wave)

## Gap summary (what would move ◐/⛔ → ✅)

| Gap | Needs |
|---|---|
| Long-video pipeline load test (13) | Real 4–8 h test video (R-11); workspace p75 verified in Wave 32 |
| External scanners (23/24/25) | ZAP/Burp/Snyk accounts (R-10) |
| Hosted-deploy items (29/30/38/40/41/45) | A hosting target: aggregation, PITR, progressive delivery, DR drills |
| i18n (43) | Second-locale commitment (R-09) |
