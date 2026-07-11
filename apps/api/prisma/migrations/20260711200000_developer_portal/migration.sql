-- Phase 5 Wave 4b: Developer Portal
-- Adds developer_keys, developer_webhooks, developer_webhook_deliveries tables.
-- Keys are stored as sha256 hashes (plaintext shown once at creation).
-- Webhook signing secrets are stored AES-256-GCM encrypted (required for HMAC signing).
-- No ALTER of users table needed — Prisma relations are implicit FK constraints.

-- ── 1. Create developer_keys ──────────────────────────────────────────────────

CREATE TABLE "developer_keys" (
    "id"              TEXT          NOT NULL,
    "userId"          TEXT          NOT NULL,
    "name"            TEXT          NOT NULL,
    "keyPrefix"       TEXT          NOT NULL,
    "keyHash"         TEXT          NOT NULL,
    "scopes"          TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rateLimitPerMin" INTEGER       NOT NULL DEFAULT 60,
    "sandbox"         BOOLEAN       NOT NULL DEFAULT false,
    "lastUsedAt"      TIMESTAMP(3),
    "revokedAt"       TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developer_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "developer_keys_keyHash_key" ON "developer_keys"("keyHash");
CREATE INDEX "developer_keys_userId_idx" ON "developer_keys"("userId");

ALTER TABLE "developer_keys"
    ADD CONSTRAINT "developer_keys_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 2. Create developer_webhooks ──────────────────────────────────────────────

CREATE TABLE "developer_webhooks" (
    "id"            TEXT          NOT NULL,
    "userId"        TEXT          NOT NULL,
    "url"           TEXT          NOT NULL,
    "eventTypes"    TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
    "secretEnc"     TEXT          NOT NULL,
    "status"        TEXT          NOT NULL DEFAULT 'ACTIVE',
    "failureCount"  INTEGER       NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developer_webhooks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "developer_webhooks_userId_idx" ON "developer_webhooks"("userId");

ALTER TABLE "developer_webhooks"
    ADD CONSTRAINT "developer_webhooks_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. Create developer_webhook_deliveries ────────────────────────────────────

CREATE TABLE "developer_webhook_deliveries" (
    "id"            TEXT          NOT NULL,
    "webhookId"     TEXT          NOT NULL,
    "eventType"     TEXT          NOT NULL,
    "payload"       JSONB         NOT NULL,
    "attempts"      INTEGER       NOT NULL DEFAULT 0,
    "status"        TEXT          NOT NULL DEFAULT 'PENDING',
    "nextAttemptAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError"     TEXT,
    "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "developer_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "developer_webhook_deliveries_status_nextAttemptAt_idx"
    ON "developer_webhook_deliveries"("status", "nextAttemptAt");

ALTER TABLE "developer_webhook_deliveries"
    ADD CONSTRAINT "developer_webhook_deliveries_webhookId_fkey"
    FOREIGN KEY ("webhookId") REFERENCES "developer_webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
