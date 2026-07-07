-- CreateEnum
CREATE TYPE "ActionSource" AS ENUM ('UI', 'COPILOT', 'VOICE');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('EXECUTED', 'NEEDS_CONFIRMATION', 'FAILED');

-- CreateTable
CREATE TABLE "actions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "source" "ActionSource" NOT NULL,
    "intentType" TEXT NOT NULL,
    "intentPayload" JSONB NOT NULL DEFAULT '{}',
    "status" "ActionStatus" NOT NULL,
    "fromCache" BOOLEAN NOT NULL DEFAULT false,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copilot_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "lastIntentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "copilot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_commands" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "rawTranscript" TEXT NOT NULL,
    "resolvedIntent" JSONB,
    "executed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actionId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fromCache" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "actions_userId_createdAt_idx" ON "actions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "actions_projectId_createdAt_idx" ON "actions"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "copilot_sessions_userId_key" ON "copilot_sessions"("userId");

-- CreateIndex
CREATE INDEX "voice_commands_userId_createdAt_idx" ON "voice_commands"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "token_usage_userId_createdAt_idx" ON "token_usage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
