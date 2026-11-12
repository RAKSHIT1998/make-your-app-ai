-- Billing (spec v3 Phase 2). Plan pricing columns move to PlanPrice; Plan had no rows before this migration.
-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('monthly', 'yearly');

-- CreateEnum
CREATE TYPE "CheckoutKind" AS ENUM ('subscription', 'topup');

-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('created', 'completed', 'expired', 'failed');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('paid', 'partially_refunded', 'refunded', 'void');

-- CreateEnum
CREATE TYPE "CreditBucket" AS ENUM ('allowance', 'purchased');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionStatus" ADD VALUE 'halted';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'expired';

-- AlterEnum
ALTER TYPE "LedgerReason" ADD VALUE 'expiry';

-- AlterTable
ALTER TABLE "Plan" DROP COLUMN "currency",
DROP COLUMN "priceMonthlyMinor",
DROP COLUMN "providerPriceIds",
ADD COLUMN     "dailyCreditLimit" INTEGER,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "featureFlags" TEXT[],
ADD COLUMN     "maxCreditsPerRun" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "monthlyBuildCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "projectTypes" TEXT[],
ADD COLUMN     "public" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "priceId" UUID,
ADD COLUMN     "providerCustomerId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'incomplete';

-- AlterTable
ALTER TABLE "CreditLedgerEntry" ADD COLUMN     "bucket" "CreditBucket" NOT NULL DEFAULT 'allowance';

-- CreateTable
CREATE TABLE "PlanPrice" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "currency" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "razorpayPlanId" TEXT,
    "stripePriceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEntitlement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "monthlyCredits" INTEGER NOT NULL,
    "maxActiveProjects" INTEGER NOT NULL,
    "dailyCreditLimit" INTEGER,
    "maxCreditsPerRun" INTEGER NOT NULL,
    "monthlyBuildCredits" INTEGER NOT NULL,
    "teamSeats" INTEGER NOT NULL,
    "featureFlags" TEXT[],
    "projectTypes" TEXT[],
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCheckout" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "kind" "CheckoutKind" NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerRef" TEXT NOT NULL,
    "providerSubscriptionId" TEXT,
    "planPriceId" UUID,
    "creditPackId" UUID,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'created',
    "clientParams" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BillingCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditPack" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "subscriptionId" UUID,
    "checkoutId" UUID,
    "description" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "feeMinor" INTEGER,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'paid',
    "provider" "PaymentProvider" NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanPrice_razorpayPlanId_key" ON "PlanPrice"("razorpayPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanPrice_stripePriceId_key" ON "PlanPrice"("stripePriceId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanPrice_planId_interval_currency_key" ON "PlanPrice"("planId", "interval", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionEntitlement_organizationId_key" ON "SubscriptionEntitlement"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCheckout_providerRef_key" ON "BillingCheckout"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCheckout_providerSubscriptionId_key" ON "BillingCheckout"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "BillingCheckout_organizationId_createdAt_idx" ON "BillingCheckout"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_providerPaymentId_key" ON "Invoice"("providerPaymentId");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_paidAt_idx" ON "Invoice"("organizationId", "paidAt");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_organizationId_bucket_idx" ON "CreditLedgerEntry"("organizationId", "bucket");

-- AddForeignKey
ALTER TABLE "PlanPrice" ADD CONSTRAINT "PlanPrice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_priceId_fkey" FOREIGN KEY ("priceId") REFERENCES "PlanPrice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEntitlement" ADD CONSTRAINT "SubscriptionEntitlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEntitlement" ADD CONSTRAINT "SubscriptionEntitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCheckout" ADD CONSTRAINT "BillingCheckout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Human-readable invoice numbers (MYA-000001).
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PlanPrice','SubscriptionEntitlement','BillingCheckout','CreditPack','Invoice'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
CREATE POLICY plan_price_public ON "PlanPrice" FOR SELECT USING (active);
CREATE POLICY credit_pack_public ON "CreditPack" FOR SELECT USING (active);
CREATE POLICY entitlement_member ON "SubscriptionEntitlement" FOR SELECT USING (mya_is_member("organizationId"));
CREATE POLICY invoice_member ON "Invoice" FOR SELECT USING (mya_is_member("organizationId"));
CREATE POLICY checkout_member ON "BillingCheckout" FOR SELECT USING (mya_is_member("organizationId"));

ALTER TABLE "Invoice" ADD CONSTRAINT invoice_amounts_valid CHECK ("totalMinor" >= 0 AND "refundedMinor" >= 0 AND "refundedMinor" <= "totalMinor");
ALTER TABLE "PlanPrice" ADD CONSTRAINT plan_price_nonnegative CHECK ("amountMinor" >= 0);
ALTER TABLE "CreditPack" ADD CONSTRAINT credit_pack_valid CHECK ("credits" > 0 AND "priceMinor" > 0);
