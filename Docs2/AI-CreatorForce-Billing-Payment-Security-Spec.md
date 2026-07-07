# AI CreatorForce — Billing, Payment & Security/Privacy System
## Implementation-Ready Specification (v1.1)

> Scope: This document covers the **Billing Engine, Payment Gateway Integration, Wallet/Credit ledger, and Security & Privacy architecture** of the AI CreatorForce platform, designed to plug into the broader Super Admin / Growth platform. It is written to be handed directly to an engineering team.
>
> **v1.1 update:** The application now targets **iOS, Android, Windows, and macOS** in addition to web, and requires **custom domain configuration**. This changes the payment architecture materially (mobile app-store rules) — see §6.6 below and the companion document **`Platform-Deployment-Domain-Spec.md`** for full cross-platform, packaging, and domain/DNS/TLS details.

---

## 1. Executive Summary

AI CreatorForce needs a billing and payment layer that:

- Converts real money into an internal **Credit** currency so users never see raw token/API pricing.
- Tracks every cost (AI provider, infra, gateway fees) against every credit spent, so margin is always known.
- Integrates multiple payment gateways (Stripe, Razorpay, PayPal, Apple Pay, Google Pay, UPI) behind one internal interface.
- Is **PCI-DSS SAQ-A compliant** by never touching raw card data — all card capture happens via gateway-hosted fields/SDKs.
- Encrypts all financial and personal data at rest, logs every sensitive action, and enforces strict RBAC for Super Admins.
- Is idempotent, reconciled, and auditable so it can pass a financial audit.

Design principles: **ledger-first**, **idempotent by default**, **least privilege**, **encrypt everything sensitive**, **fail closed on payment/security errors**.

---

## 2. High-Level Architecture

```
                         ┌─────────────────────┐
                         │   Client Apps        │
                         │ (Web / Mobile)        │
                         └──────────┬───────────┘
                                    │ HTTPS (TLS 1.3)
                                    ▼
                         ┌─────────────────────┐
                         │   API Gateway         │
                         │ - AuthN (JWT/OAuth)   │
                         │ - Rate limiting       │
                         │ - WAF                 │
                         └──────────┬───────────┘
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │                 Application Services                │
        │                                                       │
        │  Billing Service   Wallet Service   Payment Service  │
        │  Subscription Svc   Coupon/Offer Svc  Fraud Svc       │
        └──────────┬───────────────┬───────────────┬──────────┘
                   │               │               │
                   ▼               ▼               ▼
         ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
         │ Ledger DB      │  │ Cache (Redis)  │  │ Payment Gateways   │
         │ (Postgres,     │  │ - rate limits  │  │ Stripe / Razorpay  │
         │ append-only)   │  │ - idempotency  │  │ PayPal / Apple Pay  │
         └──────────────┘  └──────────────┘  └──────────────────┘
                   │
                   ▼
         ┌──────────────────┐
         │ Secrets Manager     │  (AWS Secrets Manager / Vault)
         │ - API keys           │
         │ - Gateway secrets     │
         └──────────────────┘
                   │
                   ▼
         ┌──────────────────┐
         │ Audit Log Store      │ (append-only, WORM, exported to SIEM)
         └──────────────────┘
```

**Key architectural rule:** the **Wallet/Ledger is the single source of truth** for credits. No service may mutate a user's balance directly — all changes go through the Ledger service via an atomic, idempotent transaction API.

---

## 3. Folder Structure

```
/apps
  /api-gateway
  /billing-service
  /wallet-service
  /payment-service
  /subscription-service
  /coupon-offer-service
  /fraud-service
  /admin-service
  /notification-service
  /analytics-service
/packages
  /shared-types
  /shared-crypto        # encryption helpers, key rotation
  /shared-audit         # audit log emitter
  /shared-idempotency
  /shared-rbac
/infra
  /terraform
  /k8s
  /secrets-bootstrap
/docs
  billing-schema.md
  security-policy.md
  runbooks/
```

Each service is independently deployable, owns its own schema/tables, and communicates via internal REST/gRPC + an event bus (e.g., Kafka/SQS) for async events (payment.succeeded, credit.debited, subscription.renewed).

---

