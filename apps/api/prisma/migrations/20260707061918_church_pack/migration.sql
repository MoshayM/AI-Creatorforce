-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'CHURCH_PACK_GENERATION';

-- AlterTable
ALTER TABLE "chapters" ADD COLUMN     "bibleRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "devotional" TEXT,
ADD COLUMN     "discussionQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[];
