-- AlterTable: make channelId nullable on projects, add contentFormat + platforms
ALTER TABLE "projects" ALTER COLUMN "channelId" DROP NOT NULL;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "contentFormat" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "platforms" TEXT[] NOT NULL DEFAULT '{}';

-- AlterTable: update FK constraint to SET NULL on channel delete
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_channelId_fkey";
ALTER TABLE "projects" ADD CONSTRAINT "projects_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
