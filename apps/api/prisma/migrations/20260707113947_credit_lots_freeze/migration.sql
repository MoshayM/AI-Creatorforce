-- AlterTable
ALTER TABLE "users" ADD COLUMN     "rechargesFrozen" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "credit_lots" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_lots_walletId_expiresAt_idx" ON "credit_lots"("walletId", "expiresAt");

-- AddForeignKey
ALTER TABLE "credit_lots" ADD CONSTRAINT "credit_lots_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing bucket balances become grandfathered lots (no expiry)
-- so lot-based debiting sees every credit that predates lot tracking.
INSERT INTO "credit_lots" ("id", "walletId", "bucket", "amount", "remaining", "expiresAt", "createdAt")
SELECT gen_random_uuid()::text, w."id", b.bucket, b.value, b.value, NULL, NOW()
FROM "wallets" w
CROSS JOIN LATERAL (
  VALUES
    ('promotionalCredits', w."promotionalCredits"),
    ('bonusCredits', w."bonusCredits"),
    ('referralCredits', w."referralCredits"),
    ('purchasedCredits', w."purchasedCredits")
) AS b(bucket, value)
WHERE b.value > 0;
