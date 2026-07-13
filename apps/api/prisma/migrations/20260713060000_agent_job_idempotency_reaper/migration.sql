-- Phase 5 Wave 17: enqueue idempotency (risk R-02) + stalled-job reaper index (risk R-01)
ALTER TABLE "agent_jobs" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "agent_jobs_idempotencyKey_key" ON "agent_jobs"("idempotencyKey");

CREATE INDEX "agent_jobs_status_updatedAt_idx" ON "agent_jobs"("status", "updatedAt");
