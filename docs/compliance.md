# compliance.md — AI CreatorForce

This document defines the compliance gate: what is checked, how pass/fail is determined, the code invariants that must never be bypassed, and the human approval step that sits between a compliance pass and a YouTube upload. Related reading: [security.md](security.md), [youtube-publishing.md](youtube-publishing.md), [agents.md](agents.md).

> AI CreatorForce is built so that creators stay **monetizable and policy-compliant**. Compliance is a **hard gate**, not advisory. This document defines what the platform checks, how the gate works, and the invariants code must preserve.

> **Living policy note:** YouTube's policies evolve. The rules below reflect best practices and policy expectations as of June 2026. The `ComplianceAgent`'s rule set must be **reviewed and updated against current official YouTube policy** at build time and on a recurring schedule. Verify current policy before relying on any specific rule.

---

## What the Gate Checks

`ComplianceAgent` audits content across nine categories. Each finding is a `ComplianceFlag` with a severity level.

| Category | Description |
|----------|-------------|
| `COPYRIGHT` | Potential use of third-party copyrighted material without licence. |
| `MISINFORMATION` | Factual claims that are unverified or contradicted by sourced research. |
| `HATE_SPEECH` | Content targeting individuals or groups based on protected characteristics. |
| `VIOLENCE` | Graphic or gratuitous violence. |
| `ADULT_CONTENT` | Sexually explicit or age-restricted material. |
| `SPAM` | Mass-produced, repetitive, or low-value templated output. |
| `IMPERSONATION` | Presenting content as from a person or channel it is not. |
| `PRIVACY` | Exposure of private personal information without consent. |
| `ADVERTISER_FRIENDLY` | Content that would be demonetized under YouTube's advertiser-friendly guidelines. |

**Flag severities:** `INFO` / `WARNING` / `CRITICAL` / `BLOCK`.

---

## Pass / Fail Rules

| Condition | Result |
|-----------|--------|
| Score >= 70 and no `BLOCK`-severity flags | **Passed** — content may proceed to the human approval step. |
| Score < 70 | **Not passed** — content is blocked from the publishing workflow regardless of flag severity. |
| Any `BLOCK`-severity flag | **Absolute block** — content is rejected regardless of score. |

---

## Gate Enforcement (ComplianceService)

`compliance.service.ts` is the single enforcement point for all content entering the publishing pipeline.

- **`check()`** — calls `callAIStructured` with `ComplianceResultSchema`. The AI response is validated against the Zod schema before any field is read. Returns a `ComplianceResult` with `score`, `passed`, and `flags[]`.
- **`enforce()`** — wraps `check()` with `mustPassCompliance()`. Throws `BadRequestException` if `passed` is `false`. This is the method that all publishing paths must call.
- **Content cache** — SHA-256 hash of normalized content (lowercased, trimmed title + script + description + tags). Two layers: a Redis shared cache (so multi-instance deployments never pay for the same audit twice; entries are Zod-validated on read — a corrupted entry is a miss, never a verdict) and an in-memory fallback (max 500 entries with LRU eviction, sole layer when Redis is down). Cache TTL is 24 hours (configurable via `COMPLIANCE_CACHE_TTL_MS` env var). Both layers are invalidated when a script is edited via `invalidate()`. The cache is a cost optimization only — `mustPassCompliance()` re-runs on every `enforce()` regardless of which layer served the result.
- **Result persistence** — `ComplianceResult` is stored in the database, linked to `AgentJob` via the unique `jobId` field. This provides a durable audit record for every compliance decision.

---

## Code Invariants (MUST NEVER Be Bypassed)

These invariants are non-negotiable. Any pull request that weakens them must not be merged without explicit documented sign-off in the PR body.

1. No content may reach `PublishingService` without a `ComplianceResult` with `passed = true` for the associated job.
2. No code path may skip `ComplianceService.enforce()` for content being published.
3. `ComplianceResultSchema` Zod validation must succeed before the result is trusted or acted upon.
4. `BLOCK`-severity flags must always cause rejection, regardless of the numeric score.

---

## Human Approval Gate

Compliance passing is necessary but not sufficient for publishing. After `ComplianceService.enforce()` succeeds, the system creates an `Approval` record with `status = PENDING` and an `expiresAt` timestamp.

A human must explicitly call `POST /approvals/:id/approve` to set `status = APPROVED`.

`PublishingService.publish()` performs a hard check on the `Approval` row:
- If no `Approval` row exists for the job → `ForbiddenException`.
- If `Approval.status` is not `'APPROVED'` → `ForbiddenException`.
- If `Approval.expiresAt` has passed → `ForbiddenException`.

There is no code path that reaches `youtube.videos.insert` without passing both the compliance gate and the approval gate.

---

## Auto-Publish Rule

The only circumstance where human review is not a blocking step is when all three of the following are true simultaneously:

1. The user has **explicitly opted in** to scheduled auto-publish.
2. The content has **already passed** `ComplianceService.enforce()`.
3. An `Approval` record **already exists** for the item.

In this case the platform may proceed to publish on schedule. The compliance pass and the pre-existing approval together substitute for the blocking manual review step. This exception does not remove compliance checking — it only removes the requirement for a human to click approve at publish time.

---

## Compliance Administration

- Super-admins may view compliance results via admin endpoints.
- The `ComplianceAgent` rule set is managed via the `ai-ops` module (prompt version activation) without requiring code deployments. Prompt versions are tracked in `packages/prompts`.

---

## Planned / Not Yet Implemented

- Per-flag appeal workflow: creators can flag a `CRITICAL` finding for manual review by the trust and safety team.
- Compliance result webhook notifications (notify creator when async check completes).
- Regional policy variants: currently one global rule set is applied; regional policy differences (e.g., country-specific age-restriction rules) are not yet modelled.
