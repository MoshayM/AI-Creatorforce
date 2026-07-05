-- CreateEnum
CREATE TYPE "TranscriptStatus" AS ENUM ('PENDING', 'YOUTUBE_CAPTIONS', 'ASR_GENERATED', 'FAILED');

-- CreateEnum
CREATE TYPE "TopicCategory" AS ENUM ('QUESTION_ANSWERED', 'STORY', 'TUTORIAL_STEP', 'FUNNY_MOMENT', 'IMPORTANT_STATEMENT', 'HOOK', 'PROBLEM', 'SOLUTION', 'STATISTIC', 'TIP', 'MISTAKE', 'WARNING', 'QUOTE', 'OPINION', 'LESSON', 'SUCCESS_STORY', 'FAILURE', 'CALL_TO_ACTION');

-- CreateEnum
CREATE TYPE "ClipType" AS ENUM ('YOUTUBE_SHORTS', 'INSTAGRAM_REELS', 'TIKTOK', 'LINKEDIN_CLIPS', 'FACEBOOK_REELS', 'PODCAST_HIGHLIGHTS');

-- CreateEnum
CREATE TYPE "ShortClipStatus" AS ENUM ('CANDIDATE', 'IN_EDITING', 'READY_FOR_RENDER', 'RENDERING', 'RENDERED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPORTED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ShortsTrackType" AS ENUM ('VIDEO', 'AUDIO', 'MUSIC', 'CAPTION', 'OVERLAY');

-- CreateEnum
CREATE TYPE "ShortsRenderStatus" AS ENUM ('QUEUED', 'RUNNING', 'CHECKPOINTED', 'COMPLETE', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssetKind" ADD VALUE 'SHORTS_SOURCE_VIDEO';
ALTER TYPE "AssetKind" ADD VALUE 'SHORTS_TRANSCRIPT';
ALTER TYPE "AssetKind" ADD VALUE 'SHORTS_SCENE_MANIFEST';
ALTER TYPE "AssetKind" ADD VALUE 'SHORTS_CLIP_RENDER';
ALTER TYPE "AssetKind" ADD VALUE 'SHORTS_CAPTION_TRACK';
ALTER TYPE "AssetKind" ADD VALUE 'SHORTS_MUSIC';
ALTER TYPE "AssetKind" ADD VALUE 'SHORTS_SFX';
ALTER TYPE "AssetKind" ADD VALUE 'SHORTS_VOICE';
ALTER TYPE "AssetKind" ADD VALUE 'SHORTS_THUMBNAIL';
ALTER TYPE "AssetKind" ADD VALUE 'SHORTS_PREVIEW';
ALTER TYPE "AssetKind" ADD VALUE 'SHORTS_FINAL_EXPORT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'SHORTS_ANALYZE';
ALTER TYPE "JobType" ADD VALUE 'VIDEO_IMPORT';
ALTER TYPE "JobType" ADD VALUE 'TRANSCRIPT_ANALYSIS';
ALTER TYPE "JobType" ADD VALUE 'SCENE_DETECTION';
ALTER TYPE "JobType" ADD VALUE 'TOPIC_SEGMENTATION';
ALTER TYPE "JobType" ADD VALUE 'HIGHLIGHT_DETECTION';
ALTER TYPE "JobType" ADD VALUE 'SHORTS_GENERATION';
ALTER TYPE "JobType" ADD VALUE 'AUTO_EDIT';
ALTER TYPE "JobType" ADD VALUE 'CAPTION_GENERATION';
ALTER TYPE "JobType" ADD VALUE 'SHORTS_RENDER';
ALTER TYPE "JobType" ADD VALUE 'SHORTS_EXPORT';
ALTER TYPE "JobType" ADD VALUE 'SHORTS_PUBLISH';

-- CreateTable
CREATE TABLE "imported_videos" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "durationMs" INTEGER NOT NULL,
    "thumbnailUrl" TEXT,
    "viewCount" BIGINT,
    "likeCount" BIGINT,
    "commentCount" BIGINT,
    "sourceAssetId" TEXT,
    "transcriptStatus" "TranscriptStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imported_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segments" (
    "id" TEXT NOT NULL,
    "importedVideoId" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "speakerId" TEXT,
    "text" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_scenes" (
    "id" TEXT NOT NULL,
    "importedVideoId" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "speakerId" TEXT,
    "emotionScores" JSONB,
    "sceneChangeConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_segments" (
    "id" TEXT NOT NULL,
    "importedVideoId" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "category" "TopicCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "highlights" (
    "id" TEXT NOT NULL,
    "topicSegmentId" TEXT NOT NULL,
    "virality" DOUBLE PRECISION NOT NULL,
    "emotion" DOUBLE PRECISION NOT NULL,
    "retention" DOUBLE PRECISION NOT NULL,
    "hookStrength" DOUBLE PRECISION NOT NULL,
    "education" DOUBLE PRECISION NOT NULL,
    "entertainment" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "trendPotential" DOUBLE PRECISION NOT NULL,
    "shortSuitability" DOUBLE PRECISION NOT NULL,
    "finalScore" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "titleSuggestion" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "highlights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "short_clips" (
    "id" TEXT NOT NULL,
    "topicSegmentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clipType" "ClipType" NOT NULL,
    "status" "ShortClipStatus" NOT NULL DEFAULT 'CANDIDATE',
    "sourceStartMs" INTEGER NOT NULL,
    "sourceEndMs" INTEGER NOT NULL,
    "reframeKeyframes" JSONB,
    "renderAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "short_clips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_timelines" (
    "id" TEXT NOT NULL,
    "shortClipId" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shorts_timelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_timeline_tracks" (
    "id" TEXT NOT NULL,
    "timelineId" TEXT NOT NULL,
    "type" "ShortsTrackType" NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "shorts_timeline_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_timeline_items" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "sourceAssetId" TEXT,
    "cropRect" JSONB,
    "rotationDeg" DOUBLE PRECISION DEFAULT 0,
    "speed" DOUBLE PRECISION DEFAULT 1.0,
    "volume" DOUBLE PRECISION DEFAULT 1.0,
    "properties" JSONB,

    CONSTRAINT "shorts_timeline_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_captions" (
    "id" TEXT NOT NULL,
    "timelineId" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "speakerColor" TEXT,
    "emphasis" BOOLEAN NOT NULL DEFAULT false,
    "emoji" TEXT,
    "templateId" TEXT,

    CONSTRAINT "shorts_captions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_timeline_edits" (
    "id" TEXT NOT NULL,
    "timelineId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "command" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shorts_timeline_edits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_thumbnails" (
    "id" TEXT NOT NULL,
    "shortClipId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shorts_thumbnails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_render_jobs" (
    "id" TEXT NOT NULL,
    "shortClipId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "ffmpegPass" INTEGER NOT NULL DEFAULT 0,
    "checkpointData" JSONB,
    "status" "ShortsRenderStatus" NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shorts_render_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shorts_export_history" (
    "id" TEXT NOT NULL,
    "shortClipId" TEXT NOT NULL,
    "clipType" "ClipType" NOT NULL,
    "exportAssetId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishTargetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shorts_export_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "imported_videos_projectId_idx" ON "imported_videos"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "imported_videos_projectId_youtubeVideoId_key" ON "imported_videos"("projectId", "youtubeVideoId");

-- CreateIndex
CREATE INDEX "transcript_segments_importedVideoId_startMs_idx" ON "transcript_segments"("importedVideoId", "startMs");

-- CreateIndex
CREATE INDEX "video_scenes_importedVideoId_startMs_idx" ON "video_scenes"("importedVideoId", "startMs");

-- CreateIndex
CREATE INDEX "topic_segments_importedVideoId_startMs_idx" ON "topic_segments"("importedVideoId", "startMs");

-- CreateIndex
CREATE UNIQUE INDEX "highlights_topicSegmentId_key" ON "highlights"("topicSegmentId");

-- CreateIndex
CREATE INDEX "highlights_finalScore_idx" ON "highlights"("finalScore");

-- CreateIndex
CREATE INDEX "short_clips_projectId_status_idx" ON "short_clips"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shorts_timelines_shortClipId_key" ON "shorts_timelines"("shortClipId");

-- CreateIndex
CREATE INDEX "shorts_timeline_tracks_timelineId_orderIndex_idx" ON "shorts_timeline_tracks"("timelineId", "orderIndex");

-- CreateIndex
CREATE INDEX "shorts_timeline_items_trackId_startMs_idx" ON "shorts_timeline_items"("trackId", "startMs");

-- CreateIndex
CREATE INDEX "shorts_captions_timelineId_startMs_idx" ON "shorts_captions"("timelineId", "startMs");

-- CreateIndex
CREATE INDEX "shorts_timeline_edits_timelineId_createdAt_idx" ON "shorts_timeline_edits"("timelineId", "createdAt");

-- CreateIndex
CREATE INDEX "shorts_thumbnails_shortClipId_idx" ON "shorts_thumbnails"("shortClipId");

-- CreateIndex
CREATE INDEX "shorts_render_jobs_shortClipId_idx" ON "shorts_render_jobs"("shortClipId");

-- CreateIndex
CREATE INDEX "shorts_export_history_shortClipId_idx" ON "shorts_export_history"("shortClipId");

-- AddForeignKey
ALTER TABLE "imported_videos" ADD CONSTRAINT "imported_videos_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imported_videos" ADD CONSTRAINT "imported_videos_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_importedVideoId_fkey" FOREIGN KEY ("importedVideoId") REFERENCES "imported_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_scenes" ADD CONSTRAINT "video_scenes_importedVideoId_fkey" FOREIGN KEY ("importedVideoId") REFERENCES "imported_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_segments" ADD CONSTRAINT "topic_segments_importedVideoId_fkey" FOREIGN KEY ("importedVideoId") REFERENCES "imported_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_topicSegmentId_fkey" FOREIGN KEY ("topicSegmentId") REFERENCES "topic_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_clips" ADD CONSTRAINT "short_clips_topicSegmentId_fkey" FOREIGN KEY ("topicSegmentId") REFERENCES "topic_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_clips" ADD CONSTRAINT "short_clips_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_clips" ADD CONSTRAINT "short_clips_renderAssetId_fkey" FOREIGN KEY ("renderAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_timelines" ADD CONSTRAINT "shorts_timelines_shortClipId_fkey" FOREIGN KEY ("shortClipId") REFERENCES "short_clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_timeline_tracks" ADD CONSTRAINT "shorts_timeline_tracks_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "shorts_timelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_timeline_items" ADD CONSTRAINT "shorts_timeline_items_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "shorts_timeline_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_timeline_items" ADD CONSTRAINT "shorts_timeline_items_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_captions" ADD CONSTRAINT "shorts_captions_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "shorts_timelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_timeline_edits" ADD CONSTRAINT "shorts_timeline_edits_timelineId_fkey" FOREIGN KEY ("timelineId") REFERENCES "shorts_timelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_thumbnails" ADD CONSTRAINT "shorts_thumbnails_shortClipId_fkey" FOREIGN KEY ("shortClipId") REFERENCES "short_clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_thumbnails" ADD CONSTRAINT "shorts_thumbnails_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_render_jobs" ADD CONSTRAINT "shorts_render_jobs_shortClipId_fkey" FOREIGN KEY ("shortClipId") REFERENCES "short_clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_export_history" ADD CONSTRAINT "shorts_export_history_shortClipId_fkey" FOREIGN KEY ("shortClipId") REFERENCES "short_clips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shorts_export_history" ADD CONSTRAINT "shorts_export_history_exportAssetId_fkey" FOREIGN KEY ("exportAssetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
