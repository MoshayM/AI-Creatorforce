-- AlterEnum
ALTER TYPE "ClipType" ADD VALUE 'SMALL_VIDEO';

-- AlterTable
ALTER TABLE "short_clips" ADD COLUMN     "chapterId" TEXT,
ALTER COLUMN "topicSegmentId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "short_clips" ADD CONSTRAINT "short_clips_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
