# monetization-framework.md — AI CreatorForce

This document covers two senses of "monetization": (A) how AI CreatorForce as a platform earns revenue and controls cost, and (B) how the platform protects the creator's YouTube monetization eligibility — the latter is primarily owned by `compliance.md`. Billing security and PII handling are in `security.md`.

---

## Part A — Platform Revenue Model

### A1. Subscription Tiers

Plans: FREE / STARTER / PRO / AGENCY. Managed via Stripe; the `Subscription` model stores `plan` (enum), `stripeCustomerId`, `stripeSubscriptionId`, and `status` (ACTIVE / PAST_DUE / CANCELLED / TRIALING). Final credit quotas and feature gates per tier are stored in Stripe and config — never hardcoded in application logic.

### A2. Credit System

All AI operations consume credits drawn from the user's (or org's) `Wallet`. Wallet bucket fields:

| Field | Meaning |
|-------|---------|
| `balanceCredits` | Current spendable balance (computed from ledger; treated as a read cache) |
| `purchasedCredits` | Credits from paid recharge packs |
| `bonusCredits` | Granted by the platform (promotions, goodwill) |
| `promotionalCredits` | Time-limited campaign grants |
| `referralCredits` | Earned through the referral program |
| `trialCredits` | Granted via `TrialGrant` on sign-up |
| `lifetimePurchased` | Monotonically increasing audit counter |
| `lifetimeUsed` | Monotonically increasing audit counter |

**Rule:** All credit mutations go through `WalletService`. Direct DB writes to wallet fields are forbidden.

### A3. Credit Recharge

`POST /wallet/recharge` — requires an `Idempotency-Key` header. Creates a Stripe Checkout session. On webhook confirmation, `BillingService` posts a PURCHASE entry to `CreditLedger` and creates a new `CreditLot`. The `Payment` model records the Stripe payment reference. Pre-defined recharge packs are identified by `packId` (see `marketplace.service.ts`).

### A4. Trial Credits

New users receive a `TrialGrant`. This populates the `trialCredits` bucket in `Wallet` and is consumed before all other credit types. `trial-limits.service.ts` enforces limits to prevent abuse. Device fingerprint captured at registration feeds into trial abuse scoring.

### A5. Referral Program

`ReferralCode` model tracks referral links. `POST /growth/referral/apply` adds a `referralCredits` lot to both the referrer's and the new user's wallets. Handled by `growth.controller.ts`.

### A6. Upgrade and Offer Flows

`upgrade-engine.service.ts` (planned automated upsell flows) and `offers.service.ts` (offer campaigns, in trial module) exist as service stubs. Marketplace UI (`marketplace.service.ts`) is a service-layer implementation without a published UI yet.

---

## Part B — Credit Ledger Design (Append-Only)

`CreditLedger` is the single source of truth for all credit history. Wallet bucket counters are derived read caches; they do not define balance.

### B1. Entry Types

| Entry type | Trigger |
|------------|---------|
| PURCHASE | Stripe webhook confirms payment |
| BONUS | Platform grants bonus credits |
| REFERRAL | Referral program payout |
| PROMO | Promotional campaign grant |
| TRIAL | Trial grant on sign-up |
| USAGE_DEBIT | AI/video/music job settled |
| REFUND | Credit returned after cancellation |
| EXPIRY | Lot expired; remaining set to 0 |
| ADJUSTMENT | Correction entry (see below) |

### B2. Immutability Rule

Corrections are always new ADJUSTMENT rows. Existing ledger rows are never UPDATEd or DELETEd. Every row carries an `idempotencyKey` (unique constraint) — safe to retry any grant or debit. Each row also carries a `balanceAfter` snapshot as an audit anchor.

---

## Part C — Credit Lots and Expiry Priority

Each credit grant creates a `CreditLot` with a `bucket` (matching the wallet field), an `amount`, a `remaining`, and an optional `expiresAt` (null = never expires).

Consumption order (most urgent first):

1. promotional — soonest `expiresAt` first
2. bonus
3. referral
4. trial
5. purchased — never expires, consumed last

When a lot expires: an EXPIRY ledger entry is posted and `lot.remaining` is set to 0. `GET /wallet/lots` returns active lots sorted by soonest-expiring first.

---

## Part D — Reserve-Settle Pattern

Before any AI job dispatches, `WalletService.reserve()` creates a `CreditReservation` (status = HELD) and reduces the spendable balance without touching the ledger. This prevents double-spend across concurrent jobs.

After the job completes, `WalletService.settle()` posts a USAGE_DEBIT to `CreditLedger` and transitions the reservation to SETTLED.

If the job crashes, the reservation remains HELD but expired HELD rows are ignored by balance math — crashed jobs cannot strand credits indefinitely. A background cleanup can RELEASE stale reservations.

---

## Part E — Organization Billing

The `Wallet` model is polymorphic: exactly one of `userId` or `orgId` is set. An org shared wallet has `orgId` set; all members of the org draw from it.

`BudgetPeriod` tracks `allocatedCredits`, `consumedCredits`, and `hardCap` per org and optionally per team within the org. `Project.billingOrgId`: when set, job credit reservations target the org's shared wallet instead of the initiating user's personal wallet.

---

## Part F — Budget Controls

- `Budget` model: per-user `monthlyLimit`, `alertThreshold`, `hardCap`.
- `POST /wallet/budget` to set or update.
- `BudgetService` enforces hard caps: operations are blocked (not just warned) when the hard cap is exceeded.
- `CreditInsightsService` provides spending analytics and trend data.

**Wallet endpoints:**

| Endpoint | Description |
|----------|-------------|
| `GET /wallet/balance` | Current spendable balance and bucket breakdown |
| `GET /wallet/transactions` | Paginated ledger history |
| `GET /wallet/lots` | Active lots, sorted soonest-expiring first |
| `POST /wallet/recharge` | Initiate Stripe Checkout (Idempotency-Key required) |
| `POST /wallet/budget` | Set or update budget controls |

---

## Part G — Fraud Controls

- `Wallet.rechargesFrozen`: set to `true` by Stripe dispute webhooks. Blocks all new recharges until cleared.
- Device fingerprint captured at registration for trial abuse scoring, enforced by `trial-limits.service.ts`.

---

## Part H — Creator YouTube Monetization

The platform's primary protection for creator monetization eligibility is the Compliance Intelligence Engine. `ComplianceAgent` enforces the ADVERTISER_FRIENDLY category check (score >= 70 required, no BLOCK flags). No content reaches the Publishing Engine without passing this gate. See `compliance.md` for full gate specification.

---

## Part I — Planned / Not Yet Implemented

- Credit pack marketplace UI (marketplace.service.ts exists as service layer only)
- Automated upgrade-engine upsell flows (upgrade-engine.service.ts is a stub)
- Offer campaigns UI (offers.service.ts exists in trial module)
- Multi-currency pricing
- Organization billing invoicing (BudgetPeriod model exists; invoice generation not implemented)
