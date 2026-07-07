# AI CreatorForce — Phase 5: Enterprise Platform Extensions
## Implementation-Ready Specification (v1.0)

> **Extends, does not redesign.** This document builds on the already-implemented base (`AI-CreatorForce-Billing-Payment-Security-Spec.md` and `Platform-Deployment-Domain-Spec.md`). Anything already covered there is referenced, not repeated.
>
> **Already implemented — reused as-is:** Wallet, Credit Ledger, Credit Lots, Credit Expiry, Recharge, Stripe/gateway payments + Apple/Google IAP, Refunds, Reconciliation, Dispute Freeze, Settlement Recovery, RBAC, Audit Logs, Billing Jobs, Token Tracking, base Security (encryption/secrets/2FA/sessions/fraud), base Subscriptions, Super Admin dashboard shell.
>
> **New in Phase 5 (this document):** AI Provider Management, AI Smart Routing Engine, Dynamic Credit Pricing, Profit Protection Engine, Organization & Team Billing, Enterprise/BI Analytics & Forecasting, Developer Portal, Disaster Recovery & Monitoring, Scalability hardening.
>
> Offer/Promotion Engine, Referral, and Trial systems live in the **Phase 6** document — cross-referenced where relevant, not duplicated here.

---

## 1. Executive Summary

Phase 5 turns the working billing core into a self-optimizing, enterprise-ready platform. It adds the intelligence that decides **which AI provider to use** (routing), **what to charge** (dynamic pricing), and **whether a sale is profitable** (profit protection), plus the structures enterprises need — **organizations, teams, shared wallets, and budgets** — and the tools that make the platform sellable and operable at scale: a **developer portal**, **business-intelligence forecasting**, and **disaster-recovery/monitoring**.

Design principles carry over: ledger-first, idempotent, least-privilege, fail-closed, and now **profit-aware by default** — no credit is ever priced or discounted without the profit engine confirming margin.

---

## 2. Architecture Additions

```
                 ┌──────────────────────────────┐
                 │        Existing Core            │
                 │ Wallet · Ledger · Payments      │
                 │ RBAC · Audit · Billing Jobs      │
                 └───────────────┬────────────────┘
                                 │ (unchanged interfaces)
     ┌───────────────────────────┼───────────────────────────┐
     ▼                           ▼                             ▼
┌──────────────┐        ┌────────────────┐          ┌──────────────────┐
│ Pricing Engine │◄──────│ Profit Protection│◄────────│ AI Routing Engine  │
│ (credit cost)  │       │ (margin guard)   │          │ (provider select)  │
└──────┬────────┘        └───────┬─────────┘          └────────┬─────────┘
       │                          │                             │
       ▼                          ▼                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    AI Provider Management Service                        │
│  health · latency · cost · quality score · failover · rate limits        │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────┐   ┌──────────────────┐   ┌──────────────┐   ┌───────────────┐
│ Org/Team Svc  │   │ BI/Forecast Svc    │   │ Developer     │   │ Monitoring /   │
│ shared wallet │   │ (analytics + ML)   │   │ Portal Svc    │   │ DR subsystem   │
└──────────────┘   └──────────────────┘   └──────────────┘   └───────────────┘
```

All new services consume the existing Wallet/Ledger/Payment services through their published interfaces. **No existing table is altered destructively** — Phase 5 only adds new tables and additive, nullable columns.

---

## 3. Folder Structure (additions only)

```
/apps
  /ai-provider-service      # provider registry, health, failover
  /routing-service          # smart model/provider selection
  /pricing-service          # dynamic credit pricing rules
  /profit-service           # margin calculation & guard
  /org-service              # organizations, teams, shared wallets, budgets
  /bi-service               # analytics aggregation + forecasting
  /developer-portal-service # API keys, webhooks, sandbox, docs
/packages
  /shared-pricing-types
  /shared-provider-adapters # per-provider cost + capability metadata
/infra
  /monitoring               # dashboards, alerts, SLOs
  /dr                       # backup, replication, failover runbooks
```

---

## 4. Database Schema (new tables only)

