-- AlterTable
ALTER TABLE "token_usage" ADD COLUMN     "importedVideoId" TEXT,
ADD COLUMN     "jobId" TEXT,
ADD COLUMN     "projectId" TEXT;

-- CreateIndex
CREATE INDEX "token_usage_importedVideoId_createdAt_idx" ON "token_usage"("importedVideoId", "createdAt");
