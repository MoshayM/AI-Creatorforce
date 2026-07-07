# Billing, Wallet & Security — Implementation Plan

> Working plan for the `docs2/AI-CreatorForce-Billing-Payment-Security-Spec.md`
> (v1.1) and `docs2/Platform-Deployment-Domain-Spec.md` specifications, mapped
> onto the existing NestJS/Next.js monolith. Same convention as
> `docs/video-hub.md`: the spec's concepts are kept, the microservice topology
> is not (see Deviations).

## Slice status

| Spec area | Scope | Status |
|---|---|---|
| §4 Schema | `wallets`, `credit_ledger` (append-only), `payments`, `webhook_events`; `SUPER_ADMIN` role | ✅ shipped |
| §5 Credit engine | Idempotent credit/debit, §5.4 spend priority (promo → bonus → referral → purchased), ledger-first with balance snapshots | ✅ shipped |
| §5.2 Recharge | Stripe Checkout (payment mode) → signature-verified webhook → deduped credit grant | ✅ shipped |
| §9.2 RBAC | Permission strings, role→permission map, `PermissionsGuard`; SUPER_ADMIN/OWNER emails from env, never source | ✅ shipped |
| §10 Admin API | `/admin/billing/revenue`, `/admin/audit-logs`, `/admin/users`, `/admin/wallet/adjust` (audited) | ✅ shipped |
| §5.3 Reserve→settle | Soft-hold before AI request, settle on completion | ✅ shipped (opt-in via `BILLING_ENFORCE_CREDITS`) |
| §5.4/§11 Expiry + reconciliation jobs | credit-expiry, ledger-reconciliation, settlement reconciliation | ❌ next slice |
| §7 Refunds & disputes | Admin refund with credit claw-back; dispute webhooks | ❌ next slice |
| §6.6 Mobile IAP | Apple IAP / Google Play Billing adapters | ⏸ deferred until mobile clients exist |
| Platform spec (§ all) | iOS/Android/desktop shells, domains, DNS/TLS, deep links | ⏸ deferred — no mobile/desktop clients yet |

## What shipped in this slice

### RBAC & identity (§9.2/§9.9)
- `UserRole` gains `SUPER_ADMIN` (> OWNER > MEMBER).
- **Identities live in env config, never source** (spec acceptance criterion):
  `SUPER_ADMIN_EMAILS` and `OWNER_EMAILS` in `.env` (gitignored;
  `.env.example` has empty placeholders). `resolveElevatedRole()` matches
  case-insensitively at login/JWT-validation and persists the elevation;
  removing an email from the super-admin list demotes back to OWNER on the
  next request.
- Permission strings (`billing:view`, `billing:refund`, `wallet:adjust`,
  `admin:users`, `admin:audit-logs`, `admin:revenue`) with a role→permission
  map in `common/rbac.ts`; `@RequirePermissions(...)` + `PermissionsGuard`
  fail closed. `OwnerGuard` now accepts SUPER_ADMIN.

### Wallet & ledger (§4/§5)
- `wallets` is a cached view; the append-only `credit_ledger` is the source of
  truth — every entry stores `balanceAfter` and a unique `idempotencyKey`.
  Replaying a key returns the original entry (unique-violation race included).
- Credits are integers; money is integer minor units. Debits split across
  buckets in §5.4 priority (`planDebit` is pure + unit-tested, fails closed
  on insufficient funds); the split is recorded in the entry metadata.
- Serializable transactions with an in-transaction balance re-read prevent
  concurrent-debit overdrafts.

### Recharge (§5.2/§6)
- `POST /wallet/recharge` (JWT + mandatory `Idempotency-Key` header) creates
  a PENDING `payments` row and a Stripe Checkout session (payment mode);
  the same key is forwarded to Stripe so network retries can't double-create.
- Credits are granted **only** by the webhook: signature verified (existing),
  then deduped via `webhook_events` (`gateway+eventId` unique), then the
  wallet credit is itself idempotent on `stripe:<payment_intent>` — three
  independent layers against double-crediting (§16 acceptance).