## 4. Database Schema (Billing & Payment Domain)

All monetary and credit values stored as **integer minor units** (cents / paise) or integer credits — never floats.

### 4.1 `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | citext unique | encrypted at column level (see §9.3) |
| phone | text | encrypted |
| status | enum(active, suspended, deleted) | soft delete only |
| kyc_status | enum | for high-value transactions |
| created_at / updated_at | timestamptz | |

### 4.2 `wallets`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | unique (1 wallet per user) |
| balance_credits | bigint | derived/cached, always reconcilable from ledger |
| bonus_credits | bigint | |
| purchased_credits | bigint | |
| promotional_credits | bigint | |
| referral_credits | bigint | |
| lifetime_purchased | bigint | |
| lifetime_used | bigint | |
| version | bigint | optimistic locking |
| updated_at | timestamptz | |

### 4.3 `credit_ledger` (append-only, immutable)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| wallet_id | uuid FK | |
| entry_type | enum(purchase, bonus, referral, promo, usage_debit, refund, expiry, adjustment) | |
| amount | bigint | positive = credit, negative = debit |
| balance_after | bigint | snapshot for audit |
| reference_type | enum(payment, ai_request, coupon, referral, admin_action) | |
| reference_id | uuid | FK to relevant source record |
| idempotency_key | text unique | prevents double-processing |
| metadata | jsonb | provider, model, cost breakdown |
| created_at | timestamptz | |

> No `UPDATE` or `DELETE` allowed on this table at the DB permission level. Corrections are new offsetting rows (`adjustment`).

### 4.4 `payments`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK | |
| gateway | enum(stripe, razorpay, paypal, apple_pay, google_pay, apple_iap, google_play_billing) | see §6.6 for platform rules |
| gateway_payment_id | text | external ref |
| amount | bigint | minor units |
| currency | char(3) | ISO 4217 |
| status | enum(pending, succeeded, failed, refunded, partially_refunded, disputed) | |
| credits_granted | bigint | |
| idempotency_key | text unique | |
| failure_reason | text nullable | |
| raw_gateway_payload_ref | text | pointer to encrypted blob store, NOT inline PII |
| created_at / updated_at | timestamptz | |

### 4.5 `invoices`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK | |
| payment_id | uuid FK nullable | |
| subscription_id | uuid FK nullable | |
| invoice_number | text unique | sequential, tax-compliant format |
| amount | bigint | |
| tax_amount | bigint | |
| currency | char(3) | |
| pdf_url | text | signed URL, short-lived |
| status | enum(draft, issued, paid, void) | |
| issued_at | timestamptz | |

### 4.6 `subscriptions`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK | |
| plan_id | uuid FK → plans | |
| gateway_subscription_id | text | |
| status | enum(active, past_due, canceled, paused) | |
| current_period_start/end | timestamptz | |
| cancel_at_period_end | boolean | |
| created_at / updated_at | timestamptz | |

### 4.7 `plans`
`id, name, monthly_price, monthly_credits, storage_gb, max_projects, max_team_members, features(jsonb), is_active`

### 4.8 `payment_methods`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK | |
| gateway | enum | |
| gateway_token | text | **tokenized reference only — never raw card data** |
| brand / last4 / exp_month / exp_year | text/int | display-only, non-sensitive fragments |
| is_default | boolean | |

### 4.9 `refunds`
`id, payment_id, amount, reason, status, initiated_by (admin_id), created_at`

### 4.10 `webhook_events` (for gateway idempotency)
`id, gateway, event_id unique, event_type, payload_ref, processed_at, status`

### 4.11 `audit_logs`
`id, actor_id, actor_type(admin/user/system), action, resource_type, resource_id, ip_address, user_agent, before_state(jsonb), after_state(jsonb), created_at` — write-only, retained ≥ 7 years for financial records, shipped to a separate WORM store/SIEM in near-real-time.

---

## 5. Billing & Credit Engine

### 5.1 Core rule
> **1 credit purchase = 1 payment = 1 ledger entry = 1 invoice.** Every credit debit for AI usage = 1 ledger entry referencing the triggering request.

