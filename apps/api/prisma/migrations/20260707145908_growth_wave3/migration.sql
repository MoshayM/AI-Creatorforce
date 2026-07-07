-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "targetRule" JSONB;

-- CreateTable
CREATE TABLE "credit_packs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "region" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_packs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_packs_isActive_region_idx" ON "credit_packs"("isActive", "region");
