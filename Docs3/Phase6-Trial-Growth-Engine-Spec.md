# AI CreatorForce — Phase 6: Free Trial, Growth Engine & Credit Economy
## Implementation-Ready Specification (v1.0)

> **Extends, does not redesign.** Builds on the already-implemented base (`AI-CreatorForce-Billing-Payment-Security-Spec.md`, `Platform-Deployment-Domain-Spec.md`) and the Phase 5 enterprise layer (`Phase5-Enterprise-Extensions-Spec.md`). Content covered there is referenced, not repeated.
>
> **Already implemented — reused as-is:** Wallet, Credit Ledger, Credit Lots, Credit Expiry, Recharge, Payments (Stripe + Apple/Google IAP), Refunds, RBAC, Audit Logs, Billing Jobs, Token Tracking, base Security & Fraud, Super Admin dashboard.
>
> **Provided by Phase 5 — reused here:** Pricing Engine, **Profit Protection Engine**, AI Routing, Provider Management, enterprise Analytics/BI, token/response caching. This document does **not** redefine the profit engine — every offer/reward below is gated by it.
>
> **New in Phase 6 (this document):** Free Trial System, Trial Abuse Prevention, Trial Usage Restrictions, Smart Upgrade Engine, First-Recharge Rewards, Smart Offer Engine, Referral & Invite Program, Credit Marketplace, Wallet display enhancements, trial/conversion analytics.

---

## 1. Executive Summary

Phase 6 is the **growth layer**: it lets new users try the platform risk-free, stops abuse of that free tier, nudges users to convert based on their actual behavior, rewards their first and repeat recharges, and pays users to invite others — all while the Phase 5 **Profit Protection Engine** guarantees nothing is ever given away below margin.

The credit economy stays exactly as built: one server-side wallet, one append-only ledger. Trial credits are simply a **new credit lot type** with their own source, expiry, and consume-first priority — no new balance mechanics.

---

## 2. Architecture Additions

```
        ┌──────────────────────────────────────────┐
        │           Existing Core (unchanged)         │
        │  Wallet · Ledger · Credit Lots · Payments    │
        │  Phase 5: Pricing · Profit Engine · Routing   │
        └──────────────────┬───────────────────────────┘
                           │ (published interfaces only)
   ┌───────────────────────┼───────────────────────────────┐
   ▼                       ▼                                 ▼
┌────────────┐    ┌──────────────────┐            ┌────────────────────┐
│ Trial Svc    │    │ Offer Engine       │            │ Referral Svc         │
│ grant/limit  │───►│ (behavior-driven,  │◄───────────│ codes · rewards ·    │
│ /expiry      │    │  profit-gated)      │            │ leaderboard · fraud  │
└─────┬──────┘    └────────┬─────────┘            └────────────────────┘
      │                     │
      ▼                     ▼
┌────────────┐    ┌──────────────────┐
│ Behavior     │    │ Upgrade Engine     │
│ Tracker      │───►│ (recommendations)   │
└────────────┘    └──────────────────┘
      │
      ▼
┌────────────────────────┐
│ Abuse/Fraud (extends      │  device+browser fingerprint, IP, VPN,
│ base fraud service)        │  risk score, manual review
└────────────────────────┘
```

Trial credits, bonus credits, referral credits, and promo credits are all **credit lots** in the existing system, differentiated by `source` and consume-order priority. The Offer Engine calls the **Phase 5 Profit Protection Engine** before issuing anything.

---

## 3. Folder Structure (additions only)

```
/apps
  /trial-service            # trial wallet grant, restrictions, expiry
  /offer-engine-service     # behavior-driven, profit-gated offers
  /upgrade-engine-service   # conversion recommendations
  /referral-service         # codes, rewards, leaderboard, fraud
  /marketplace-service      # credit packs, regional pricing
  /behavior-tracker-service # events → user behaviour profile
/packages
  /shared-fingerprint       # device/browser fingerprint helpers
  /shared-offer-rules       # rule DSL types
```

---

## 4. Database Schema (new tables only)

### 4.1 Trial credits — reuse, don't reinvent
Trial credits are **credit lots** in the existing `credit_ledger`/lot system with `source = 'trial'`. No separate balance store. Add a lightweight tracking table:

