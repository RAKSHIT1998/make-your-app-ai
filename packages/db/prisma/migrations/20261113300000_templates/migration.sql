-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "fromTemplateId" UUID;

-- CreateTable
CREATE TABLE "Template" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT,
    "type" "ProjectType" NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'pending',
    "reviewNote" TEXT,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "featuredAt" TIMESTAMP(3),
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Template_projectId_key" ON "Template"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_slug_key" ON "Template"("slug");

-- CreateIndex
CREATE INDEX "Template_status_usesCount_idx" ON "Template"("status", "usesCount");

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Template" ENABLE ROW LEVEL SECURITY;
