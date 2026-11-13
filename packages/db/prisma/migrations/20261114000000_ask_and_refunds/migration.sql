-- Ask mode (answers about a project without changing code) and the failed-build credit guarantee.
ALTER TYPE "RunKind" ADD VALUE 'ask';

ALTER TABLE "GenerationRun" ADD COLUMN     "answer" TEXT,
ADD COLUMN     "creditsRefunded" INTEGER NOT NULL DEFAULT 0;