**`trial_grants`**
`id, user_id FK, credits_granted, credits_remaining, granted_at, expires_at, status(active/expired/converted/revoked), verification_method, device_fingerprint, ip_hash` — enforces **one trial per verified user** via a unique constraint on a verified-identity key (see §6).

### 4.2 `trial_limits` (Super-Admin configurable feature gating)
`id, feature(enum: ai_chat,image,video,voice,music,large_models,premium_models,api_access,priority_queue,export_watermark,max_projects,max_upload_mb,daily_requests), access(enum: enabled,limited,disabled), limit_value(int nullable)` — a single active config row-set defines the trial tier.

### 4.3 `credit_packs` (Marketplace)
`id, name, credits, base_price, currency, region nullable, plan_restriction nullable, is_enterprise(bool), is_active, sort_order` — regional pricing via multiple rows keyed by `region`/`currency`.

### 4.4 `offers`
`id, type(enum: welcome,first_recharge,festival,weekend,happy_hour,referral,loyalty,winback,upgrade,birthday,anniversary,low_credit), target_rule(jsonb), reward_type(enum: bonus_credits,discount_pct,discount_flat,free_premium_days,free_upgrade), reward_value, min_recharge nullable, valid_from, valid_to, usage_limit, per_user_limit, region nullable, profit_checked(bool), status`

### 4.5 `offer_redemptions`
`id, offer_id FK, user_id FK, payment_id FK nullable, reward_granted, idempotency_key unique, created_at` — unique key prevents duplicate bonus (Revenue Protection §12).

### 4.6 `referral_codes`
`id, user_id FK, code unique, uses_count, created_at, is_active`

### 4.7 `referrals`
`id, referrer_id FK, referred_id FK unique, code_id FK, referrer_reward, referred_reward, milestone_level, status(pending/qualified/rewarded/flagged), device_fingerprint, ip_hash, created_at` — `referred_id` unique = a user can only be referred once.

### 4.8 `referral_rewards`
`id, referral_id FK, beneficiary_id FK, reward_type, reward_value, ledger_entry_id FK, created_at`

### 4.9 `user_behaviour` (drives Upgrade + Offer engines)
`id, user_id FK, images_generated, videos_generated, chats_sent, voice_minutes, music_tracks, last_active_at, inactive_days, heavy_features(text[]), trial_credits_used_pct, updated_at` — updated by the behavior tracker from usage events; kept small and denormalized for fast rule evaluation.

### 4.10 `upgrade_recommendations`
`id, user_id FK, recommended_plan_id FK, reason_code, confidence, shown_at, dismissed_at, converted(bool)`

### 4.11 `abuse_signals` (extends base fraud)
`id, user_id FK, device_fingerprint, browser_fingerprint, ip_hash, is_vpn(bool), duplicate_device(bool), fraud_score, risk_score, decision(enum: allow,review,block), reviewed_by nullable, created_at`

---

## 5. Free Trial System (Module 1)

- On signup, the Trial Service creates a **trial credit lot** (`source='trial'`) via the existing wallet/ledger API and a `trial_grants` row. Default 100 credits, **Super-Admin configurable**.
- Trial credits are **stored as their own lot**, never merged with purchased credits, and are **consumed first** (extends the existing consume-order: trial → promo → bonus → referral → purchased).
- Configurable expiry (7/15/30 days) via the existing credit-expiry mechanism; bonus/promo still expire before purchased, trial before all.
- Dashboard shows remaining trial credits and an expiry countdown (Trial Status Card, §11).
- **One trial per verified user** — enforced at grant time by the unique verified-identity key and the abuse checks in §6. Unverified signups get the trial only after passing verification.
- Notifications (via existing notification system): welcome-credits-granted, trial-almost-exhausted (configurable %), trial-expiring (configurable days before).

**Trial flow**
```
Signup → verify identity (§6) → abuse check → if allow: grant trial lot + trial_grants row
       → user consumes trial-first → on low/expiry: notify + trigger Upgrade Engine (§8)
       → on first recharge: mark trial 'converted', apply First-Recharge Reward (§9)
```

---

## 6. Trial Abuse Prevention (Module 2)

Stops unlimited free accounts. **Everything configurable.** Extends the base fraud service; does not replace it.

