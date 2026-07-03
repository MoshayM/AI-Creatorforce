# admin.md — AI CreatorForce

> Owner document for the **platform back-office**: internal admin console, user/plan operations, abuse monitoring, feature flags, prompt-version operations, provider/compliance rule management, and support tooling. This surface is for **Anthropic-of-the-platform staff** (internal operators), not creators — it is separate from creator-facing team RBAC (`security.md` §3).

---

## 1. Purpose & Scope

Operate the platform safely: support users, enforce anti-abuse policy (`compliance.md` §7), manage rollouts, keep the compliance rule set and provider configs current, and audit everything. No admin capability may bypass the compliance gate or publish preconditions — admins can *block* content, never *unblock past a gate*.

## 2. Admin Roles (internal)

| Role | Capabilities |
|------|--------------|
| `platform_admin` | Everything below + role management |
| `support` | Read user/project state (consented), resend notifications, trigger safe re-runs, issue credits (capped) |
| `trust_safety` | Abuse queue, account restriction/suspension, content takedown, compliance-rule proposals |
| `ops` | Feature flags, provider config, queue/job controls, prompt promotion |

Internal accounts: SSO + mandatory MFA; every admin action is audit-logged with actor, target, reason (`audit_logs`, `security.md` §12). **Impersonation** (viewing as a user) requires user consent or a trust-safety case ID, is time-boxed, read-only by default, and prominently logged.

## 3. Console Areas

### 3.1 Users & Plans
Search accounts; view plan, usage meters, budget state; adjust plan/credits (Stripe-synced, reasons required); process privacy requests (export/delete, `security.md` §9); suspend/restore accounts.

### 3.2 Abuse Monitoring (Trust & Safety queue)
Signals (auto-flagged → queue): mass low-effort generation patterns, disclosure-evasion attempts (repeated compliance `block`s on synthetic-media flags), templated near-duplicate output across projects (embedding similarity), anomalous spend/request spikes, webhook/API abuse. Actions: warn, rate/budget-restrict, feature-restrict (e.g., disable publish), suspend. Thresholds are config; actions are reversible and logged. The platform-conduct commitments in `compliance.md` §7 are enforced here.

### 3.3 Feature Flags
Central flag service (config-backed): per-flag targeting (percentage, plan tier, allow-list), kill switches for every external provider and every new agent/engine, flag-change audit trail. Rule: new agents, providers, editor catalog entries, and workflow steps ship **behind a flag, default off** (`deployment.md` §5).

### 3.4 Prompt Operations
View `prompt_versions`; run the eval suite (`prompts.md` §7) against a candidate version; promote/rollback active versions (promotion blocked unless safety evals pass); diff versions; per-agent pin overrides for incident response.

### 3.5 Provider & Routing Operations
Provider registry editor (`model-routing.md` §2/§8): enable/disable providers, update model configs/prices, view health/circuit state, force-open a circuit during incidents, review routing distribution and downgrade/fallback rates.

### 3.6 Compliance Rule Management
The ComplianceAgent's rule set (policy references, hard-block category list, thresholds) is versioned config. Trust & safety proposes updates when YouTube policy changes (`compliance.md` living-policy note); changes require review + adversarial-fixture eval pass before activation; every active rule-set version is recorded on each compliance report for reproducibility. Hard-block categories (child safety, clear infringement) can be **added** via config but never removed without dual sign-off.

### 3.7 Jobs & Queues
Queue depth/latency views; inspect/retry/cancel jobs (idempotency-safe); dead-letter review; pause a queue during incidents. Retrying never skips gates — a retried publish job re-verifies preconditions.

### 3.8 Billing Ops
Stripe event log, failed-webhook replay (signature-verified), refunds/credits with reason codes, overage disputes.

## 4. Internal Dashboards

Links into Grafana (`deployment.md` §7): cost per published video by tier, compliance pass rates, abuse-signal trends, provider health, budget-burn anomalies. The admin console embeds read-only views; alert runbooks link back to console actions.

## 5. API & Access

Admin endpoints live under `/api/admin/*` on a separate NestJS module with its own guard chain (internal SSO JWT + role check + IP allow-list), never exposed through the public gateway routes, excluded from the public OpenAPI spec, and rate-limited independently. All responses are tenant-scoped reads unless a trust-safety case authorizes broader access.

## 6. Hard Invariants

1. No admin path bypasses the compliance gate, publish preconditions, or budget checks.
2. Every admin mutation carries an actor + reason and lands in the immutable audit log.
3. Impersonation is consented/cased, time-boxed, and logged.
4. Compliance hard-block categories cannot be weakened by a single actor.
5. Admin surfaces are unreachable with creator credentials.

## 7. Acceptance Criteria

Support can resolve the top ticket types (reconnect channel, stuck job, credit issue) without engineering; trust & safety can restrict an abusive account end-to-end in the console; a bad prompt or provider can be rolled back in < 5 minutes via flags/pins; every action above is visible in the audit log.

## 8. Future Extension

Anomaly-detection ML on abuse signals, self-serve appeal flow for restricted creators, SOC2 evidence export, in-console incident timeline builder.

## 9. Cross References

`security.md` (auth, audit, RBAC) · `compliance.md` §7 (platform conduct) · `model-routing.md` §8 · `prompts.md` §7 · `monetization-framework.md` · `deployment.md` §5/§7 · `testing.md` (admin authz matrix).