### 5.2 Recharge flow
1. Client requests a recharge (`POST /wallet/recharge`) with `plan_amount` or `custom_amount` + `idempotency_key`.
2. Billing Service validates amount, currency, and user status (not suspended).
3. Payment Service creates a **PaymentIntent** with the selected gateway, returns client secret / redirect URL.
4. Client completes payment on gateway-hosted UI (Stripe Elements, Razorpay Checkout, PayPal SDK). **Raw card data never touches AI CreatorForce servers.**
5. Gateway sends a **webhook** (`payment_intent.succeeded`) → verified via signature → Payment Service marks `payments.status = succeeded` (idempotent on `gateway_payment_id`).
6. Billing Service computes credits granted (amount × conversion rate + any active bonus rule from Promotion Engine) and calls Wallet Service `credit(wallet_id, amount, idempotency_key)`.
7. Wallet Service inserts ledger row + updates cached balance atomically inside one DB transaction (`SELECT … FOR UPDATE` on wallet row, or use Postgres `SERIALIZABLE`).
8. Invoice auto-generated and PDF stored; notification sent.
9. All steps are individually retryable and safe to replay because of idempotency keys at every hop.

### 5.3 Usage debit flow (AI request spends credits)
1. Before executing an AI request, the calling service asks Wallet Service to **reserve** credits (`POST /wallet/reserve`) — a soft hold, not yet committed.
2. AI request executes; actual token/cost usage measured.
3. Wallet Service **settles** the reservation: commits the real debit amount (may differ from estimate) and releases any unused hold.
4. If request fails before completion, reservation is released (no debit).
5. This reserve → settle pattern prevents users from spending credits they don't have while avoiding blocking on slow AI calls.

### 5.4 Credit expiry priority
Debit order when consuming credits: **promotional → bonus → referral → purchased** (cheapest-to-platform first, matches spec: "bonus expires first, purchased expires last").

A nightly job (`credit-expiry-job`) scans for expired lots and posts `expiry` ledger entries; users are notified 7/3/1 days before expiry.

### 5.5 Reconciliation
- Nightly job recomputes each wallet's `balance_credits` by summing `credit_ledger` and compares to the cached value in `wallets`. Mismatches raise a `P1` alert — cached balance is only a read optimization, ledger is truth.
- Daily reconciliation against each payment gateway's settlement report (Stripe Payouts API, Razorpay Settlements) to catch missed webhooks.

---

## 6. Payment Gateway Integration

### 6.1 Abstraction layer
All gateways implement a common internal interface so the rest of the system is gateway-agnostic:

```ts
interface PaymentGatewayAdapter {
  createPaymentIntent(input: CreateIntentInput): Promise<IntentResult>;
  verifyWebhookSignature(payload: Buffer, headers: Headers): boolean;
  parseWebhookEvent(payload: Buffer): NormalizedPaymentEvent;
  refund(paymentId: string, amount?: number): Promise<RefundResult>;
  createSubscription(input: SubInput): Promise<SubResult>;
  cancelSubscription(subId: string): Promise<void>;
}
```

Concrete adapters: `StripeAdapter`, `RazorpayAdapter`, `PayPalAdapter`, `ApplePayAdapter` (via Stripe/Adyen tokenization), `GooglePayAdapter`.

