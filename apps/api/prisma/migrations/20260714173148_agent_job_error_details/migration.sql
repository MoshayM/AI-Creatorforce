-- AlterTable
ALTER TABLE "agent_jobs" ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "errorDetails" JSONB;
