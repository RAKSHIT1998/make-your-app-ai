-- AlterEnum
ALTER TYPE "RunKind" ADD VALUE 'plan';

-- AlterTable
ALTER TABLE "GenerationRun" ADD COLUMN     "fromPlanId" UUID,
ADD COLUMN     "plan" JSONB;

-- CreateTable
CREATE TABLE "PlatformFlag" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID,

    CONSTRAINT "PlatformFlag_pkey" PRIMARY KEY ("key")
);
ALTER TABLE "PlatformFlag" ENABLE ROW LEVEL SECURITY;