Monetary values in integer minor units; costs stored per-unit at high precision (store as integer micro-credits or numeric(18,6) — never float).

### 4.1 `ai_providers`
`id, name(enum: openai, anthropic, gemini, openrouter, deepseek, mistral, xai, replicate, runway, fal, elevenlabs, aws, azure_openai, custom), status(active/degraded/disabled), priority(int), region, quality_score(numeric), failure_rate(numeric), avg_latency_ms(int), rate_limit_rpm(int), is_failover_target(bool), created_at, updated_at`

### 4.2 `ai_models`
`id, provider_id FK, model_key, task_types(text[]: chat,image,video,voice,music,embedding,research,search,translation,summarization), quality_tier(enum: basic,standard,premium), max_context, supports_cache(bool), enabled(bool)`

### 4.3 `provider_cost_rates` (real cost input to profit engine)
`id, model_id FK, unit(enum: per_token,per_1k_tokens,per_image,per_second,per_minute,per_char,per_request), input_cost, output_cost, currency, effective_from, effective_to` — versioned so historical costs are preserved for reconciliation.

### 4.4 `pricing_rules` (what the *user* is charged, in credits)
`id, action(enum: chat,image,video,voice,music,embedding,research,rendering,publishing,search), model_id FK nullable, provider_id FK nullable, resolution nullable, duration_unit nullable, quality_tier nullable, plan_id FK nullable, credit_cost(numeric), min_margin_override nullable, priority(int), effective_from, effective_to, is_active` — most specific matching rule wins (plan > model > provider > action default).

### 4.5 `organizations`
`id, name, owner_user_id FK, billing_email, tax_id, status, created_at`

### 4.6 `teams`
`id, org_id FK, name, department, monthly_budget_credits(bigint nullable), manager_user_id FK`

### 4.7 `org_memberships`
`id, org_id FK, team_id FK nullable, user_id FK, role(enum: org_admin,team_manager,member,billing_admin), approval_required(bool)`

### 4.8 `shared_wallets`
`id, org_id FK, team_id FK nullable, wallet_id FK → wallets` — reuses the existing `wallets`/`credit_ledger` machinery; a shared wallet is just a wallet owned by an org/team rather than a person.

### 4.9 `budget_periods`
`id, team_id FK, period_start, period_end, allocated_credits, consumed_credits, hard_cap(bool)` — hard-cap teams are blocked when budget is exhausted; soft-cap teams alert the manager.

### 4.10 `developer_api_keys`
`id, user_id/org_id FK, key_prefix, hashed_key(argon2/bcrypt), scopes(text[]), rate_limit_tier, sandbox(bool), last_used_at, revoked_at` — **only a hash is stored**, plaintext shown once at creation.

### 4.11 `developer_webhooks`
`id, owner_id, url, event_types(text[]), signing_secret_ref, status, failure_count`

### 4.12 `forecasts` (BI outputs, cached)
`id, metric(enum: revenue,cost,growth,churn,subscription), horizon, predicted_value, confidence_interval, generated_at`

### 4.13 `provider_health_events`
`id, provider_id FK, event(enum: healthy,degraded,down,recovered), latency_ms, error_rate, checked_at`

---

## 5. AI Provider Management (Module 2)

A registry service tracks every provider and model with live health.

