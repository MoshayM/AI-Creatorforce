-- Migration: 20260711190000_forecasts
-- Phase 5 §4.12 — BI Forecast cache table (Wave K)
-- Only adds the `forecasts` table; no existing tables are touched.

CREATE TABLE "forecasts" (
    "id"                 TEXT NOT NULL,
    "metric"             TEXT NOT NULL,
    "horizonDays"        INTEGER NOT NULL,
    "predictedValue"     DOUBLE PRECISION NOT NULL,
    "confidenceLow"      DOUBLE PRECISION NOT NULL,
    "confidenceHigh"     DOUBLE PRECISION NOT NULL,
    "method"             TEXT NOT NULL,
    "inputPointsCount"   INTEGER NOT NULL,
    "generatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecasts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "forecasts_metric_generatedAt_idx"
    ON "forecasts" ("metric", "generatedAt" DESC);
