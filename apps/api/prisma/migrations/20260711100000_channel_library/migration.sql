-- Add CHANNEL_SYNC to JobType enum
ALTER TYPE "JobType" ADD VALUE 'CHANNEL_SYNC';

-- Make AgentJob.projectId nullable (channel-level sync jobs have no project)
ALTER TABLE "agent_jobs" ALTER COLUMN "projectId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "library_videos" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'video',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_playlists" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "youtubePlaylistId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_playlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_playlist_items" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "libraryVideoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "library_playlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_sync_states" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'IDLE',
    "videosPageToken" TEXT,
    "playlistsPageToken" TEXT,
    "currentPlaylistId" TEXT,
    "playlistItemsPageToken" TEXT,
    "syncedVideos" INTEGER NOT NULL DEFAULT 0,
    "syncedPlaylists" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_sync_states_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "library_videos_channelId_youtubeVideoId_key" ON "library_videos"("channelId", "youtubeVideoId");

-- CreateIndex
CREATE INDEX "library_videos_channelId_archived_publishedAt_id_idx" ON "library_videos"("channelId", "archived", "publishedAt" DESC, "id");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "library_playlists_channelId_youtubePlaylistId_key" ON "library_playlists"("channelId", "youtubePlaylistId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "library_playlist_items_playlistId_libraryVideoId_key" ON "library_playlist_items"("playlistId", "libraryVideoId");

-- CreateIndex
CREATE INDEX "library_playlist_items_playlistId_position_idx" ON "library_playlist_items"("playlistId", "position");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "channel_sync_states_channelId_key" ON "channel_sync_states"("channelId");

-- AddForeignKey
ALTER TABLE "library_videos" ADD CONSTRAINT "library_videos_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_playlists" ADD CONSTRAINT "library_playlists_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_playlist_items" ADD CONSTRAINT "library_playlist_items_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "library_playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_playlist_items" ADD CONSTRAINT "library_playlist_items_libraryVideoId_fkey" FOREIGN KEY ("libraryVideoId") REFERENCES "library_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