- **Health checks:** the existing background-job system runs a `provider-health-check` job (per §14 of the base spec's job list) every N seconds, pinging each provider with a cheap probe. Results write to `provider_health_events` and update `ai_providers.status`, `avg_latency_ms`, `failure_rate`.
- **Automatic failover:** if a provider is `down` or exceeds a configurable failure-rate threshold, routing excludes it and promotes the next-priority provider that serves the same `task_type` and meets the required quality tier. Failover is transparent to the user; the request just goes to the backup.
- **Rate-limit awareness:** the service tracks remaining RPM/TPM per provider (from response headers where available) and sheds/queues load before hitting a hard limit.
- **Provider analytics:** daily/monthly cost, quality score, and availability per provider surface on the existing Super Admin dashboard as new cards (see §9).
- **Keys** are already managed by the base spec's secret manager (§9 there) — provider management only references key IDs, never stores raw keys.

---

## 6. AI Smart Routing Engine (Module 3)

For each AI request the router picks the provider/model that minimizes cost while meeting quality.

**Inputs:** task type, required quality tier, expected cost (from `provider_cost_rates`), latency, remaining budget (team/user), user plan, provider health/availability, region, retry history.

**Algorithm (per request):**
1. Filter `ai_models` to those serving the requested `task_type`, `enabled`, whose provider is `active`/`degraded` (not `down`), and that meet the required `quality_tier` for the user's plan.
2. Estimate credit cost and real provider cost for each candidate.
3. **Reject any candidate the Profit Protection Engine (§8) says would sell below the configured minimum margin** for this user/plan.
4. Score remaining candidates: weighted function of cost (primary), latency, quality score, and provider priority. Weights are Super-Admin configurable.
5. Route to the top candidate; on failure/timeout, retry against the next candidate (respecting `retry History` to avoid loops) — this is where automatic failover from §5 kicks in.
6. Record the chosen provider + real cost on the usage ledger entry (base spec `credit_ledger.metadata`) so profit is always attributable.

**Cache-first (ties into Token Optimization §12):** before routing at all, the router checks the response/embedding/transcript cache — a cache hit costs zero provider spend and still debits the user the configured credit amount (or a reduced/zero amount, Super-Admin configurable), which is pure margin.

---

## 7. Dynamic Credit Pricing (Module 4)

The Pricing Engine resolves how many credits an action costs, using `pricing_rules` with most-specific-wins resolution:

```
resolve_price(action, model, provider, resolution, duration, quality, plan):
  candidates = pricing_rules matching any subset, is_active, within effective dates
  pick the highest-priority / most-specific candidate
  return credit_cost
```

- Supports per-model, per-provider, per-resolution, per-duration, per-token, per-minute, per-quality, and per-plan pricing.
- Prices are **quoted then locked** at the moment of the wallet reservation (base spec §5.3 reserve→settle), so a mid-flight price change never surprises an in-progress request.
- All pricing changes are Super-Admin actions and are **audit-logged** (base spec §9.7).
- Pricing rules are versioned via `effective_from/to`; historical charges remain explainable.

---

## 8. Profit Protection Engine (Module 5)

The margin guard that every price, offer, and route must pass. **Fail-closed:** if it can't confirm profitability, it blocks.

**True cost of a generation =**
`provider_cost + gpu_cost + storage_cost + bandwidth_cost + rendering_cost + gateway_fee_share + tax_share`

**Margin check for a sale/offer:**
```
net_credits_value = credits_charged × credit_unit_value
                    − discount − bonus_credit_cost
expected_provider_cost = routed model cost × expected_usage
margin = (net_credits_value − true_cost) / net_credits_value
allow  = margin >= configured_min_margin (per plan/region, Super-Admin set)
```

- The routing engine calls this before selecting a model (§6.3); the offer engine (Phase 6) calls it before generating any offer; the pricing engine calls it when an admin sets a new price.
- **Never sells below cost** and **auto-rejects promotional offers that create expected losses**, using historical per-user usage to predict expected consumption.
- Minimum margin is configurable globally and overridable per plan/region.
- Every rejection is logged with the computed numbers so admins can see *why* an offer/price was blocked.

---

## 9. Enterprise Super Admin Dashboard (Module 1 — additive cards)

The dashboard already exists; Phase 5 adds real-time cards fed by the BI service and provider service. New cards: Annual Revenue, MRR, ARR, Cloud/Storage/Bandwidth cost split, Top Customers, Top Countries, Most Expensive Users, Highest-Revenue Users, Low-Credit Users, Recharge Conversion, Subscription Conversion, Most-Used AI Models, per-provider Daily/Monthly cost + health.

All cards read from **read replicas / pre-aggregated tables** (§14) so they never contend with the transactional billing path.

---

## 10. Organization & Team Billing (Module 8)

Enterprises need shared spend with control:

- **Organizations** contain **teams/departments**, each optionally with a `monthly_budget_credits`.
- A **shared wallet** is an existing wallet owned by an org/team — no new ledger mechanics, full reuse of base spec §5.
- **Budgets:** the `budget_periods` table caps team spend. Hard-cap teams are blocked (fail-closed) when exhausted; soft-cap alerts the manager. Enforced at the wallet reserve step.
- **Manager approval:** members flagged `approval_required` have high-cost actions (configurable credit threshold) queued for manager approval before the reservation commits — reuses the existing Approvals subsystem.
- **Usage reports** per team/department/member roll up from the ledger; exportable via the existing report jobs.
- **RBAC** extends the base roles with `org_admin`, `team_manager`, `billing_admin` scoped to the org — no change to the global RBAC engine, just new permission strings and org-scoped checks.

---

## 11. Advanced Analytics & Business Intelligence (Modules 9 & 18)

- **Analytics** (aggregated, not real-time-critical): Revenue, Profit, Credit/Token usage, Provider cost, Retention, Churn, **LTV, CAC, ARPU, MRR, ARR**, and a **Conversion Funnel** (trial → recharge → subscription; trial funnel detail lives in Phase 6).
- **BI/Forecasting:** revenue forecast, cost forecast, growth forecast, churn/subscription prediction, and AI-usage prediction, cached in `forecasts`. Start with simple, explainable models (moving averages, cohort-based projection, linear/seasonal regression) before any heavier ML — cheaper to run and easier to trust.
- All heavy analytics run on read replicas and pre-aggregation jobs (extends the base spec's analytics job).

---

## 12. AI Cost Optimization / Token Optimization (Modules 17)

Extends the base spec's token-optimization section with concrete reuse infrastructure:

- **Response cache:** hash of (normalized prompt + model + params) → stored output. Identical requests are never sent to a provider twice.
- **Embedding cache:** content hash → embedding vector; never re-embed the same content.
- **Transcript/analysis cache:** never analyze the same video/audio twice — keyed by media content hash.
- **Context compression & prompt templates/versioning:** shrink tokens per call; versioned templates so prompt changes are tracked and A/B-able.
- **Batching & parallel workers:** batch embeddable/independent requests; parallelize across providers within rate limits.
- Cache hits are recorded in the ledger metadata as `cache_hit=true` so the BI service can quantify saved cost — this is directly reported as margin gained.

---

## 13. Developer Portal (Module 15)

Lets customers build on the platform.

- **API keys:** issued per user/org, stored only as a hash (`developer_api_keys`), scoped, rate-limited, with a **sandbox mode** that runs against test providers and a play-money wallet.
- **Webhooks:** customers register endpoints for events (recharge, credit low, generation complete); deliveries are signed (HMAC with `signing_secret_ref`), retried with backoff + dead-letter, mirroring the base spec's inbound webhook robustness.
- **SDK & docs:** auto-generated from the OpenAPI spec; usage analytics per key.
- Portal traffic uses the same auth/rate-limit/WAF stack as the base spec; developer keys are bearer credentials distinct from user JWTs and never grant admin scopes.

---

## 14. Background Jobs (additions)

Adds to the existing job system: `provider-health-check`, `provider-cost-aggregation`, `pricing-rule-activation`, `analytics-aggregation` (enterprise metrics), `forecast-generation`, `budget-period-rollover`, `cache-eviction` (TTL + LRU for response/embedding caches). All follow the existing idempotent, retryable, dead-letter pattern.

---

## 15. Scalability, Monitoring & Disaster Recovery (Modules 16 + new)

- **Scalability:** stateless new services, horizontal autoscaling, Redis for caches/rate limits, queue workers for AI jobs, CDN for assets, ledger partitioned by month (already in base spec), object storage for media, streaming processing for large media, lazy loading in clients.
- **Monitoring:** SLOs per service (latency, error rate, saturation), dashboards + alerting; provider health feeds an ops board; anomaly alerts on refund spikes, margin dips, and failover frequency route to on-call.
- **Disaster Recovery:** automated encrypted backups of all databases (point-in-time recovery), cross-region read replica that can be promoted, documented RTO/RPO targets, and tested failover runbooks. The append-only ledger + audit log make post-incident reconstruction reliable. Secrets and keys are recoverable only through the secrets manager's own DR process, never from app backups.

---

## 16. API Design (new endpoints)

```
# AI provider & routing (admin)
GET/POST/PATCH  /v1/admin/providers
GET             /v1/admin/providers/:id/health
GET/POST/PATCH  /v1/admin/models
POST            /v1/admin/routing/simulate      # dry-run: what would route + cost

# Pricing & profit (admin)
GET/POST/PATCH  /v1/admin/pricing-rules
POST            /v1/admin/profit/preview        # margin check for a hypothetical sale

# Organizations & teams
POST            /v1/orgs
POST            /v1/orgs/:id/teams
POST            /v1/orgs/:id/members
GET/PATCH       /v1/teams/:id/budget
POST            /v1/teams/:id/approvals/:action_id/approve

# Analytics & BI (admin)
GET             /v1/admin/analytics/:metric
GET             /v1/admin/forecasts/:metric

# Developer portal
POST            /v1/dev/keys
DELETE          /v1/dev/keys/:id
POST            /v1/dev/webhooks
```

Every mutating endpoint carries the base spec's `Idempotency-Key` and RBAC + audit rules.

---

## 17. Testing Strategy (Phase 5 focus)

- **Routing tests:** given fixed provider costs/health, the router picks the cheapest compliant model; failover triggers when a provider is marked down.
- **Profit-guard tests:** a below-margin price/offer is always rejected; boundary tests at exactly the min-margin.
- **Pricing resolution tests:** most-specific rule wins; price is locked at reservation time.
- **Budget tests:** hard-cap team blocked at zero remaining; soft-cap alerts but allows.
- **Cache tests:** identical request served from cache incurs zero provider cost; cache-hit recorded in ledger metadata.
- **DR drills:** replica promotion restores service within RTO; ledger reconstructs exactly.

---

## 18. Developer Task Breakdown

1. Provider registry + health-check job + failover in routing.
2. Pricing engine + `pricing_rules` resolution + reservation-time price lock.
3. Profit protection engine; wire into routing, pricing, and (Phase 6) offers.
4. Org/team/shared-wallet/budget model + approval hook into existing Approvals.
5. Response/embedding/transcript caches + cache-hit ledger metadata.
6. BI aggregation jobs + forecasting + dashboard cards.
7. Developer portal (keys, webhooks, sandbox, SDK/docs).
8. Monitoring/SLO/alerting + DR backups, replica, runbooks.

---

## 19. Acceptance Criteria

- [ ] No AI action is ever sold below the configured minimum margin (profit engine fail-closed).
- [ ] Routing always selects the cheapest provider/model that meets quality and passes the profit check; failover is automatic and transparent.
- [ ] Pricing is resolved by most-specific rule and locked at reservation time; all changes audit-logged.
- [ ] Identical AI requests are never sent to a provider twice; cache hits are recorded and quantified as saved cost.
- [ ] Org/team shared wallets reuse the existing ledger; hard-cap budgets block spend; approvals gate high-cost actions.
- [ ] Enterprise dashboard cards and forecasts render from replicas/pre-aggregates without touching the transactional path.
- [ ] Developer API keys are stored only as hashes, scoped, rate-limited, with working sandbox mode.
- [ ] DR drill restores service within the documented RTO/RPO and the ledger reconstructs exactly.
- [ ] All existing billing modules remain functionally unchanged (backward compatible).

---

## 20. Implementation Roadmap

**Wave 1 (foundation):** Provider registry + health/failover; Pricing engine; Profit engine (these unblock everything else).
**Wave 2 (intelligence):** Smart routing + caches + token optimization.
**Wave 3 (enterprise):** Org/team billing + budgets + approvals.
**Wave 4 (insight & scale):** BI/forecasting + dashboard cards; Developer portal.
**Wave 5 (hardening):** Monitoring/SLOs + DR drills.

---

## 21. Future Enhancements

- ML-based demand/cost forecasting replacing heuristic models once enough data accrues.
- Per-customer negotiated enterprise pricing contracts.
- Provider spend commitments/reserved-capacity optimization.
- Real-time streaming BI (materialized views / stream processing) for sub-second dashboards.

---

*End of specification.*
