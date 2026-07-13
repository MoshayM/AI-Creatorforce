# risk-register.md — AI CreatorForce

> Living register per `Updates/47_Risk_Register.md`: technical, product, security,
> and operational risks with likelihood, impact, owner, mitigation, and status.
> Review cadence: on every wave that touches a listed area; prune resolved rows.
> Last updated: 2026-07-12 (Wave 13).

| ID | Risk | Category | Likelihood | Impact | Mitigation | Status |
|----|------|----------|-----------|--------|------------|--------|
| R-01 | Stuck jobs: a RUNNING `AgentJob` whose worker died stays RUNNING forever (BullMQ stalled-detection covers the queue side, not the DB row) | Technical | Medium | Medium | Reaper job planned (Wave 17): RUNNING rows past a deadline → FAILED + hold release | Open → Wave 17 |
| R-02 | Double-enqueue race: no idempotency key on `AgentJob`; concurrent identical enqueues can both persist | Technical | Low | Medium | Client `Idempotency-Key` on enqueue planned (Wave 17) | Open → Wave 17 |
| R-03 | Secrets in `.env`, no KMS; OAuth tokens envelope-encrypted but master key local | Security | Low (single-tenant local) | High at scale | Documented deliberate deviation (billing-security.md); adopt KMS before multi-tenant hosting | Accepted (local-first) |
| R-04 | No log aggregation: stdout-only logs; incident forensics rely on Sentry + Prometheus | Operational | Medium | Medium | Structured JSON logging (Wave 15) makes future shipping trivial; aggregation is infra-blocked | Mitigating → Wave 15 |
| R-05 | Postgres RPO 24h (daily dumps, no WAL archiving/PITR) | Operational | Low | High | Runbooks document PITR upgrade path; infra-blocked locally | Accepted (documented) |
| R-06 | Provider outage degradation: AI adapter chains fail closed (good) but user messaging is generic | Product | Medium | Low | Error envelope carries `code: PROVIDER`, `retryable: true` (Wave 7); UI copy improvements as follow-up | Partially mitigated |
| R-07 | Cross-tenant isolation depends on service-level ownership checks (no DB row-level security) | Security | Low | High | Ownership-scoped service methods + e2e/unit tests; Semgrep rule candidates for missing scoping | Open (monitor) |
| R-08 | In-memory rate limiter on dev-API keys resets per process and doesn't share across replicas | Technical | Low (single instance) | Medium at scale | Documented in `developer-key.guard.ts`; Redis sliding window when multi-instance | Accepted (documented) |
| R-09 | i18n absent: UI strings hard-coded English; retrofit cost grows with every new surface | Product | High (if targeting non-EN) | Medium | Externalize strings when a second locale is committed; AI content is already multi-language | Accepted (deferred) |
| R-10 | External security scanning (Snyk/ZAP/Burp) not wired — CI runs pnpm audit + Semgrep only | Security | Medium | Medium | External-blocked (accounts/licenses); Semgrep custom rules cover architecture invariants | External-blocked |
| R-11 | Long-video (4–8 h) pipeline untested at scale: chapter windowing, embedding throughput, render backpressure | Technical | Medium | Medium | Needs a real long source video (video-hub.md Phase 7); load-test before onboarding long-form creators | Blocked (test media) |
| R-12 | Sandbox dev keys rely on per-route checks to block paid actions — a new dev-API route could forget the check | Security | Medium | Medium | Enqueue route checks `req.user.sandbox`; consider a guard-level `@PaidAction()` decorator as surface grows | Open (monitor) |

## Closed / resolved

| ID | Risk | Resolution |
|----|------|------------|
| R-C1 | Fake media reaching COMPLETED (offline adapters, simulateRender) | Validation engine + opt-in offline adapters (docs/audit-placeholders.md remediation) |
| R-C2 | Budget periods with foreign `teamId` silently never enforcing | `assertTeamInOrg` at set time (Wave 8) |
| R-C3 | Credit lots expiring without user warning | `LotExpiryJob` 7/3/1-day in-app notifications (Wave 11) |
| R-C4 | No health probes for load balancers/runbooks | `/health` + `/ready` endpoints (Wave 13) |
