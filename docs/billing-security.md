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
| §5.3 Reserve→settle | Soft-hold before AI request, settle on completion | ❌ next slice |
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

1. Reserve→settle credit holds (§5.3) wired into the AI usage path — debit
   real credits per AI call using the existing token_usage cost attribution.
2. Nightly jobs (§11): ledger reconciliation (cache == ledger sum),
   credit expiry, Stripe settlement reconciliation.
3. Refund endpoint (`billing:refund`) with credit claw-back + dispute
   webhook handling (§7).
4. Apple IAP / Google Play Billing adapters behind a
   `PaymentGatewayAdapter` interface when mobile clients exist (§6.6).
