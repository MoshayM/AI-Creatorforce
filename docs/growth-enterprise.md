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
| §5–7 Trial system + abuse + restrictions | Trial lot on signup, one-per-identity, fingerprint scoring, feature gating | ✅ shipped |
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

## What shipped in Phase 6 Wave 1 (trial system)

- **Trial credits are ordinary credit lots** (spec's own reuse rule): a new
  `trialCredits` bucket at the HEAD of the spend priority (trial → promo →
  bonus → referral → purchased), granted as a `TRIAL` ledger entry with lot
  expiry `TRIAL_EXPIRY_DAYS` (default 15) — the existing expiry job sweeps
  it, the existing wallet card shows it. `TRIAL_CREDITS` (default 100),
  0 disables trials.
- **One trial per identity**: `trial_grants` with unique `userId` AND unique
  `identityKey` (sha256 of normalized email) — the hard backstop the spec
  requires even when scoring passes. The grant idempotency key is the
  identity key, so replay can't double-grant.
- **Abuse scoring** (`scoreAbuse`, pure + tested, fail-closed): duplicate
  device fingerprint → BLOCK; duplicate IP + VPN → REVIEW (parked as
  `PENDING_REVIEW`, granted only via `POST /admin/trial/:userId/approve`);
  clean signups → ALLOW. Every decision lands in `abuse_signals`.
- **Server-side restrictions** (`trial_limits`, Super-Admin editable via
  `PATCH /admin/trial-config`): `daily_ai_requests` enforced in the
  supervisor before any job dispatch (counts child stages — a 20/day default
  ≈ 3 full pipelines), `max_projects`, `publishing`. Applies only while the
  user is genuinely on trial (no purchases, not converted). Disabled/exceeded
  features fail with `TRIAL_LIMIT:<feature>` the UI can turn into an
  upgrade nudge.
- **Conversion**: the first successful recharge flips the grant to
  `CONVERTED` (webhook settle path) — restrictions lift automatically.
- `GET /trial/status` (remaining trial credits, expiry) and
  `GET /trial/limits` for the client; signup accepts an optional
  `deviceFingerprint`.

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
- **Identity verification** (Phase 6 §6): no outbound email/OTP infra exists,
  so "verified identity" = the registered email (hashed) — the one-trial
  uniqueness and fingerprint/IP scoring still hold; OTP/social verification
  plug into `verificationMethod` when auth providers land. VPN detection
  needs an IP-intelligence service — the scoring input exists, wired to
  `false` for now.

## Next steps

1. Phase 6 Wave 2: behavior tracker + upgrade engine + first-recharge
   rewards (profit-gated via the shipped guard).
2. Phase 5 org/team billing (shared wallets reuse the wallet/ledger as the
   spec prescribes; budgets enforce at the reserve step).
3. Offer engine + credit-pack marketplace, then referrals.
4. Trial→paid conversion analytics on the admin dashboard.
