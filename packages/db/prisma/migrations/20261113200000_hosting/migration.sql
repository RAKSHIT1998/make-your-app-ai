-- AlterTable
ALTER TABLE "HostingDeployment" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'deploy',
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "versionNumber" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "HostingSite" (
    "projectId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "externalProjectId" TEXT NOT NULL,
    "productionUrl" TEXT,
    "liveDeploymentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostingSite_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "ProjectEnvVar" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectEnvVar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HostingSite_siteName_key" ON "HostingSite"("siteName");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEnvVar_projectId_key_key" ON "ProjectEnvVar"("projectId", "key");

-- CreateIndex
CREATE INDEX "HostingDeployment_projectId_createdAt_idx" ON "HostingDeployment"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "HostingSite" ADD CONSTRAINT "HostingSite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEnvVar" ADD CONSTRAINT "ProjectEnvVar_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HostingSite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectEnvVar" ENABLE ROW LEVEL SECURITY;