### 6.2 Webhook handling rules
- Every webhook endpoint **verifies the cryptographic signature** using the gateway's secret (from Secrets Manager) before touching the payload.
- Every event is written to `webhook_events` with the gateway's `event_id` as a unique constraint — duplicate deliveries are no-ops.
- Webhooks are processed asynchronously via a queue, with retries + dead-letter queue for failures, and alerting after 3 failed attempts.
- Webhook endpoints are **not** protected by normal user auth (gateways can't log in), but are protected by signature verification, IP allow-listing where the gateway supports it, and strict payload size limits.

### 6.3 PCI-DSS scope reduction
- Card data is only ever entered into gateway-hosted iframes/SDKs (Stripe Elements, Razorpay Checkout). Servers only ever see **tokens**.
- This keeps AI CreatorForce at **PCI-DSS SAQ-A** (lowest compliance burden) rather than SAQ-D.
- Stored `payment_methods` contain only token references + non-sensitive display fragments (brand, last4, expiry) returned by the gateway.

### 6.4 Failure & retry handling
- Failed payments trigger a `payment.failed` notification + optional dunning email sequence for subscriptions.
- Subscription payment failures → `past_due` status, grace period (configurable, default 3 days), then auto-downgrade to Free plan with credits paused (not deleted).
- All retries idempotent via `idempotency_key` sent to the gateway itself (Stripe/Razorpay both support this natively) so network retries never double-charge.

### 6.5 Currency & tax
- Multi-currency support: amounts stored in minor units of the transaction currency; a separate `exchange_rates` cache (refreshed hourly) is used only for admin-facing reporting normalization to a base currency (e.g., USD).
- Tax calculated via a tax engine integration (e.g., Stripe Tax) based on billing address; tax amount stored explicitly on the invoice — never baked silently into the price.

### 6.6 Platform-specific payment rules (CRITICAL)

> This is the single most important constraint introduced by going cross-platform. Getting it wrong will get the apps **rejected or removed** from the App Store / Play Store.

Apple and Google **require** that digital goods consumed inside their apps (your Credits are digital goods) be purchased through **their** in-app purchase (IAP) systems. You **cannot** use Stripe/Razorpay/PayPal for credit purchases *inside* the iOS or Android app, and you generally cannot even link out to a web purchase from within those apps (rules vary and are changing via regulation — see below).

| Platform | Allowed for buying Credits | Store fee | Notes |
|---|---|---|---|
| iOS app | **Apple IAP only** (StoreKit 2) | 15–30% | 15% under App Store Small Business Program (<$1M/yr) |
| Android app | **Google Play Billing only** | 15–30% | 15% on first $1M/yr per developer |
| Web (all OS) | Stripe / Razorpay / PayPal / UPI etc. | ~2–3% | Full freedom |
| Windows desktop app | Stripe/etc. directly (or MS Store IAP if distributed via MS Store) | ~2–3% | If sideloaded/direct-download, no store cut |
| macOS desktop app | Stripe/etc. if distributed outside Mac App Store; **Apple IAP** if inside Mac App Store | 0 vs 15–30% | Direct download avoids Apple's cut |

**Architectural consequences:**
- The `payments.gateway` enum must be extended to include `apple_iap` and `google_play_billing`.
- Each mobile store sends **server-to-server purchase notifications** (Apple App Store Server Notifications v2, Google Play Real-time Developer Notifications via Pub/Sub). These are handled exactly like webhooks in §6.2: verify signature (Apple: JWS/JWT; Google: Pub/Sub + Play Developer API validation), dedupe on the store's transaction ID, then credit the wallet.
- **Credit conversion rate may differ per platform** because the store fee eats margin. The Cost/Profit engine must know which gateway a purchase came through so profit is calculated on the *net* amount received (after Apple/Google's cut), not the gross price the user paid.
- **Purchases are portable across platforms.** Credits bought via Apple IAP on iPhone are spendable on Windows/web — because the wallet is server-side and platform-agnostic. Only the *purchase channel* is platform-restricted, not the balance.
- Restore-purchases flow required on mobile (StoreKit `Transaction.currentEntitlements` / Play Billing `queryPurchases`) so users who reinstall recover entitlements.
- **Regulatory watch:** the EU Digital Markets Act and various court rulings are loosening the "IAP-only" rule (external purchase links, alternative billing). Build the store adapters behind the same `PaymentGatewayAdapter` interface so you can enable web-checkout-from-app per region if/when legally allowed, without re-architecting.

**Subscriptions** follow the same rule: subscription plans sold inside iOS/Android use Apple/Google auto-renewable subscriptions; web/desktop-direct use Stripe Billing. The `subscriptions.gateway_subscription_id` already supports either.

---

## 7. Refunds & Disputes

- Only Super Admin (with `billing:refund` permission) can initiate a refund; every refund requires a reason code and is logged in `audit_logs` with before/after payment state.
- Partial refunds supported; corresponding credits are **clawed back** via a new `usage_debit`/`adjustment` ledger entry (never delete history).
- Chargebacks/disputes ingested via gateway webhooks (`charge.dispute.created`) automatically flag the user account for fraud review and freeze further recharges pending investigation.

---

## 8. Subscription Billing

- Subscriptions are billed by the gateway's native subscription/recurring-billing product (Stripe Billing / Razorpay Subscriptions) — AI CreatorForce does not hand-roll recurring card charges.
- On `invoice.payment_succeeded` webhook: grant that period's monthly credit allotment (a `bonus`-type ledger entry scoped as `subscription_grant`), reset any "unused monthly credit" rollover rules per plan config.
- Plan changes (upgrade/downgrade) are prorated by the gateway; local `subscriptions` row updated on the corresponding webhook, never optimistically before confirmation.
- Cancellation: `cancel_at_period_end = true` by default (no forced immediate loss of paid-for period).

---

## 9. Security & Privacy Architecture

### 9.1 Guiding principles
- **Least privilege** everywhere — services, admins, and API keys only get the exact permissions they need.
- **Defense in depth** — no single control is trusted alone (network, app, data layers each enforce security independently).
- **Fail closed** — on any ambiguity in a payment or auth decision, the system denies the action rather than allowing it.
- **Privacy by design** — collect the minimum PII required; encrypt or tokenize the rest; make deletion/export possible from day one.

### 9.2 AuthN / AuthZ
- User authentication via OAuth2/OIDC + short-lived JWT access tokens (15 min) + rotating refresh tokens (httpOnly, secure, SameSite=strict cookies).
- **Mandatory 2FA** for all Super Admin accounts (TOTP or WebAuthn); optional but encouraged for regular users, and auto-recommended after large purchases.
- **RBAC** with explicit permission strings (e.g., `billing:view`, `billing:refund`, `admin:impersonate`) — roles are compositions of permissions, never hardcoded checks like `if (user.email === "owner@...")`. Super Admin emails/roles are configurable via env var or a `super_admins` DB table, never hardcoded in source.
- Session management: server-side session/refresh-token revocation list in Redis so any session can be force-logged-out instantly (e.g., on suspicious activity or admin suspension).
- Optional IP allow-listing for Super Admin panel access, configurable per admin account.

### 9.3 Data protection
- **Encryption in transit:** TLS 1.3 everywhere, HSTS enforced, internal service-to-service traffic on a private network/mTLS.
- **Encryption at rest:**
  - Database-level encryption (AES-256) for the whole disk/volume.
  - **Column-level (application-level) encryption** for high-sensitivity fields — email, phone, billing address, KYC documents — using envelope encryption (data encryption key per record, wrapped by a master key in a KMS/Secrets Manager). This protects data even if a DB backup leaks.
  - Provider API keys and gateway secrets live **only** in a Secrets Manager (AWS Secrets Manager / HashiCorp Vault), never in `.env` files committed to source control, never in logs.
- **Key rotation:** automated rotation schedule (e.g., 90 days) for provider API keys and encryption keys, with zero-downtime dual-key overlap during rotation.
- **Secrets never logged:** structured logging middleware automatically redacts known sensitive field names (`password`, `token`, `card`, `secret`, `apiKey`) before anything is written to logs.
- **PII minimization:** raw gateway webhook payloads (which may contain card metadata) are stored as encrypted blobs referenced by pointer, not inlined into searchable tables.

### 9.4 Application security
- Centralized input validation/schema enforcement (e.g., Zod/JSON Schema) at every API boundary; reject unknown fields.
- Parameterized queries / ORM only — no raw string-concatenated SQL, eliminating SQL injection risk.
- CSRF protection on all state-changing browser-originated requests (double-submit token or SameSite cookies + custom header check).
- Strict Content-Security-Policy, X-Frame-Options=DENY, X-Content-Type-Options=nosniff on all admin panel responses.
- Dependency scanning (Dependabot/Snyk) and SAST in CI; block merges on critical vulnerabilities.
- Web Application Firewall (WAF) in front of the API Gateway; automatic blocking of known bad IP ranges and basic bot patterns.

### 9.5 Rate limiting & fraud detection
- Per-user and per-IP rate limits on auth, recharge, and coupon-redemption endpoints (sliding window in Redis).
- Velocity checks: multiple failed payments, rapid-fire recharges from new accounts, or many accounts sharing one payment method trigger the **Fraud Service**, which can auto-flag, soft-block recharges, or require manual admin review.
- Referral program abuse detection: same device fingerprint / IP / payment method across "different" referred accounts is flagged before rewards are paid out.
- Anomaly alerts (e.g., sudden spike in refund rate, unusual admin impersonation frequency) routed to a security on-call channel.

### 9.6 Admin impersonation controls
- Impersonation requires explicit permission `admin:impersonate`, a mandatory reason field, and time-boxed sessions (auto-expire, e.g., 30 minutes).
- Every impersonation session is fully audit-logged (who, whom, when, why, what actions taken while impersonating) and the impersonated user is notified after the fact.
- Impersonation sessions **cannot** initiate payments, refunds, or change the user's payment methods — read/support actions only, enforced at the permission layer, not just UI hiding.

### 9.7 Audit logging
- Every Super Admin action (view, export, refund, plan change, impersonation, API key change) is written to the append-only `audit_logs` table synchronously before the action's effects are considered complete for sensitive operations (refunds, key rotation, user deletion).
- Logs are shipped to a separate, access-restricted SIEM/log store (different credentials than the app DB) so a compromised app server can't erase its own trail.
- Regular automated audit-log integrity checks (hash chaining or write-once storage) to detect tampering.

### 9.8 Privacy & compliance
- **Data subject rights:** self-service "export my data" and "delete my account" flows (GDPR/CCPA-style). Deletion is a soft-delete + PII-scrubbing job that anonymizes rows while preserving financial records required for tax/audit law (billing history is retained but de-identified where legally permissible).
- **Consent & disclosure:** clear privacy policy covering what's collected, why, and which third parties (payment gateways, AI providers) receive data, with explicit consent capture timestamped in the DB.
- **Data residency:** configurable per-region data storage (e.g., EU customer data in an EU region) if operating under GDPR.
- **Vendor risk:** all third-party processors (Stripe, Razorpay, AI providers) reviewed for their own compliance certifications (PCI-DSS, SOC 2) before integration; Data Processing Agreements (DPAs) executed where required.
- **Breach response plan:** documented incident-response runbook with defined notification timelines matching applicable law (e.g., 72 hours under GDPR).

### 9.9 Secrets & environment configuration
- No secrets in source control — enforced via pre-commit hook + CI secret-scanning (e.g., gitleaks).
- Per-environment (dev/staging/prod) isolated secrets and API keys; production secrets accessible only to the deployment pipeline and a minimal on-call admin group, never to individual developer laptops.
- Super Admin email allow-list configurable via `SUPER_ADMIN_EMAILS` env var **or** a `super_admins` table (DB takes precedence if present) — never hardcoded.

---

## 10. API Design (Billing & Payment Surface)

```
POST   /v1/wallet/recharge                 # start a recharge (returns gateway intent)
POST   /v1/wallet/reserve                  # soft-hold credits before an AI request
POST   /v1/wallet/settle                   # commit/release a reservation
GET    /v1/wallet/balance
GET    /v1/wallet/transactions

POST   /v1/payments/webhook/:gateway       # gateway webhook receiver (signature-verified)
GET    /v1/payments/:id
POST   /v1/payments/:id/refund             # admin only

GET    /v1/invoices
GET    /v1/invoices/:id/pdf                # short-lived signed URL

POST   /v1/subscriptions
PATCH  /v1/subscriptions/:id                # upgrade/downgrade/cancel
GET    /v1/subscriptions/:id

POST   /v1/coupons/redeem
GET    /v1/coupons/:code/validate

# Super Admin only (RBAC-enforced)
GET    /v1/admin/billing/revenue
GET    /v1/admin/billing/profit
POST   /v1/admin/users/:id/impersonate
POST   /v1/admin/api-keys                  # rotate/add provider keys
GET    /v1/admin/audit-logs
```

Every mutating endpoint requires an `Idempotency-Key` header; the server persists a mapping of key → response for at least 24 hours and replays the original response on retry instead of re-executing.

---

## 11. Background Jobs

| Job | Frequency | Purpose |
|---|---|---|
| `credit-expiry-job` | daily | expire bonus/promo credits per policy |
| `ledger-reconciliation-job` | nightly | verify wallet cache == ledger sum |
| `gateway-settlement-reconciliation` | daily | match internal payments vs gateway settlement reports |
| `subscription-renewal-job` | hourly | handle upcoming renewals, dunning emails |
| `invoice-numbering-job` | on-demand (transactional) | generate sequential, gap-free invoice numbers |
| `fraud-scan-job` | every 15 min | velocity/anomaly checks on new payments |
| `webhook-retry-sweeper` | every 5 min | reprocess failed webhook queue entries |
| `audit-log-shipper` | streaming | ships audit logs to SIEM in near real time |

---

## 12. Caching Strategy

- Redis for: idempotency-key store, rate-limit counters, wallet balance read-cache (write-through, ledger remains source of truth), session/refresh-token revocation list.
- Cache invalidated immediately on any ledger write (same transaction, via outbox pattern) — never rely on TTL alone for financial data.

---

## 13. Error Handling

- All payment/billing errors use a structured error taxonomy (`INSUFFICIENT_CREDITS`, `PAYMENT_DECLINED`, `GATEWAY_TIMEOUT`, `IDEMPOTENCY_CONFLICT`, `FRAUD_HOLD`) — never leak raw gateway/database error strings to clients.
- Any error during a multi-step financial flow (e.g., payment succeeded but credit grant failed) triggers automatic compensation: the system retries the credit grant from the durable event log rather than silently losing the transaction. A `payment.orphaned` alert fires if unresolved after 3 retries, for manual reconciliation.

---

## 14. Scalability

- Stateless services behind horizontal auto-scaling; wallet writes use row-level locking scoped to a single wallet, so contention is per-user, not global.
- Ledger table partitioned by month for write/query performance at scale (millions of users).
- Read replicas for analytics/reporting queries so they never contend with the transactional billing path.
- Event-driven architecture (Kafka/SQS) decouples webhook ingestion from processing, absorbing traffic spikes.

---

## 15. Testing Strategy

- **Unit tests:** ledger math, credit-priority-of-expiry logic, cost/profit calculations.
- **Contract tests:** each gateway adapter tested against the gateway's official sandbox/test-mode.
- **Idempotency tests:** replaying the same webhook/request N times must produce exactly one effect.
- **Chaos/failure tests:** simulate gateway timeout mid-transaction, DB connection loss after payment success but before credit grant — verify compensation logic.
- **Security tests:** automated penetration testing on auth, webhook signature bypass attempts, RBAC boundary tests (e.g., non-admin hitting `/admin/*` must always 403).
- **Load tests:** simulate concurrent recharges on the same wallet to verify locking prevents lost updates or double-crediting.

---

## 16. Acceptance Criteria

- [ ] No raw card data ever stored or logged by AI CreatorForce servers (SAQ-A maintained).
- [ ] Every credit balance is reconstructable from `credit_ledger` alone.
- [ ] Duplicate webhook delivery or duplicate client request never results in double-crediting or double-charging.
- [ ] Every Super Admin sensitive action appears in `audit_logs` with actor, before/after state, and timestamp.
- [ ] Super Admin identity is never hardcoded in source code.
- [ ] All provider API keys and gateway secrets live in a secrets manager, not in code or plain env files in the repo.
- [ ] A refund correctly claws back the corresponding credits and is fully audit-logged.
- [ ] A user can export and delete their personal data via self-service flow.
- [ ] System correctly handles a failed subscription payment via grace period → downgrade without data loss.
- [ ] Credit purchases inside iOS/Android apps go exclusively through Apple IAP / Google Play Billing (store-compliant); web/desktop-direct use standard gateways.
- [ ] Profit is calculated on the **net** amount received after store fees, and the source gateway is recorded on every payment.
- [ ] Credits purchased on any platform are spendable on every other platform (single server-side wallet).

---

## 17. Future Enhancements

- Support for stablecoin/crypto payments via a plugin gateway adapter.
- Real-time fraud scoring model (ML-based) replacing rule-based velocity checks.
- Automated tax-jurisdiction detection and filing integration.
- Multi-entity billing (for enterprise customers with sub-teams and consolidated invoicing).
- Configurable data-residency per customer for stricter regional compliance needs.

---

*End of specification.*
