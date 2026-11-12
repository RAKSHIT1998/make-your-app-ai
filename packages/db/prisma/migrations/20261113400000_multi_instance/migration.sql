-- AlterTable
ALTER TABLE "GenerationRun" ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "workerId" TEXT;

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RateLimitHit_expiresAt_idx" ON "RateLimitHit"("expiresAt");

ALTER TABLE "RateLimitHit" ENABLE ROW LEVEL SECURITY;
-- Counters are disposable; skipping the write-ahead log makes them cheap.
ALTER TABLE "RateLimitHit" SET UNLOGGED;
