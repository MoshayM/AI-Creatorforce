-- CreateEnum
CREATE TYPE "ChapterSource" AS ENUM ('DETECTED', 'IMPORTED');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'CHAPTER_DETECTION';

-- CreateTable
CREATE TABLE "chapters" (
    "id" TEXT NOT NULL,
    "importedVideoId" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "keyPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" "ChapterSource" NOT NULL DEFAULT 'DETECTED',
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chapters_importedVideoId_startMs_idx" ON "chapters"("importedVideoId", "startMs");

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_importedVideoId_fkey" FOREIGN KEY ("importedVideoId") REFERENCES "imported_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
