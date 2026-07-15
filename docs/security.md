# security.md — AI CreatorForce

This document is the authoritative reference for how AI CreatorForce secures its API, web frontend, user credentials, OAuth tokens, and sensitive data. It covers authentication, authorization, HTTP hardening, secrets management, audit logging, fraud controls, and the automated security tooling that gates CI. Related reading: [compliance.md](compliance.md), [youtube-publishing.md](youtube-publishing.md), [database.md](database.md).

---

## Principles

- **Least privilege everywhere** — IAM policies, database roles, OAuth scopes, and RBAC permissions are all scoped to the minimum required.
- **Defense in depth** — multiple independent layers (HTTP headers, auth guards, RBAC, encryption at rest) so that a failure in one layer does not expose the system.
- **Secrets never in source code** — all credentials and keys live in environment variables or a secret manager. No committed `.env` files.
- **Audit trail for all sensitive mutations** — security-relevant actions are written to an append-only AuditLog.
- **Fail closed** — on error or unexpected state, the system rejects the request rather than allowing it through.

---

## Authentication

### Email / Password

- Password hash stored in `User.passwordHash` (bcryptjs, cost factor tuned for server hardware).
- Minimum 8 characters enforced by class-validator on registration and password-change endpoints.
- Plain-text password is never logged, stored, or transmitted after the initial hashing step.

### OAuth (Google, Apple, Facebook)

- Adapters live in `ProviderRegistry`, each implementing a typed interface.
- OAuth tokens (access + refresh) are encrypted at rest using **jose** (JWE, AES-256-GCM) with the `TOKEN_ENCRYPTION_KEY` environment variable as the wrapping key.
- Encrypted blob stored in `Channel.encryptedTokens`; expiry timestamp stored in `Channel.tokenExpiresAt`.
- OAuth scopes granted by the user are recorded in `Channel.scopes[]` for audit purposes.

### JWT Sessions

- **Access tokens:** short-lived, signed with `JWT_SECRET`. Included in `Authorization: Bearer` header on API requests.
- **Refresh tokens:** long-lived, stored in the `AuthSession` model. On each refresh, the old refresh token is invalidated and a new one is issued (rotating refresh token pattern).
- **Multi-device support:** each device/login produces a separate `AuthSession` row. A user may have multiple concurrent sessions.
- Session management endpoints:
  - `GET /auth/sessions` — list all active sessions for the authenticated user.
  - `DELETE /auth/sessions/:id` — revoke a specific session (logs the user out of that device).

---

## Authorization (RBAC)

Implementation: `apps/api/src/common/rbac.ts`.

**Platform roles (`UserRole`):**

| Role | Description |
|------|-------------|
| `SUPER_ADMIN` | Full platform access including billing, user management, provider config, pricing, trial controls, job admin, feature flags, audit logs, revenue reporting. |
| `OWNER` | Elevated access below SUPER_ADMIN. |
| `MEMBER` | Standard authenticated user. |

**Permission strings** (checked at endpoints, not role names directly):

`billing:view`, `billing:refund`, `wallet:adjust`, `admin:users`, `admin:audit-logs`, `admin:revenue`, `admin:providers`, `admin:pricing`, `admin:trial`, `admin:jobs`, `admin:flags`.

**Role resolution:** Elevated roles (`SUPER_ADMIN`, `OWNER`) are resolved at login by `resolveElevatedRole()`, which reads `SUPER_ADMIN_EMAILS` and `OWNER_EMAILS` environment variables. These lists are **never hardcoded in source**.

**Guards:**

- `JwtAuthGuard` — applied to all private routes; validates access token signature and expiry.
- `OwnerGuard` — verifies the requesting user owns the target resource.
- `PermissionsGuard` — checks that the user's role has the specific permission string required.

**Team roles:** Finer-grained collaboration roles (`OWNER`, `ADMIN`, `EDITOR`, `REVIEWER`, `VIEWER`) are stored in `TeamMembership` and govern access within a workspace/channel context.

---

## HTTP Security Headers

### API (NestJS)

Helmet 8 is applied globally, setting default protective headers including `X-DNS-Prefetch-Control`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and others.

### Web (Next.js)

