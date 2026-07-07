# Enterprise Extensions & Growth Engine — Implementation Plan

> Working plan for `Docs3/Phase5-Enterprise-Extensions-Spec.md` and
> `Docs3/Phase6-Trial-Growth-Engine-Spec.md`, mapped onto the existing NestJS
> monolith. Same convention as `docs/billing-security.md`: spec concepts kept,
> microservice topology not (module boundaries mirror the spec's service
> boundaries). Both specs build on the shipped billing core — see
> `docs/billing-security.md` for that layer's status.

## Phase 5 slice status

| Spec module | Scope | Status |
|---|---|---|
| §5 Provider management | `ai_providers` + `provider_health_events` + `provider_cost_rates` persisted from the shared aiClient's LIVE health state; seeded on boot; `/admin/providers` | ✅ shipped |
| §7 Dynamic pricing | `pricing_rules`, most-specific-wins resolution (plan > model > provider > action), quoted-and-LOCKED at reservation, admin CRUD audited | ✅ shipped |
| §8 Profit protection | Fail-closed margin guard (`MIN_PROFIT_MARGIN`, default 30%): worst-case provider cost vs credit value; gates pricing-rule create/update; `/admin/profit/preview` | ✅ shipped |
| §6 Smart routing | Health-ranked provider selection + automatic failover + rate limiting | ✅ pre-existing in the shared aiClient (score/cooldown/failover) — registry now persists it; per-request cost-based *model* selection deferred (single model per provider today) |
| §12 Token optimization | Intent cache, compliance cache, per-stage resume, embedding no-reembed | ✅ pre-existing; response-cache generalization deferred |
| §10 Org/team billing | Organizations, teams, shared wallets, budgets, manager approval | ❌ next — shared wallet = existing wallet owned by an org (spec's own reuse note) |
| §11 BI/forecasting | LTV/CAC/ARPU/MRR, forecasts | ❌ later — needs revenue history to be meaningful |
| §13 Developer portal | Hashed API keys, webhooks, sandbox | ❌ later (an internal `ApiKey` model exists as a starting point) |
| §15 Monitoring/DR | SLOs, backups, replicas | ⏸ deferred — single-node local deployment; ledger/audit design already supports reconstruction |

## Phase 6 slice status

| Spec module | Scope | Status |
|---|---|---|
| §5–7 Trial system + abuse + restrictions | Trial lot on verified signup, one-per-identity, fingerprint scoring, feature gating | ❌ next up (Wave 1) |
| §8–9 Upgrade engine + first-recharge rewards | Behavior-driven nudges; profit-gated bonuses | ❌ after trial |
| §10 Offers + referrals | Rule-driven offers, referral codes/qualification/fraud | ❌ after trial |
| §12 Marketplace | `credit_packs`, regional pricing over the existing recharge path | ❌ after offers |
| §11 Wallet display | Lot breakdown already exists on the settings wallet card; expiry timeline pending | ⏳ partial |

## What shipped in this slice (Phase 5 Wave 1)

- **Provider registry** (§5): the live health/failover/rate-limit machinery
  already ran inside `packages/shared/src/ai` (health scores, cooldowns,
  provider ranking) — the new `ProviderRegistryService` seeds
  `ai_providers` + default `provider_cost_rates` from the client's built-in
  table and persists the health snapshot every 5 minutes; status transitions
  become `provider_health_events`. `GET /admin/providers` shows state,
  current rates, and recent events.
- **Pricing engine** (§7): `resolveRule` picks the most specific active rule
  (specificity = non-null matchers, then priority, then recency) within its
  effective window. When a rule prices an action, the supervisor/copilot
  reserve exactly that amount and settle exactly that amount
  (`priceLocked: true` + rule id in the ledger metadata) — a mid-flight rule
  change never touches an in-progress request. No rule → the existing
  cost×markup settle path (which is margin-safe by construction).
- **Profit guard** (§8): `computeMargin` fails closed on zero value or
  unknown cost; expected cost = worst-case (most expensive) live provider at
  the action's nominal token usage, from DB rates falling back to the shared
  defaults. Creating or re-pricing a rule below `MIN_PROFIT_MARGIN`
  (default 0.3) is rejected with the computed numbers; every decision is
  audit-logged. `POST /admin/profit/preview` answers "could I charge X?".
- **RBAC**: new `admin:providers` (OWNER+) and `admin:pricing`
  (SUPER_ADMIN) permissions.

## Deliberate deviations

- **Monolith modules, not microservices** (both specs §3) — same precedent
  as every prior layer.
- **Token-only cost model**: the specs price images/video/voice per unit;
  this deployment's AI spend is token-based (media generation runs local
  ffmpeg/offline adapters at zero marginal provider cost), so cost rates are
  per-1M-token only until paid media providers land.
- **Routing engine**: provider choice stays in the shared aiClient (health-
  ranked with cooldown failover). The spec's per-request *cheapest-model*
  scoring needs multiple models per task type — deferred until model
  alternatives exist per provider.
- **Float cost rates** instead of numeric(18,6): estimates feeding a guard
  with a 30% buffer, not money movement; credits remain integers.
- **Nominal-usage margin checks**: rule-level checks use per-action nominal
  token counts (`NOMINAL_USAGE`) rather than per-user history — history-based
  prediction becomes worthwhile with the Phase 6 behavior tracker.

## Next steps

1. Phase 6 Wave 1: trial service (trial lot via existing wallet, `trial_grants`
   one-per-identity), abuse signals (hashed fingerprint + risk decision),
   `trial_limits` server-side gating.
2. Phase 5 org/team billing (shared wallets reuse the wallet/ledger as the
   spec prescribes; budgets enforce at the reserve step).
3. First-recharge rewards + offer engine, gated by the shipped profit guard.
4. Trial→paid conversion analytics on the admin dashboard.
