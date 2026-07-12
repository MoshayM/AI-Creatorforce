-- Phase 5 Wave 10: per-key daily request rollup for developer API analytics
CREATE TABLE "developer_key_usage_days" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "developer_key_usage_days_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "developer_key_usage_days_keyId_day_key" ON "developer_key_usage_days"("keyId", "day");

ALTER TABLE "developer_key_usage_days" ADD CONSTRAINT "developer_key_usage_days_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "developer_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
