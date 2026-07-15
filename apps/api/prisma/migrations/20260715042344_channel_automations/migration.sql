-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'AUTOMATION_TICK';

-- CreateTable
CREATE TABLE "channel_automations" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoImport" BOOLEAN NOT NULL DEFAULT false,
    "autoAnalyze" BOOLEAN NOT NULL DEFAULT false,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "chapterSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publishIntervalMinutes" INTEGER NOT NULL DEFAULT 240,
    "maxPublishesPerDay" INTEGER NOT NULL DEFAULT 2,
    "maxImportsPerDay" INTEGER NOT NULL DEFAULT 3,
    "lastTickAt" TIMESTAMP(3),
    "aiSuggestion" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_automations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_automations_channelId_key" ON "channel_automations"("channelId");

-- AddForeignKey
ALTER TABLE "channel_automations" ADD CONSTRAINT "channel_automations_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
