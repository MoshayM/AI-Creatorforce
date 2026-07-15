-- AlterEnum
ALTER TYPE "AssetKind" ADD VALUE 'EDIT_RENDER';

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'EDIT_RENDER';

-- CreateTable
CREATE TABLE "edit_projects" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "width" INTEGER NOT NULL DEFAULT 1920,
    "height" INTEGER NOT NULL DEFAULT 1080,
    "fps" INTEGER NOT NULL DEFAULT 30,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "timeline" JSONB NOT NULL DEFAULT '{}',
    "renderAssetId" TEXT,
    "renderStatus" TEXT NOT NULL DEFAULT 'NONE',
    "lastEditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "edit_projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "edit_projects_projectId_idx" ON "edit_projects"("projectId");

-- AddForeignKey
ALTER TABLE "edit_projects" ADD CONSTRAINT "edit_projects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

