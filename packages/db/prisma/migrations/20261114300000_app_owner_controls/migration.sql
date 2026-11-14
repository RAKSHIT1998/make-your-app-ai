-- AlterTable
ALTER TABLE "AppBackend" ADD COLUMN     "paused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "signupsOpen" BOOLEAN NOT NULL DEFAULT true;
