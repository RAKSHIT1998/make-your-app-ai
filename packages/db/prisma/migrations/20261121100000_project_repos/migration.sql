-- Durable copy of each project's git repository; the API's disk is a cache of it.
CREATE TABLE "ProjectRepo" (
    "projectId" UUID NOT NULL,
    "head" TEXT NOT NULL,
    "bundle" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectRepo_pkey" PRIMARY KEY ("projectId")
);
ALTER TABLE "ProjectRepo" ENABLE ROW LEVEL SECURITY;
