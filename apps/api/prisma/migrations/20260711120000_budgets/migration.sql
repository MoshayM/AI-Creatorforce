-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthlyLimit" INTEGER NOT NULL,
    "alertThreshold" INTEGER NOT NULL DEFAULT 80,
    "hardCap" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "budgets_userId_key" ON "budgets"("userId");

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