Custom headers applied to all routes in `apps/web/next.config.ts`:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | Strict. Allows `self`, YouTube image domains, configured API origin, WebSocket upgrade, Sentry. `eval` permitted in non-production only (Next.js dev toolchain requirement). |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| Powered-by header | Disabled (`poweredByHeader: false`) |

---

## Production Startup Guard

`main.ts` calls `assertProductionSecrets()` before bootstrapping the NestJS application in production. The guard throws and aborts startup if:

- `JWT_SECRET` is absent, shorter than 32 characters, or equal to the development placeholder `dev-secret`.
- `TOKEN_ENCRYPTION_KEY` is absent or shorter than 32 characters.

This ensures the API never starts in production with weak or missing signing/encryption credentials.

---

## Auth Rate Limiting

Login, registration, and token-refresh endpoints are protected by a Redis-backed fixed-window rate limiter.

**Implementation:** `apps/api/src/common/guards/rate-limit.guard.ts` — registered as a global `APP_GUARD`. Endpoints opt-in via the `@RateLimit({ bucket, limit, windowSecs })` decorator.

**Behavior:**
- Applied to: `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh`.
- Keyed by IP address + bucket name.
- Fails **open** when Redis is unreachable (allows the request through rather than blocking all auth during a Redis outage). This is an explicit availability-over-strict-rate-limiting trade-off.

---

## Secrets Management

All sensitive values are injected via environment variables. The application refuses to boot if required secrets are absent (see Production Startup Guard above). Required environment variables:

| Variable | Purpose |
|----------|---------|
| `JWT_SECRET` | Signs JWT access tokens. |
| `TOKEN_ENCRYPTION_KEY` | JWE wrapping key for OAuth tokens. Minimum 32 characters. Service refuses to start without it. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `REDIS_URL` | Redis connection string (caching, BullMQ). |
| `STRIPE_SECRET_KEY` | Stripe billing integration. |
| `ANTHROPIC_API_KEY` | Claude API access. |
| `OPENAI_API_KEY` | OpenAI API access. |
| `GEMINI_API_KEY` | Gemini API access. |
| `SENTRY_DSN` | Error and trace reporting. |

No secrets appear in code or in committed files. See [database.md](database.md) for connection security details.

---

## Audit Trail

`AuditLog` model fields: `userId`, `action`, `target`, `meta` (JSON), `createdAt`. The table is append-only — rows are never updated or deleted by application code.

Indexes: `[userId, createdAt]` and `[action, createdAt]` for efficient admin queries.

Admin endpoint: `GET /admin/audit-logs` — requires `admin:audit-logs` permission.

---

## Fraud Controls

- **`Wallet.rechargesFrozen`** — boolean field set by Stripe dispute/chargeback webhooks. When `true`, all new wallet recharge attempts are blocked until an admin clears the flag after review.
- **`deviceFingerprint`** — captured at `POST /auth/register` and used as an input signal for trial abuse scoring.

---

## Dependency Security

- **`pnpm audit --audit-level=high`** runs in CI on every push. Pipeline fails on HIGH or CRITICAL CVEs.
- **`dependency-review-action`** runs on pull requests; fails if a newly introduced dependency carries a HIGH-severity vulnerability.
- **Dependabot** (`.github/dependabot.yml`) opens automated PRs for dependency version updates across all packages.

---

## SAST (Static Analysis)

Semgrep is configured at `.semgrep/creatorforce.yml` with custom architecture rules specific to this codebase. Rules flagged at `ERROR` severity block CI. The `p/typescript` registry pack is also run (informational, does not gate CI).

---

## DAST (Dynamic Analysis)

OWASP ZAP baseline scan is defined in `.zap/plan.yaml` and runs in CI on every push and pull request against a production web build. The scan performs a spider pass and passive analysis. `check-zap-summary.mjs` gates the pipeline on any HIGH-risk findings. Medium and below findings are recorded in a CI artifact with 30-day retention.

---

## Planned / Not Yet Implemented

- BurpSuite active scan (referenced in docs4, not yet wired into CI).
- Snyk dependency monitoring (docs4 references it; CI currently uses `pnpm audit` instead).
- Per-route rate limiting beyond auth endpoints — auth login/register/refresh now have Redis-backed rate limiting; other routes do not yet.
- Per-tenant database row-level security (RLS).
