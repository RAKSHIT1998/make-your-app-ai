-- CreateTable
CREATE TABLE "AppMember" (
    "projectId" UUID NOT NULL,
    "env" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppMember_pkey" PRIMARY KEY ("projectId","env","email")
);

-- AddForeignKey
ALTER TABLE "AppMember" ADD CONSTRAINT "AppMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Owner-managed data: no direct client access (deny by default).
ALTER TABLE "AppMember" ENABLE ROW LEVEL SECURITY;
