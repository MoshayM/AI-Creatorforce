-- CreateEnum
CREATE TYPE "AiProviderStatus" AS ENUM ('ACTIVE', 'DEGRADED', 'DISABLED');

-- CreateTable
CREATE TABLE "ai_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AiProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "failureRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgHealthScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_health_events" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_health_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_cost_rates" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "model" TEXT,
    "inputCostPer1M" DOUBLE PRECISION NOT NULL,
    "outputCostPer1M" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "provider_cost_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "model" TEXT,
    "provider" TEXT,
    "plan" TEXT,
    "creditCost" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_providers_name_key" ON "ai_providers"("name");

-- CreateIndex
CREATE INDEX "provider_health_events_providerId_checkedAt_idx" ON "provider_health_events"("providerId", "checkedAt");

-- CreateIndex
CREATE INDEX "provider_cost_rates_providerId_effectiveFrom_idx" ON "provider_cost_rates"("providerId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "pricing_rules_action_isActive_idx" ON "pricing_rules"("action", "isActive");

-- AddForeignKey
ALTER TABLE "provider_health_events" ADD CONSTRAINT "provider_health_events_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_cost_rates" ADD CONSTRAINT "provider_cost_rates_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
