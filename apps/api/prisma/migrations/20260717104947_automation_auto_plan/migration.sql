-- AlterTable
ALTER TABLE "channel_automations" ADD COLUMN     "autoPlan" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastPlanAt" TIMESTAMP(3);
