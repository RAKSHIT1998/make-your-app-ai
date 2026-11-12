-- CreateEnum
CREATE TYPE "ProjectVisibility" AS ENUM ('private', 'public');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('open', 'dismissed', 'actioned');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'rewarded', 'rejected');

-- AlterEnum
ALTER TYPE "LedgerReason" ADD VALUE 'referral';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bio" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "handle" TEXT,
ADD COLUMN     "referralCode" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "allowRemix" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "featuredAt" TIMESTAMP(3),
ADD COLUMN     "likeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "moderatedAt" TIMESTAMP(3),
ADD COLUMN     "moderationNote" TEXT,
ADD COLUMN     "publicDescription" TEXT,
ADD COLUMN     "publicTitle" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedVersionId" UUID,
ADD COLUMN     "remixCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "remixedFromId" UUID,
ADD COLUMN     "showAttribution" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slug" TEXT,
ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visibility" "ProjectVisibility" NOT NULL DEFAULT 'private';

-- CreateTable
CREATE TABLE "ProjectLike" (
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectLike_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "ProjectViewDay" (
    "projectId" UUID NOT NULL,
    "viewerKey" TEXT NOT NULL,
    "day" DATE NOT NULL,

    CONSTRAINT "ProjectViewDay_pkey" PRIMARY KEY ("projectId","viewerKey","day")
);

-- CreateTable
CREATE TABLE "ProjectReport" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "status" "ReportStatus" NOT NULL DEFAULT 'open',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" UUID NOT NULL,
    "referrerId" UUID NOT NULL,
    "referredUserId" UUID NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
    "rejectReason" TEXT,
    "invoiceId" UUID,
    "referrerCredits" INTEGER NOT NULL DEFAULT 0,
    "referredCredits" INTEGER NOT NULL DEFAULT 0,
    "qualifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "referralsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "referrerRewardCredits" INTEGER NOT NULL DEFAULT 300,
    "referredRewardCredits" INTEGER NOT NULL DEFAULT 150,
    "maxRewardsPerMonth" INTEGER NOT NULL DEFAULT 10,
    "claimWindowDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrowthSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectLike_projectId_createdAt_idx" ON "ProjectLike"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectViewDay_projectId_day_idx" ON "ProjectViewDay"("projectId", "day");

-- CreateIndex
CREATE INDEX "ProjectReport_status_createdAt_idx" ON "ProjectReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectReport_projectId_reporterId_key" ON "ProjectReport"("projectId", "reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_referredUserId_key" ON "Referral"("referredUserId");

-- CreateIndex
CREATE INDEX "Referral_referrerId_createdAt_idx" ON "Referral"("referrerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE INDEX "Project_visibility_publishedAt_idx" ON "Project"("visibility", "publishedAt");

-- CreateIndex
CREATE INDEX "Project_remixedFromId_idx" ON "Project"("remixedFromId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_remixedFromId_fkey" FOREIGN KEY ("remixedFromId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLike" ADD CONSTRAINT "ProjectLike_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLike" ADD CONSTRAINT "ProjectLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectViewDay" ADD CONSTRAINT "ProjectViewDay_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReport" ADD CONSTRAINT "ProjectReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReport" ADD CONSTRAINT "ProjectReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: defence in depth (API connects as owner). Deny-all for direct client access.
ALTER TABLE "ProjectLike" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectViewDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Referral" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GrowthSettings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Project" ADD COLUMN "publishedSnapshot" JSONB;