- `CREDITS_PER_USD` env (default 100) sets the conversion; per-platform rates
  (§6.6) become relevant only when IAP adapters land.

### Admin surface (§10/§9.7)
- `GET /admin/billing/revenue` (gross by gateway), `GET /admin/audit-logs`,
  `GET /admin/users` (roles + wallet/plan), `POST /admin/wallet/adjust`
  (grant or claw back, reason required, audited synchronously with
  before/after balances).
- Settings page: wallet card with bucket breakdown + $5–$100 recharge via
  Stripe Checkout.

### Reserve→settle holds (§5.3, slice 2)

- **`credit_reservations`**: HELD / SETTLED / RELEASED with a TTL
  (`HOLD_TTL_MINUTES`, default 120) — availability math ignores expired HELD
  rows, so a crashed job can never strand credits. Available = balance −
  live holds, checked inside a serializable transaction (fail closed).
- **Hook points**: the supervisor reserves `JOB_RESERVE_CREDITS` (default 50)
  before dispatching any job — insufficient credits fail the job *before* a
  single provider call; the copilot reserves `COPILOT_RESERVE_CREDITS`
  (default 5) around its one LLM call per turn (cache hits never reserve).
  The real cost accumulates through the AsyncLocalStorage usage context
  (`AiUsageAccumulator`, fed by the same global listener that writes
  `token_usage`), and the settle debits
  `creditsForCost(costUsd) = ceil(cost × CREDITS_PER_USD × AI_CREDIT_MARKUP)`
  as a `USAGE_DEBIT` ledger entry keyed `settle:<reservationId>`.
- **Failure** releases the hold with no debit (§5.3 step 4 — retried jobs
  would otherwise double-charge). **Settle overrun** clamps to the remaining
  balance and logs the shortfall — completed work is never thrown away over
  a few credits.
- **Enforcement is opt-in** (`BILLING_ENFORCE_CREDITS=false` default): with
  it off, usage is still metered and attributed but nothing is held or
  debited — the current zero-credit local deployment is unaffected. Flip to
  `true` once wallets are funded.
- Known gap: semantic-search query embeddings (fractions of a cent) are
  metered but not debited — noted for the reconciliation slice.

## Deliberate deviations from the spec docs

- **Monolith, not microservices** (§2/§3): billing/wallet/admin are NestJS
  modules in the existing API, same as `claude.md` conventions and the
  video-hub precedent. The module boundaries mirror the spec's service
  boundaries, so extraction later is mechanical.
- **No Kafka/SQS event bus**: webhook processing is synchronous within the
  request; `webhook_events` provides the idempotency the queue would have.
  Revisit if webhook volume warrants it.
- **No Vault/KMS or column-level encryption yet** (§9.3): this is a
  local-first single-tenant deployment; secrets stay in the gitignored
  `.env`. The spec's envelope-encryption design applies when the platform is
  hosted multi-tenant.
- **DB-level append-only enforcement** (§4.3) is by convention (no service
  code updates/deletes ledger rows), not yet by DB `REVOKE` — add with the
  reconciliation-jobs slice.
- **`super_admins` DB table** (§9.9 "DB takes precedence"): env-only for now;
  the resolver is the single place to add table precedence later.
- **BigInt→Int**: credit/money columns use 32-bit ints (fine for a
  single-tenant local deployment; the spec's bigint applies at platform
  scale).

## Next steps

1. Nightly jobs (§11): ledger reconciliation (cache == ledger sum),
   credit expiry, stale-reservation sweeper, Stripe settlement
   reconciliation.
2. Refund endpoint (`billing:refund`) with credit claw-back + dispute
   webhook handling (§7).
3. Debit semantic-search query embeddings (currently metered only).
4. Apple IAP / Google Play Billing adapters behind a
   `PaymentGatewayAdapter` interface when mobile clients exist (§6.6).
