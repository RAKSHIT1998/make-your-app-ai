-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('draft', 'published', 'cancelled');

-- CreateTable
CREATE TABLE "Challenge" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "projectTypes" "ProjectType"[],
    "prize" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "submissionsCloseAt" TIMESTAMP(3) NOT NULL,
    "votingClosesAt" TIMESTAMP(3) NOT NULL,
    "votesPerUser" INTEGER NOT NULL DEFAULT 3,
    "status" "ChallengeStatus" NOT NULL DEFAULT 'draft',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Challenge_slug_key" ON "Challenge"("slug");
CREATE INDEX "Challenge_status_startsAt_idx" ON "Challenge"("status", "startsAt");

CREATE TABLE "ChallengeEntry" (
    "id" UUID NOT NULL,
    "challengeId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "submittedById" UUID NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "hiddenAt" TIMESTAMP(3),
    "hiddenNote" TEXT,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChallengeEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChallengeEntry_challengeId_projectId_key" ON "ChallengeEntry"("challengeId", "projectId");
CREATE UNIQUE INDEX "ChallengeEntry_challengeId_organizationId_key" ON "ChallengeEntry"("challengeId", "organizationId");
CREATE INDEX "ChallengeEntry_challengeId_voteCount_idx" ON "ChallengeEntry"("challengeId", "voteCount");

CREATE TABLE "ChallengeVote" (
    "entryId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "challengeId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChallengeVote_pkey" PRIMARY KEY ("entryId", "userId")
);
CREATE INDEX "ChallengeVote_challengeId_userId_idx" ON "ChallengeVote"("challengeId", "userId");

ALTER TABLE "ChallengeEntry" ADD CONSTRAINT "ChallengeEntry_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeEntry" ADD CONSTRAINT "ChallengeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeVote" ADD CONSTRAINT "ChallengeVote_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ChallengeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChallengeVote" ADD CONSTRAINT "ChallengeVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No direct client access (deny by default).
ALTER TABLE "Challenge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChallengeEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChallengeVote" ENABLE ROW LEVEL SECURITY;
