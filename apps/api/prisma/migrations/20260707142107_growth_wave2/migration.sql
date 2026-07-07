-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('WELCOME', 'FIRST_RECHARGE', 'LOYALTY', 'WINBACK', 'UPGRADE', 'LOW_CREDIT');

-- CreateEnum
CREATE TYPE "OfferRewardType" AS ENUM ('BONUS_CREDITS', 'FREE_PREMIUM_DAYS');

-- CreateTable
CREATE TABLE "user_behaviour" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatsSent" INTEGER NOT NULL DEFAULT 0,
    "videosAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "clipsGenerated" INTEGER NOT NULL DEFAULT 0,
    "rendersRun" INTEGER NOT NULL DEFAULT 0,
    "jobsTotal" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3),
    "inactiveDays" INTEGER NOT NULL DEFAULT 0,
    "trialCreditsUsedPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_behaviour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upgrade_recommendations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "recommendedPlan" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "dismissedAt" TIMESTAMP(3),
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upgrade_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "type" "OfferType" NOT NULL,
    "name" TEXT NOT NULL,
    "rewardType" "OfferRewardType" NOT NULL DEFAULT 'BONUS_CREDITS',
    "rewardValue" INTEGER NOT NULL,
    "minRechargeMinor" INTEGER,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "usageLimit" INTEGER,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "profitChecked" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_redemptions" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT,
    "rewardGranted" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_behaviour_userId_key" ON "user_behaviour"("userId");

-- CreateIndex
CREATE INDEX "upgrade_recommendations_userId_createdAt_idx" ON "upgrade_recommendations"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "offers_type_status_idx" ON "offers"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "offer_redemptions_idempotencyKey_key" ON "offer_redemptions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "offer_redemptions_userId_idx" ON "offer_redemptions"("userId");

-- AddForeignKey
ALTER TABLE "offer_redemptions" ADD CONSTRAINT "offer_redemptions_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
