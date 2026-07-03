# compliance.md — AI CreatorForce

> AI CreatorForce is built so that creators stay **monetizable and policy-compliant**. Compliance is a **hard gate**, not advisory. This document defines what the platform checks, how the gate works, and the invariants code must preserve.

> **Living policy note:** YouTube's policies evolve. The rules below reflect best practices and policy expectations as of June 2026. The `ComplianceAgent`'s rule set must be **reviewed and updated against current official YouTube policy** at build time and on a recurring schedule. Verify current policy before relying on any specific rule.

## 1. What "Compliant" Means Here

The platform optimizes for:
- **Original content** with genuine human-added value (not reused/duplicated/templated mass output).
- **Copyright safety** (no infringing footage, music, scripts, or images).
- **Monetization eligibility** (advertiser-friendly, within YouTube Partner Program rules).
- **Factual integrity** (claims sourced and verified).
- **Honest presentation** (titles/thumbnails match content; no deceptive metadata).
- **Required disclosures** (AI-generated/altered/synthetic media disclosed per policy).

## 2. The Compliance Gate

The `ComplianceAgent` runs after fact-checking and **before** asset production and publishing.

```
Script + Research + Metadata + Asset briefs
        │
        ▼
  ComplianceAgent
        │
   ┌────┴─────┬───────────┐
 pass       revise       block
   │          │            │
 continue   return to    stop;
 pipeline   creator w/    explain
            specific      reasons;
            fixes         no override
```

**Outputs:** `complianceScore (0–100)`, `monetizationRisk (low|med|high)`, `copyrightRisk (low|med|high)`, `advertiserFriendly (bool)`, `flags[] {code, severity, location, reason}`, `recommendation (pass|revise|block)`.

**Invariant:** there is **no code path** that advances a `block` to asset generation or publishing. (See `database.md` §5 and `claude.md` §2.)

## 3. Check Categories

### 3.1 Copyright
- No reproduction of third-party text, lyrics, or scripts. ResearchAgent paraphrases; ScriptAgent must not copy source wording.
- Music must be the creator's licensed/AI-generated work with provenance; no copyrighted tracks without rights.
- Video assets must be generated/licensed; no scraped or reused third-party footage.
- Thumbnails must not use third-party IP, logos, or identifiable faces without rights.
- Quotations, if any, must be short, attributed, and used transformatively.

### 3.2 Reused / Inauthentic Content
- Detect templated, mass-duplicated, or low-effort patterns that would fail YouTube's reused-content / inauthentic-content expectations.
- Enforce the **human-value checklist**: each project must include identifiable original commentary, analysis, narration, or creative arrangement.

### 3.3 Monetization & Advertiser-Friendliness
- Screen for content categories that limit/deny ads (e.g., graphic, hateful, dangerous, sexual, shocking, or otherwise non-advertiser-friendly material) per current YouTube advertiser-friendly guidelines.
- Flag borderline topics with guidance on how to make them ad-safe.
- Assess monetization risk level and surface it to the creator before production spend.

### 3.4 AI / Synthetic Media Disclosure
- Determine whether content uses AI-generated or significantly altered/synthetic media that requires disclosure under current YouTube rules.
- `MetadataAgent` applies the appropriate disclosure flags at publish.
- Never disguise synthetic media as authentic real-world footage where disclosure is required.

### 3.5 Misinformation & Factual Integrity
- Block unverified factual claims (via FactCheckAgent gate).
- Heightened scrutiny for sensitive categories (health, finance, elections, safety) — require strong sourcing.
- Refuse content designed to deceive or spread demonstrably false harmful claims.

### 3.6 Honest Metadata
- Titles/thumbnails must reflect actual content; flag clickbait that misrepresents.
- No engagement manipulation (fake giveaways, sub-for-sub schemes, deceptive practices).

### 3.7 Community Guidelines & Safety
- Screen against harassment, hate speech, dangerous acts, violent/graphic content, sexual content, child-safety risks, and other Community Guideline violations.
- Child-safety is treated with maximum caution: content directed at or featuring minors gets extra review; anything that could sexualize or endanger minors is hard-blocked, never "revised."

## 4. Severity & Decision Logic

| Condition | Result |
|-----------|--------|
| Any hard-block flag (child safety, clearly infringing, prohibited content) | `block` |
| High copyright or high monetization risk unresolved | `block` or `revise` (severity-dependent) |
| Missing required disclosure | `revise` (must add) before pass |
| Medium risks with clear remediation | `revise` with specific fixes |
| Only low risks, sourced claims, original value present | `pass` |

`complianceScore` is a composite; a passing score still cannot override a hard-block flag.

## 5. Re-review on Change (WF-7)

Any edit to script, metadata, or assets after a pass **invalidates** `compliancePassed` and `humanApproved`. The gate must run again. No "stale pass" can reach publish.

## 6. Human Oversight

- Compliance is AI-assisted but the **creator remains responsible** for their channel.
- Final human approval is required before publish.
- The platform surfaces reasons and remediation, never just a verdict.
- Compliance decisions are recorded in the audit log.

## 7. Platform Conduct (the product itself)

- The platform must not be usable as a spam/content-farm engine. Abuse signals (mass low-effort generation, disclosure evasion attempts) are monitored and rate/budget-limited.
- Provider ToS (AI, video, music, YouTube) are respected; provenance recorded.
- The platform does not facilitate circumventing YouTube's systems or policies.

## 8. Invariants for Code Agents

1. Never add a bypass around the compliance gate.
2. Never auto-resolve a hard-block flag.
3. Always re-run compliance after a post-approval edit.
4. Always store the bundle hash that a compliance report applies to.
5. Keep the rule set updated against current official YouTube policy; treat hardcoded policy details as needing periodic verification.
6. Treat child-safety flags as non-negotiable hard blocks.
