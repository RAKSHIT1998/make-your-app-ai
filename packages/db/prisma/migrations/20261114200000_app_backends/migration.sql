-- Built-in backends for generated full-stack apps (data, end-user accounts, sessions).
-- CreateTable
CREATE TABLE "AppBackend" (
    "projectId" UUID NOT NULL,
    "previewKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppBackend_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "AppUser" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "env" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "lastSignInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSession" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "appUserId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppRecord" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "env" TEXT NOT NULL,
    "collection" TEXT NOT NULL,
    "ownerId" UUID,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppBackend_previewKey_key" ON "AppBackend"("previewKey");

-- CreateIndex
CREATE UNIQUE INDEX "AppUser_projectId_env_email_key" ON "AppUser"("projectId", "env", "email");

-- CreateIndex
CREATE UNIQUE INDEX "AppSession_tokenHash_key" ON "AppSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AppSession_appUserId_idx" ON "AppSession"("appUserId");

-- CreateIndex
CREATE INDEX "AppRecord_projectId_env_collection_createdAt_idx" ON "AppRecord"("projectId", "env", "collection", "createdAt");

-- CreateIndex
CREATE INDEX "AppRecord_ownerId_idx" ON "AppRecord"("ownerId");

-- AddForeignKey
ALTER TABLE "AppBackend" ADD CONSTRAINT "AppBackend_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppUser" ADD CONSTRAINT "AppUser_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_appUserId_fkey" FOREIGN KEY ("appUserId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppRecord" ADD CONSTRAINT "AppRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppRecord" ADD CONSTRAINT "AppRecord_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deny-by-default for direct database clients; the API connects as the owner role.
ALTER TABLE "AppBackend" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppUser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppRecord" ENABLE ROW LEVEL SECURITY;
