-- Phase 5 Wave 12: per-key token attribution for developer-API triggered spend
ALTER TABLE "token_usage" ADD COLUMN "developerKeyId" TEXT;

CREATE INDEX "token_usage_developerKeyId_createdAt_idx" ON "token_usage"("developerKeyId", "createdAt");
