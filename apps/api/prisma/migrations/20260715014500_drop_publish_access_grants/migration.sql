-- Publish access gating removed (user decision 2026-07-15): publish +
-- download are available to every user; the per-user grant system is gone.
-- The create-migration is kept in history; this drops the unused table.
DROP TABLE "publish_access_grants";

DROP TYPE "PublishAccessStatus";
