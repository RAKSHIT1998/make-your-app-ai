-- CreateTable
CREATE TABLE "IdeaValidation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "idea" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "creditsCharged" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdeaValidation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IdeaValidation_organizationId_createdAt_idx" ON "IdeaValidation"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "IdeaValidation" ADD CONSTRAINT "IdeaValidation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IdeaValidation" ENABLE ROW LEVEL SECURITY;
