-- CreateEnum
CREATE TYPE "CalendarFormat" AS ENUM ('VIDEO', 'SHORT');

-- CreateEnum
CREATE TYPE "CalendarEntryStatus" AS ENUM ('PROPOSED', 'APPROVED', 'DISMISSED', 'SCHEDULED');

-- CreateTable
CREATE TABLE "channel_profiles" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_calendar_entries" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "angle" TEXT,
    "format" "CalendarFormat" NOT NULL DEFAULT 'VIDEO',
    "plannedAt" TIMESTAMP(3) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rationale" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "status" "CalendarEntryStatus" NOT NULL DEFAULT 'PROPOSED',
    "videoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_calendar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_profiles_channelId_key" ON "channel_profiles"("channelId");

-- CreateIndex
CREATE INDEX "content_calendar_entries_channelId_status_idx" ON "content_calendar_entries"("channelId", "status");

-- CreateIndex
CREATE INDEX "content_calendar_entries_channelId_plannedAt_idx" ON "content_calendar_entries"("channelId", "plannedAt");

-- AddForeignKey
ALTER TABLE "channel_profiles" ADD CONSTRAINT "channel_profiles_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_calendar_entries" ADD CONSTRAINT "content_calendar_entries_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
