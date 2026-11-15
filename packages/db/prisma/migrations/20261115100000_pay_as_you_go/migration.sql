-- AlterEnum
ALTER TYPE "CreditBucket" ADD VALUE 'payg';

-- CreateEnum
CREATE TYPE "PaygStatus" AS ENUM ('pending', 'active', 'past_due', 'disabled');
CREATE TYPE "PaygChargeStatus" AS ENUM ('pending', 'paid', 'failed');

-- CreateTable
CREATE TABLE "PaygAccount" (
    "organizationId" UUID NOT NULL,
    "status" "PaygStatus" NOT NULL DEFAULT 'pending',
    "provider" "PaymentProvider" NOT NULL,
    "currency" TEXT NOT NULL,
    "monthlyCapMinor" INTEGER NOT NULL,
    "providerCustomerId" TEXT,
    "providerToken" TEXT,
    "setupRef" TEXT,
    "cardLabel" TEXT,
    "premiumAi" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaygAccount_pkey" PRIMARY KEY ("organizationId")
);
CREATE UNIQUE INDEX "PaygAccount_setupRef_key" ON "PaygAccount"("setupRef");

CREATE TABLE "PaygCharge" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "providerRef" TEXT,
    "providerPaymentId" TEXT,
    "status" "PaygChargeStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "invoiceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    CONSTRAINT "PaygCharge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaygCharge_providerRef_key" ON "PaygCharge"("providerRef");
CREATE INDEX "PaygCharge_organizationId_createdAt_idx" ON "PaygCharge"("organizationId", "createdAt");
-- At most one unsettled charge per workspace, even with several API instances.
CREATE UNIQUE INDEX "PaygCharge_one_pending_per_org" ON "PaygCharge"("organizationId") WHERE "status" = 'pending';

ALTER TABLE "PaygAccount" ADD CONSTRAINT "PaygAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaygCharge" ADD CONSTRAINT "PaygCharge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Billing data: no direct client access (deny by default).
ALTER TABLE "PaygAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaygCharge" ENABLE ROW LEVEL SECURITY;
