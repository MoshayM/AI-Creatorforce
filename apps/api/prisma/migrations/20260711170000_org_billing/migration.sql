-- Phase 5 Wave 3: Organization & Team Billing
-- Adds organizations, org_memberships, budget_periods tables.
-- Makes Wallet polymorphic (userId nullable, adds orgId).
-- Adds orgId to teams (nullable — beta teams untouched).
-- Enforces the one-owner invariant via a DB CHECK constraint.

-- ── 1. Create organizations ──────────────────────────────────────────────────

CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "billingEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- ── 2. Create org_memberships ────────────────────────────────────────────────

CREATE TABLE "org_memberships" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "org_memberships_orgId_userId_key" ON "org_memberships"("orgId", "userId");
CREATE INDEX "org_memberships_userId_idx" ON "org_memberships"("userId");

ALTER TABLE "org_memberships"
    ADD CONSTRAINT "org_memberships_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. Create budget_periods ─────────────────────────────────────────────────

CREATE TABLE "budget_periods" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "teamId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "allocatedCredits" INTEGER NOT NULL,
    "consumedCredits" INTEGER NOT NULL DEFAULT 0,
    "hardCap" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_periods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "budget_periods_orgId_teamId_periodStart_idx" ON "budget_periods"("orgId", "teamId", "periodStart");

ALTER TABLE "budget_periods"
    ADD CONSTRAINT "budget_periods_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. Make wallets polymorphic ──────────────────────────────────────────────
-- Relax userId to nullable (existing rows already have a value — no data loss).
-- Add orgId column (nullable, unique).
-- Add CHECK: exactly one of the two must be non-null.

ALTER TABLE "wallets"
    ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "wallets"
    ADD COLUMN "orgId" TEXT;

CREATE UNIQUE INDEX "wallets_orgId_key" ON "wallets"("orgId");

ALTER TABLE "wallets"
    ADD CONSTRAINT "wallets_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one owner invariant (both null → 0, both set → 2, one set → 1 ✓).
ALTER TABLE "wallets"
    ADD CONSTRAINT "wallets_exactly_one_owner_check"
    CHECK ((("userId" IS NOT NULL)::int + ("orgId" IS NOT NULL)::int) = 1);

-- ── 5. Add orgId to teams (nullable — beta teams unaffected) ─────────────────

ALTER TABLE "teams"
    ADD COLUMN "orgId" TEXT;
