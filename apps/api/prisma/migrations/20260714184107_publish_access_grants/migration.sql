-- CreateEnum
CREATE TYPE "PublishAccessStatus" AS ENUM ('REQUESTED', 'GRANTED', 'DENIED', 'REVOKED');

-- CreateTable
CREATE TABLE "publish_access_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PublishAccessStatus" NOT NULL,
    "note" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publish_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "publish_access_grants_userId_key" ON "publish_access_grants"("userId");

-- AddForeignKey
ALTER TABLE "publish_access_grants" ADD CONSTRAINT "publish_access_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
