# monetization-framework.md — AI CreatorForce

This document covers two senses of "monetization": (A) how **AI CreatorForce as a business** earns revenue and controls cost, and (B) how the platform protects the **creator's** YouTube monetization (covered primarily in `compliance.md`).

---

## Part A — Platform Business Model

### A1. Plans

| Tier | Audience | Typical limits (illustrative — confirm at pricing time) |
|------|----------|---------------------------------------------------------|
| Free | Trial/eval | A few projects/month, limited tokens, no asset generation credits, watermark on exports |
| Creator | Solo creators | Higher project & token limits, basic music/video/thumbnail credits, 1 channel |
| Pro | Power creators | Large limits, more generation credits, multiple channels, MFA, priority queue |
| Agency | Teams/agencies | Many channels, team RBAC, pooled credits, webhooks, SSO, audit export |

Pricing is subscription (Stripe) + metered overage on generation credits. Final numbers set at launch; do not hardcode prices—store in config/Stripe.

### A2. Billing (Stripe)

- Subscriptions via Stripe Billing; metered usage reported for overage (tokens, video credits, music credits).
- Checkout + Customer Portal via Stripe-hosted flows.
- Webhooks (signature-verified) keep `subscriptions` table in sync (`active`, `past_due`, `canceled`, `currentPeriodEnd`).
- We store only Stripe references (`stripeCustomerId`, `stripeSubId`)—no card data (PCI scope minimized).

### A3. Cost Drivers (what we pay for)

| Driver | Source | Control |
|--------|--------|---------|
| LLM tokens | Claude/OpenAI/Gemini | Per-agent model assignment, caching, prompt efficiency |
| Video generation | Veo/Kling/Runway/Pika/Luma | Per-clip credits, plan caps, creator-initiated only |
| Music generation | Suno/Udio/Stable Audio | Per-track credits, plan caps |
| Storage/egress | Cloudflare R2 | Lifecycle policies, dedupe |
| Compute | AWS | Autoscaling workers, queue-based batching |
| YouTube/Trends data | APIs | Caching to respect quotas/rate limits |

### A4. Margin Protection

- **Budget enforcement before dispatch:** every AI/video/music job checks remaining plan budget; insufficient → `BUDGET_EXCEEDED` (no spend).
- **Metering:** `usage_records` tracks tokens/credits/cost per user per period; `jobs.costUsd` records per-job cost.
- **Model tiering:** cheap models for high-volume tasks; expensive reasoning models only where needed.
- **Caching:** trend/SEO/research lookups cached in Redis to cut repeat provider calls.
- **Alerts:** Grafana alerts on budget burn rate and per-user anomalies.

### A5. Usage Metering Flow

```
Request → check plan budget (Redis counter + DB) 
   → if ok: reserve estimated cost → dispatch job
   → on completion: record actual costUsd, decrement budget
   → if over: block further generation, prompt upgrade/overage
```

---

## Part B — Protecting the Creator's Monetization

The platform's core value is keeping creators **eligible to earn on YouTube**. This is enforced by the Compliance Intelligence Engine and the publish gates.

### B1. Monetization Safety Outputs

For every project, before any production spend, the creator sees:
- `monetizationRisk` (low/medium/high)
- `advertiserFriendly` (yes/no) with specific concerns
- `copyrightRisk` (low/medium/high)
- Concrete remediation guidance to reach "pass"

### B2. Advertiser-Friendly Guidance

The platform helps creators stay advertiser-friendly by flagging sensitive content categories and suggesting framing that preserves ad eligibility, per current YouTube advertiser-friendly guidelines (verify at build time). It never coaches creators to hide policy-violating content.

### B3. Originality & Reused-Content Protection

Because YouTube monetization depends on original, value-added content, the platform:
- Enforces the human-value checklist.
- Detects templated/mass-duplicated patterns.
- Encourages creator voice profiles and original commentary.

### B4. Disclosure = Monetization Safety

Proper AI/synthetic-media disclosure protects against policy action. `MetadataAgent` applies disclosures automatically based on the compliance assessment.

### B5. What the Platform Will Not Do

- Will not optimize for engagement bait that risks demonetization.
- Will not help evade copyright, disclosure, or advertiser-friendly rules.
- Will not mass-produce content that would trigger inauthentic/reused-content enforcement.

---

## Part C — Unit Economics Notes (for planning)

- Track **cost-to-serve per published video** (sum of token + generation + storage cost).
- Target gross margin per tier; surface in internal dashboards.
- Generation credits priced above provider cost to preserve margin on overage.
- Cohort analysis: published-videos-per-active-user, retention, expansion to higher tiers.

(Concrete pricing, credit ratios, and margins are set at launch and stored in config/Stripe, not hardcoded. See `roadmap.md` for go-to-market phasing.)
