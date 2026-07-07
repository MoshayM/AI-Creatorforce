-- CreateEnum
CREATE TYPE "TrialStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CONVERTED', 'REVOKED', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "AbuseDecision" AS ENUM ('ALLOW', 'REVIEW', 'BLOCK');

-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'TRIAL';

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "trialCredits" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "trial_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "creditsGranted" INTEGER NOT NULL,
    "status" "TrialStatus" NOT NULL DEFAULT 'ACTIVE',
    "verificationMethod" TEXT NOT NULL DEFAULT 'email',
    "deviceFingerprint" TEXT,
    "ipHash" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trial_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_limits" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'enabled',
    "limitValue" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trial_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abuse_signals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceFingerprint" TEXT,
    "ipHash" TEXT,
    "isVpn" BOOLEAN NOT NULL DEFAULT false,
    "duplicateDevice" BOOLEAN NOT NULL DEFAULT false,
    "duplicateIp" BOOLEAN NOT NULL DEFAULT false,
    "fraudScore" DOUBLE PRECISION NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "decision" "AbuseDecision" NOT NULL,
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abuse_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trial_grants_userId_key" ON "trial_grants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "trial_grants_identityKey_key" ON "trial_grants"("identityKey");

-- CreateIndex
CREATE INDEX "trial_grants_deviceFingerprint_idx" ON "trial_grants"("deviceFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "trial_limits_feature_key" ON "trial_limits"("feature");

-- CreateIndex
CREATE INDEX "abuse_signals_userId_createdAt_idx" ON "abuse_signals"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "trial_grants" ADD CONSTRAINT "trial_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
