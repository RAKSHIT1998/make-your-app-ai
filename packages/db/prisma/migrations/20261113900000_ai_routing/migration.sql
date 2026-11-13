-- AlterTable
ALTER TABLE "AiProviderConfig" ADD COLUMN     "dailyRequestLimit" INTEGER,
ADD COLUMN     "dailyTokenLimit" INTEGER,
ADD COLUMN     "quality" INTEGER NOT NULL DEFAULT 100;

-- CreateTable
CREATE TABLE "AiTierRate" (
    "tier" TEXT NOT NULL,
    "inputCostPerMTokMicros" INTEGER NOT NULL,
    "outputCostPerMTokMicros" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTierRate_pkey" PRIMARY KEY ("tier")
);
ALTER TABLE "AiTierRate" ENABLE ROW LEVEL SECURITY;
