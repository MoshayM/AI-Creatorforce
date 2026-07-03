# testing.md — AI CreatorForce

## 1. Philosophy

Test the things that hurt if they break: the **compliance gate**, the **publish preconditions**, **agent output validation**, **budget enforcement**, and **auth/tenant scoping**. AI output is non-deterministic, so we test the *contracts and gates around* agents, not exact model text.

## 2. Test Pyramid

| Level | Tooling | Scope |
|-------|---------|-------|
| Unit | Vitest/Jest | Agents (with mocked AI Client), services, schema validation, utils |
| Integration | Jest + Supertest + ephemeral Postgres/Redis | Module + queue + DB interactions, pipelines |
| Contract | Zod schema tests | Agent input/output schemas, API request/response shapes |
| E2E | Playwright | Critical user journeys against staging |
| Load/perf | k6 (selective) | Queue throughput, API under load |
| Security | SAST, dependency & secret scanning, pen test (pre-launch) | Whole system |

## 3. Mandatory Tests (must exist & pass)

1. **Compliance gate cannot be bypassed:** integration test attempts to advance a `block`/unreviewed bundle to asset generation and to publish; both must be refused. No code path exists that succeeds.
2. **Publish precondition gate:** publishing without `compliancePassed && humanApproved && matching bundleHash` is rejected; `PublishingAgent` re-checks independently.
3. **WF-7 re-review:** editing an approved script/metadata resets gates; publish then blocked until re-approved.
4. **Budget enforcement:** generation dispatch is refused when plan budget is exhausted; no provider call/spend occurs.
5. **Tenant scoping:** a user cannot read/write another tenant's projects/channels/assets.
6. **Token security:** OAuth tokens never persisted in plaintext/primary DB; not present in logs.
7. **Webhook signature verification:** Stripe/outbound webhooks reject invalid signatures.
8. **Agent output validation:** malformed agent output triggers retry → QualityControl → no invalid data persisted.
9. **Fact-check gate:** unsupported claims above threshold block the pipeline.
10. **Idempotent publish:** re-running a succeeded publish job does not create a duplicate.

## 4. Agent Testing Approach

- **Mock the AI Client** to return fixtures (valid, invalid, malformed) and assert: schema validation, retry behavior, fallback provider use, escalation to QualityControl, trace/cost emission.
- **Golden contract tests:** every agent's input/output Zod schemas have positive and negative cases.
- **Quality heuristics:** where defined (e.g., script must contain all required sections), assert structurally, not by exact wording.
- **Determinism boundary:** for live-provider tests (few, in staging), assert *shape and constraints*, not text; keep flaky live tests out of the required PR gate.

## 5. Integration Testing

- Spin up ephemeral Postgres + Redis (testcontainers or CI services).
- Run a queue worker in-process; enqueue a job; assert state transitions and DB writes.
- Pipeline tests cover WF-3, WF-5, WF-7 fully (MVP); WF-1, WF-4, WF-6 (Beta).
- Mock external providers (YouTube, video, music, LLM) at the AI Client/HTTP boundary.

## 6. E2E (Playwright, staging)

Critical journeys:
- Connect channel → create project → generate script → fact-check → compliance pass → approve → publish (to a sandbox/test channel) → see receipt.
- Compliance block path → see reasons → revise → re-pass.
- Budget exhaustion → upgrade prompt.

## 7. Test Data & Fixtures

- Seeded users/channels/projects in `infra/db/seed.ts`.
- Fixture library of agent inputs/outputs (valid + adversarial, incl. prompt-injection attempts in "research source" content).
- Adversarial fixtures specifically attempt: disclosure evasion, infringing content, deceptive metadata — all must be caught by compliance.

## 8. CI Gating

PR cannot merge unless: lint, typecheck, unit, build, and integration tests pass; security scans clean of high-severity issues. The mandatory tests in §3 are part of the required suite. See `deployment.md` §4.

## 9. Coverage & Quality

- Coverage targets meaningful paths (gates, services, agents) rather than a blunt %; gate/critical-path code aims for high coverage.
- Mutation testing (selective) on compliance/publish logic to ensure tests actually catch regressions.

## 10. Non-Functional Testing

- **Load:** queue throughput and API p95 under expected peak (k6) before launch.
- **Resilience:** provider outage simulation → fallback works; queue retry/backoff verified.
- **Backup/restore drills:** periodic restore test in staging (see `deployment.md` §8).

## 11. Invariants Tests Protect (for code agents)

If a change makes any §3 test fail, the change is wrong, not the test—unless the test itself is being corrected with explicit review noted in the PR. Never weaken a compliance/security test to make a feature pass.
