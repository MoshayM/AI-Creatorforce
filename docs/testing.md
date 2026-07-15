# testing.md — AI CreatorForce

This file describes the test strategy, tooling, and non-negotiable coverage requirements for the AI CreatorForce platform. Tests are organized in three layers: unit (Jest, co-located in `apps/api`), E2E (Playwright, in `apps/e2e`), and automated security (Semgrep SAST + ZAP DAST). See [deployment.md](deployment.md) for how these layers are wired into CI.

---

## Philosophy

> Test the things that hurt if they break: the **compliance gate**, the **publish preconditions**, **agent output validation**, **budget enforcement**, and **auth/tenant scoping**. AI output is non-deterministic, so we test the *contracts and gates around* agents, not exact model text.

Tests validate contracts, schemas, and gates — not AI text output. External providers (Anthropic/OpenAI/Gemini, Stripe, YouTube APIs) are mocked in unit and integration tests. E2E tests run against a real database and API with full live services.

---

## Test Layers

### Unit Tests (Jest)

**Location:** Co-located `*.spec.ts` files in `apps/api/src`.

**Scope:** Services, guards, utilities. `PrismaService` is mocked. `ioredis-mock` is available for Redis-dependent code.

**Run command:**
```
pnpm --filter @cf/api run test --coverage --ci
```

Coverage report is uploaded as a CI artifact (7-day retention).

**Critical spec files (must always pass):**

| File | What it covers |
|---|---|
| `compliance.service.spec.ts` | `check`, `enforce`, `cache`, `invalidate` — the hard gate |
| `sessions.service.spec.ts` | Issue, refresh, revoke of `AuthSession` |
| `oauth.service.spec.ts` | Token encryption/decryption, token storage |
| `rbac.spec.ts` | `roleHasPermission`, `resolveElevatedRole` |
| `cursor.spec.ts` | Cursor pagination correctness |
| `structured-logger.spec.ts` | Log shape contract |
| `pipeline-plan.spec.ts` | Agent pipeline planning contracts |
| `trial.service.spec.ts` | Trial credit bucket, limit enforcement |
| `referral.service.spec.ts` | Referral code grant, de-dup |
| `growth-engine.spec.ts` | Growth engine logic |
| `dev-portal.utils.spec.ts` | Developer portal utilities |
| `developer-key.guard.spec.ts` | API key auth guard |

---

### E2E Tests (Playwright)

**Location:** `apps/e2e/src`.

**Stack:** Full Postgres 16 + Redis 7 run as CI services. The API is started (`node apps/api/dist/main.js`) and health-checked before tests begin. The Next.js web server runs a **production build** (`next build` then `next start -p 3007`) — not dev mode — to catch build-time and SSR issues. `TOKEN_ENCRYPTION_KEY` is set in the E2E CI environment.

**Cross-browser matrix:** chromium / firefox / webkit — run as parallel CI jobs. E2E job timeout: 40 minutes.

**Artifacts on failure:** Playwright report (7-day retention).

**Spec files:**

| File | Coverage area |
|---|---|
| `auth.spec.ts` | Login, logout, OAuth flows |
| `sessions.spec.ts` | Session lifecycle, refresh, revoke |
| `projects.spec.ts` | Project CRUD, pipeline state |
| `jobs.spec.ts` | Job queue, status polling, completion |
| `approvals.spec.ts` | Approval gate, publish precondition |
| `library.spec.ts` | Library picker, video import, notes |
| `wallet.spec.ts` | Credit balance, hard cap enforcement |
| `orgs.spec.ts` | Org and team management, membership |
| `growth.spec.ts` | Referral codes, trial grants, upgrade |
| `settings.spec.ts` | Settings page, channel access, Library sub-links |
| `notifications.spec.ts` | Notification delivery and read state |
| `navigation.spec.ts` | Sidebar links, channel selector, routing |
| `discover.spec.ts` | Opportunity discovery flows |
| `admin.spec.ts` | Admin panel, super-admin guard |
| `a11y.spec.ts` | Automated accessibility checks |
| `visual.spec.ts` | Visual regression snapshots |

**Fixtures:**

- `auth.ts` — shared login/session setup for authenticated test contexts.
- `api-mock.ts` — MSW v2 handlers for frontend-only tests that do not need the real API.

---

### Security Tests (CI Automated)

**SAST — Semgrep:**
- Config: `.semgrep/creatorforce.yml`
- Custom architecture rules at `ERROR` severity block CI (e.g., bypassing `ComplianceAgent`, hardcoded secrets).
- Informational: `p/typescript` registry ruleset.

**DAST — OWASP ZAP:**
- Config: `.zap/plan.yaml`
- Passive scan of the production web build.
- `check-zap-summary.mjs` gates the CI job on HIGH-risk findings.
- ZAP report artifact retained for 30 days.

**Dependency audit:**
- `pnpm audit --audit-level=high` runs on every push.
- `dependency-review-action` runs on PRs to flag newly introduced vulnerable packages.

---

## Frontend Mocking (MSW v2)

`public/mockServiceWorker.js` is registered in development mode.

`api-mock.ts` provides MSW request handlers for E2E tests that exercise only the frontend without a running API.

When `NEXT_PUBLIC_USE_MOCK=true`, the web app routes all API calls through MSW — useful for frontend-only development without a local API instance.

---

## Test Data and Isolation

E2E tests run `prisma migrate deploy` against a fresh Postgres instance provisioned in CI. Tests that create users, channels, or projects must clean up after themselves or use unique seeds per run. The `auth.ts` fixture provides stable test credentials.

---

## Non-Negotiable Coverage (per CLAUDE.md §8)

These paths must have tests. A PR that removes or weakens them will not be merged.

| Path | Requirement |
|---|---|
| `ComplianceService.enforce()` | Must never silently pass a failing check |
| `PublishingService.publish()` | Must verify `Approval.status === 'APPROVED'` before proceeding |
| `WalletService` budget enforcement | `hardCap` must actually block — not warn |
| Auth tenant scoping | User A cannot read or mutate User B's resources |
| Agent output Zod schema validation | Invalid agent responses must be rejected and retried |

If a change makes any of the above tests fail, the change is wrong — not the test. Never weaken a compliance or security test to make a feature pass.

---

## Bundle Budget

CI enforces a bundle size budget via `scripts/check-bundle-budget.mjs`:
- Per-route first-load JS: 800 KB maximum.
- Total bundle: 1500 KB maximum.

---

## Planned / Not Yet Implemented

- Integration tests for the full agent pipeline end-to-end (currently only unit-tested in isolation).
- Visual regression baseline management workflow (baselines must be regenerated intentionally, not on every run).
- Load/performance testing suite.
