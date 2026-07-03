# roadmap.md — AI CreatorForce

> Strategic timeline. Build mechanics live in `build.md`; this is the product/market view. Dates are relative milestones, not hard commitments.

## Vision Arc

From "AI script helper" → "complete AI workforce for compliant, original YouTube growth." Each milestone deepens the loop: discover → create → comply → produce → publish → learn → improve.

---

## Milestone 0 — Foundations (pre-MVP)
- Monorepo, infra scaffold, AI Client, schema, auth, YouTube connect.
- Compliance gate designed and tested first (it is the spine).
- Outcome: skeleton that can run one agent end-to-end safely.

## Milestone 1 — MVP (the core loop)
- Idea → Script → Fact-check → Compliance → Metadata → Publish (human-approved).
- Basic Trend/SEO/Audience. Asset *briefs* (manual external generation).
- Free + Creator plans, budget enforcement.
- **Success:** real creators publish original, compliant videos faster.

## Milestone 2 — Beta (assets + intelligence)
- In-app music/video/thumbnail generation with provenance.
- Analytics + Growth loop; creator dashboards.
- n8n long workflows with human checkpoints.
- Teams/RBAC, multiple channels, Pro plan, A/B thumbnails.
- **Success:** measurable CTR/retention improvement; full pipeline in one place.

## Milestone 3 — Public Launch (scale + agencies)
- Agency tier (many channels, pooled credits, webhooks, SSO, audit export, MFA).
- Scaling + quota-aware scheduling + provider load-balancing.
- Cost/margin dashboards, overage billing.
- DR, security hardening, pen test, marketing site, onboarding.
- **Success:** reliable at scale; sustainable unit economics.

## Milestone 4 — Post-Launch (depth & differentiation)
Candidate directions (prioritize by data):
- **Channel memory:** per-channel learning of what works, biasing recommendations (honestly).
- **Voice/brand consistency:** stronger voice profiles, brand kits across all assets.
- **Series & calendar:** plan multi-video series and publishing cadence.
- **Collaboration:** review threads, comments, role-based approvals.
- **More providers / formats:** podcasts→video, repurposing long-form into Shorts (originality-preserving).
- **Localization:** multi-language scripts/metadata with per-region SEO.
- **Marketplace (optional):** vetted prompt/style packs (compliance-screened).

## Explicit Non-Goals (kept stable across roadmap)
- No spam/content-farm tooling.
- No fully autonomous publish without prior human approval.
- No copyright/disclosure/advertiser-policy evasion.
- No fake-engagement features.

## Guiding Metrics by Phase
| Phase | North-star |
|-------|-----------|
| MVP | Time idea→publish; compliance first-pass rate |
| Beta | CTR/retention lift after 30 days; pipeline completion rate |
| Launch | Reliability (uptime, queue health); cost per published video; expansion to higher tiers |
| Post-launch | Creator retention; videos published per active user |

## Dependencies & Risks
- **Provider/policy volatility:** YouTube and AI/video/music providers change terms, quotas, pricing. The AI Client + config-driven model/provider selection + the living compliance rule set absorb this. Verify policies at each milestone.
- **Cost control:** generation costs can spike; budgets/metering/caching are launch-critical, not optional.
- **Quality bar:** originality and value are the brand; never trade them for throughput.
