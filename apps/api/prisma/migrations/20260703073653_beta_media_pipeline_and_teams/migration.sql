-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('MUSIC', 'VIDEO', 'THUMBNAIL', 'VOICE', 'IMAGE', 'SUBTITLE', 'RENDER_SOURCE', 'UPLOAD');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('BRIEFED', 'GENERATING', 'READY', 'FAILED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "RenderPreset" AS ENUM ('DRAFT_PROXY', 'YT_1080P', 'YT_4K', 'SHORTS_1080X1920');

-- CreateEnum
CREATE TYPE "RenderStatus" AS ENUM ('QUEUED', 'RENDERING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'REVIEWER', 'VIEWER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'VOICE_SPEC';
ALTER TYPE "JobType" ADD VALUE 'VOICE_GENERATE';
ALTER TYPE "JobType" ADD VALUE 'IMAGE_BRIEF';
ALTER TYPE "JobType" ADD VALUE 'IMAGE_GENERATE';
ALTER TYPE "JobType" ADD VALUE 'MUSIC_BRIEF';
ALTER TYPE "JobType" ADD VALUE 'MUSIC_GENERATE';
ALTER TYPE "JobType" ADD VALUE 'VIDEO_SCENE_PLAN';
ALTER TYPE "JobType" ADD VALUE 'VIDEO_GENERATE';
ALTER TYPE "JobType" ADD VALUE 'SUBTITLE_GENERATE';
ALTER TYPE "JobType" ADD VALUE 'EDIT_PLAN';
ALTER TYPE "JobType" ADD VALUE 'RENDER';
ALTER TYPE "JobType" ADD VALUE 'ANALYTICS';
ALTER TYPE "JobType" ADD VALUE 'GROWTH_REPORT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UsageType" ADD VALUE 'VOICE_SECONDS';
ALTER TYPE "UsageType" ADD VALUE 'IMAGE_GENERATED';
ALTER TYPE "UsageType" ADD VALUE 'MUSIC_GENERATED';
ALTER TYPE "UsageType" ADD VALUE 'VIDEO_CLIP_GENERATED';
ALTER TYPE "UsageType" ADD VALUE 'RENDER_MINUTES';

-- AlterTable
ALTER TABLE "channels" ADD COLUMN     "brandKit" JSONB,
ADD COLUMN     "niche" TEXT,
ADD COLUMN     "voiceProfile" JSONB;

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "currentVersionId" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'BRIEFED',
    "label" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_versions" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "r2Key" TEXT,
    "contentHash" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "prompt" JSONB,
    "params" JSONB,
    "provenance" JSONB,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "wordTimestamps" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timelines" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "label" TEXT,
    "fps" INTEGER NOT NULL DEFAULT 30,
    "resolution" JSONB NOT NULL DEFAULT '{"width":1920,"height":1080}',
    "tracks" JSONB NOT NULL DEFAULT '{"schemaVersion":1,"tracks":[]}',
    "contentHash" TEXT,
    "isDraft" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renders" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "timelineId" TEXT NOT NULL,
    "timelineVersion" INTEGER NOT NULL,
    "preset" "RenderPreset" NOT NULL,
    "status" "RenderStatus" NOT NULL DEFAULT 'QUEUED',
    "progressPct" INTEGER NOT NULL DEFAULT 0,
    "r2Key" TEXT,
    "sizeBytes" BIGINT,
    "durationMs" INTEGER,
    "checksum" TEXT,
    "costCredits" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "renders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_snapshots" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "ytVideoId" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "planTier" TEXT NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assets_projectId_kind_status_idx" ON "assets"("projectId", "kind", "status");

-- CreateIndex
CREATE INDEX "asset_versions_contentHash_idx" ON "asset_versions"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "asset_versions_assetId_version_key" ON "asset_versions"("assetId", "version");

-- CreateIndex
CREATE INDEX "timelines_projectId_version_idx" ON "timelines"("projectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "renders_projectId_timelineVersion_preset_key" ON "renders"("projectId", "timelineVersion", "preset");

-- CreateIndex
CREATE INDEX "analytics_snapshots_channelId_ytVideoId_capturedAt_idx" ON "analytics_snapshots"("channelId", "ytVideoId", "capturedAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "prompt_versions_key_active_idx" ON "prompt_versions"("key", "active");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_versions_key_version_key" ON "prompt_versions"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "team_memberships_teamId_userId_key" ON "team_memberships"("teamId", "userId");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timelines" ADD CONSTRAINT "timelines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renders" ADD CONSTRAINT "renders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renders" ADD CONSTRAINT "renders_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "timelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
