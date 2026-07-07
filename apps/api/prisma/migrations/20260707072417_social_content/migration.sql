-- CreateEnum
CREATE TYPE "SocialContentKind" AS ENUM ('QUOTE_CARD', 'CAROUSEL', 'BLOG_POST', 'NEWSLETTER');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'SOCIAL_CONTENT_GENERATION';

-- CreateTable
CREATE TABLE "social_content" (
    "id" TEXT NOT NULL,
    "importedVideoId" TEXT NOT NULL,
    "kind" "SocialContentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_content_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_content_importedVideoId_kind_idx" ON "social_content"("importedVideoId", "kind");

-- AddForeignKey
ALTER TABLE "social_content" ADD CONSTRAINT "social_content_importedVideoId_fkey" FOREIGN KEY ("importedVideoId") REFERENCES "imported_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