- **Identity verification** (any/all, Super-Admin configurable): email verification, OTP, phone (optional), and social logins — **Google, GitHub, Microsoft** — via OAuth/OIDC (base spec §9.2).
- **Fingerprinting:** device fingerprint + browser fingerprint captured client-side, stored **hashed**. Duplicate-device detection flags many "accounts" from one device.
- **Network signals:** IP monitoring (hashed), rate limiting on signup/trial-grant, optional **VPN detection**.
- **Scoring:** a `fraud_score` + `risk_score` combine the above; thresholds map to a decision: `allow`, `review` (manual queue), or `block`. **Super-Admin override** always available.
- The unique verified-identity key on `trial_grants` is the hard backstop: even if scoring passes, the same verified identity cannot get a second trial.
- All decisions written to `abuse_signals` and audit-logged. Fail-closed: ambiguous high-risk signups get `review`, not an automatic grant.

---

## 7. Trial Usage Restrictions (Module 3)

The Trial Service reads the active `trial_limits` config and enforces it at the wallet-reserve / feature-gate step (so limits can't be bypassed client-side):

Example default tier — AI Chat: enabled; Image/Video/Voice/Music: limited; Large & Premium models: disabled; API access: disabled; Priority queue: disabled; Export watermark: on; Max projects / max upload size / daily AI requests: configurable numeric caps.

Enforcement is server-side and Super-Admin configurable; disabled features return a clear "upgrade to unlock" response that the Upgrade Engine can act on.

---

## 8. Smart Upgrade Engine (Module 4)

Behavior-driven, non-intrusive conversion nudges built on `user_behaviour`:

| Trigger (from behavior tracker) | Recommendation |
|---|---|
| Low trial credits | Show upgrade banner |
| Trial expiring soon | Offer bonus credits (via Offer Engine, profit-gated) |
| Generated 20+ images | Recommend Creator plan |
| Heavy chat usage | Recommend Professional plan |
| Video-heavy usage | Recommend Video bundle |

- Rules evaluate on usage events, not on a fixed schedule, so nudges match real behavior.
- Recommendations are recorded in `upgrade_recommendations` with a reason code; frequency-capped so they're never intrusive (configurable cooldown, respect dismissals).
- Any credit reward attached to an upgrade nudge goes through the Offer Engine → **Profit Protection Engine** first.

---

## 9. First-Recharge Rewards (Module 5)

Configurable `offers` of type `first_recharge`, keyed on `min_recharge`. Examples (rules configurable): ₹500 → +100 bonus credits; ₹1000 → +250; ₹2500 → +800; ₹5000 → premium trial.

- Applied during the recharge flow (base spec §5.2): after payment succeeds, if the user has no prior successful payment, match the highest-threshold `first_recharge` offer they qualify for and grant a **bonus credit lot**.
- Every grant is idempotent (`offer_redemptions.idempotency_key`) so a retried webhook never double-grants (Revenue Protection §14).
- The bonus amount is validated by the Profit Protection Engine before the offer is even allowed to exist.

---

## 10. Smart Offer & Referral Engines (Modules 6 & 7)

### 10.1 Offer Engine
Generates offers automatically from `user_behaviour`, recharge history, remaining credits, subscription, country, season/festival, birthday/anniversary, and inactive days. Offer types: welcome, festival, weekend, happy-hour, referral, loyalty, win-back, upgrade, low-credit.

**Hard rule (delegated to Phase 5):** before any offer is created or shown, the **Profit Protection Engine** must confirm the expected outcome stays at/above the configured minimum margin, using historical per-user usage to predict consumption. Losing offers are auto-rejected and the rejection is logged. This document does not re-implement the margin math — it consumes the Phase 5 engine.

Offers surface in the Offer Center (§11); redemptions are idempotent and audit-logged.

### 10.2 Referral & Invite Program
- Each user gets a unique `referral_code`. A referred user can only be referred once (`referrals.referred_id` unique).
- **Rewards for both sides:** referrer bonus + friend bonus, free premium days, and **milestone rewards** (e.g., every N qualified referrals → larger reward). All reward values profit-checked.
- **Qualification gate:** a referral becomes `qualified` (and pays out) only after the referred user completes a real action (e.g., first recharge or meaningful usage) — not merely on signup — which blocks the most common abuse.
- **Fraud detection:** shared device fingerprint / IP / payment method across referrer and referred → `flagged`, reward withheld pending review (extends base + §6 signals).
- **Leaderboard & analytics:** ranked referrers, reward payout history, conversion of referred users — read from replicas.

---

## 11. Wallet Enhancements & User Billing Dashboard (Modules 9 & 10)

Purely additive **display** on top of the existing wallet — no new balance mechanics.

- **Wallet Card** breaks the single balance into its lots: purchased, trial, bonus, referral, promotional, plus expired, pending, and reserved (from the existing reserve→settle holds), with a **credit-expiry timeline** driven by lot expiry dates.
- **Billing Dashboard** aggregates existing data: wallet, balance, usage history, recharge history, invoices, subscription, offers, referral earnings, estimated AI cost, monthly usage, and project-wise usage (from ledger metadata).
- New UI cards only, existing UI kept: Trial Status Card, Wallet Card, Upgrade Center, Offer Center, Referral Center, Billing Dashboard.

---

## 12. Credit Marketplace (Module 8)

- Configurable `credit_packs` (100 → 10000 + enterprise packs).
- **Regional pricing** and multi-currency via per-region/-currency pack rows; the client is shown packs matching its region.
- Purchases flow through the existing recharge + payment path (base spec §5–6), including the **platform-specific rules** (Apple/Google IAP inside mobile apps) already defined — marketplace only defines *what* packs exist, not new payment plumbing.

---

## 13. Revenue Protection (Module 12)

Strict validation, most of it already guaranteed by the ledger design — Phase 6 makes the trial/offer/referral cases explicit:

- **No negative wallet:** reserve step rejects if insufficient (base spec §5.3).
- **No double credits / duplicate recharge / duplicate bonus / duplicate referral:** every grant carries an idempotency key (`offer_redemptions`, ledger `idempotency_key`); replays are no-ops.
- **No duplicate trial:** unique verified-identity key on `trial_grants` + abuse checks (§6).
- **No negative profit:** every reward passes the Phase 5 Profit Protection Engine.
- All enforced server-side; all violations attempts audit-logged.

---

## 14. Analytics (Module 14 — trial/conversion focus)

Complements Phase 5's enterprise/financial analytics with the growth funnel: trial users, **trial→paid conversion rate**, recharge rate, trial completion rate, retention, churn, ARPU, LTV, average credit consumption, most-popular features, top models. Runs on read replicas / aggregation jobs; feeds the Upgrade and Offer engines' effectiveness reporting.

---

## 15. Notifications (Module 15)

Reuses the existing notification system with new event types: welcome-credits-granted, trial-expiring, trial-almost-exhausted, credits-low, recharge-successful, offer-available, referral-reward, bonus-credits-granted, subscription-expiry. Delivered across web/mobile/email/push per the Platform spec.

---

## 16. Background Jobs (additions)

`trial-expiry-notify` (7/3/1-day + low-balance warnings), `trial-expiry-sweep` (expire trial lots), `behavior-aggregation` (usage events → `user_behaviour`), `offer-generation` (behavior-driven, each candidate profit-checked), `referral-qualification` (promote pending→qualified on trigger action), `referral-fraud-scan`. All idempotent, retryable, dead-lettered — same pattern as existing jobs.

---

## 17. API Design (new endpoints)

```
POST   /v1/trial/grant                 # internal, called on verified signup
GET    /v1/trial/status
GET    /v1/trial/limits                 # effective trial restrictions

GET    /v1/offers                       # offers available to me (profit-gated already)
POST   /v1/offers/:id/redeem            # idempotent

POST   /v1/referral/code                # get/create my code
POST   /v1/referral/redeem              # apply a code (once per user)
GET    /v1/referral/earnings
GET    /v1/referral/leaderboard

GET    /v1/upgrade/recommendations
POST   /v1/upgrade/recommendations/:id/dismiss

GET    /v1/marketplace/packs            # region-aware
POST   /v1/wallet/recharge              # existing path; packs feed amount

# Super Admin config
GET/PATCH  /v1/admin/trial-config        # trial credits, expiry, limits
GET/PATCH  /v1/admin/offer-rules
GET/PATCH  /v1/admin/referral-rules
GET/PATCH  /v1/admin/fraud-rules
GET        /v1/admin/analytics/conversion-funnel
```

All mutating endpoints carry the base spec's `Idempotency-Key`, RBAC, and audit rules.

---

## 18. Sequence Diagrams (key flows)

**Trial grant**
```
Client → Auth: signup + verify (email/OTP/social)
Auth → Abuse: score(device, browser, ip, vpn)
Abuse → Trial: allow | review | block
Trial → Wallet: create lot(source=trial, credits, expires_at)  [idempotent]
Trial → Notify: welcome-credits-granted
```

**First recharge + reward**
```
Client → Payment: recharge (existing flow)
Gateway → Payment: webhook success (idempotent)
Payment → Offer: first_recharge? match highest qualifying offer
Offer → Profit(Phase5): margin ok?  → yes
Offer → Wallet: grant bonus lot  [offer_redemptions idempotency_key]
Offer → Notify: bonus-credits-granted ; Trial: mark converted
```

**Referral payout**
```
Referred user → Referral: redeem code (once)
Referred user → Payment: qualifying action (e.g., first recharge)
Referral-qualification job → Fraud: shared device/ip/method? 
   flagged → withhold+review ; else → grant referrer + referred rewards (profit-checked, idempotent)
```

---

## 19. Testing Strategy (Phase 6 focus)

- **Trial:** exactly one trial per verified identity; trial credits consumed before all others; expiry sweeps the right lots; restrictions enforced server-side.
- **Abuse:** duplicate device/IP/VPN raises risk; block/review thresholds honored; admin override works; second-trial attempt always fails at the unique key even if scoring passes.
- **Offers/rewards:** replayed webhook never double-grants; every reward passes the profit engine; a below-margin offer never gets created.
- **Referral:** a user can be referred only once; reward pays only after qualification; shared-fingerprint referral is flagged.
- **Upgrade engine:** correct recommendation per behavior trigger; frequency cap + dismissal respected.

---

## 20. Developer Task Breakdown

1. Trial service: grant (trial lot), `trial_grants`, consume-first ordering, expiry notifications.
2. Abuse prevention: fingerprint capture (hashed), risk/fraud scoring, review queue, admin override — extend base fraud service.
3. Trial restrictions: `trial_limits` config + server-side feature gating.
4. Behavior tracker + `user_behaviour` aggregation.
5. Upgrade engine: rule evaluation, `upgrade_recommendations`, frequency capping.
6. Offer engine: rule DSL, generation job, **wire to Phase 5 profit engine**, redemption idempotency.
7. First-recharge rewards in the recharge flow.
8. Referral service: codes, qualification, milestone rewards, fraud, leaderboard.
9. Marketplace: `credit_packs` + regional pricing (reuse recharge/payment).
10. Wallet/dashboard UI cards (additive).
11. Conversion analytics + notifications.

---

## 21. Acceptance Criteria

- [ ] Every new verified user gets exactly one trial; trial credits are a separate lot, consumed first, never mixed with purchased.
- [ ] A second trial for the same verified identity is impossible (unique key + abuse checks).
- [ ] Trial feature restrictions are enforced server-side and fully Super-Admin configurable.
- [ ] Upgrade nudges are behavior-driven, frequency-capped, and never intrusive.
- [ ] First-recharge and all offers/referrals are idempotent (no duplicate bonus/referral) and pass the Phase 5 profit engine (no negative-profit rewards).
- [ ] Referral rewards pay only after a qualifying action and are withheld on shared-fingerprint fraud.
- [ ] Wallet card correctly displays all lot types (purchased/trial/bonus/referral/promo/expired/pending/reserved) with an expiry timeline.
- [ ] Credit-pack marketplace supports regional pricing and reuses the existing recharge/IAP payment path.
- [ ] No negative wallet, no double credit, no duplicate recharge/trial — enforced server-side and audit-logged.
- [ ] All existing billing modules remain backward compatible.

---

## 22. Implementation Roadmap

**Wave 1:** Trial service + abuse prevention + trial restrictions (the free-entry funnel).
**Wave 2:** Behavior tracker + Upgrade engine + First-recharge rewards (early conversion).
**Wave 3:** Offer engine (profit-gated) + Credit marketplace (monetization breadth).
**Wave 4:** Referral program + leaderboard (viral growth).
**Wave 5:** Wallet/dashboard UI + conversion analytics (visibility & optimization).

---

## 23. Future Enhancements

- ML-scored propensity-to-convert to prioritize which nudge/offer to show.
- Personalized dynamic offer values within profit bounds.
- Team/org trial pilots (enterprise trials) building on Phase 5 org billing.
- Localized festival/seasonal offer calendars per region.

---

*End of specification.*
