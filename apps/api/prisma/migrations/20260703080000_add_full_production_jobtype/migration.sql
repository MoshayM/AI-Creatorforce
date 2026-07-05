-- Baseline: FULL_PRODUCTION was added to the live DB via `prisma db push`;
-- this migration records it so migrate history matches the database.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'FULL_PRODUCTION';
