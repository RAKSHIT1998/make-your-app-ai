-- Delivery extensions (Shiprocket): store settings and booked shipments.
-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "shippingProvider" TEXT,
ADD COLUMN     "shippingSettings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Shipment" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'created',
    "providerStatus" TEXT,
    "providerOrderId" TEXT NOT NULL,
    "providerShipmentId" TEXT NOT NULL,
    "awb" TEXT,
    "courierName" TEXT,
    "pickupScheduledFor" TEXT,
    "trackingUrl" TEXT,
    "estimatedDelivery" TEXT,
    "events" JSONB NOT NULL DEFAULT '[]',
    "lastError" TEXT,
    "parcel" JSONB NOT NULL DEFAULT '{}',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_orderId_key" ON "Shipment"("orderId");

-- CreateIndex
CREATE INDEX "Shipment_storeId_state_idx" ON "Shipment"("storeId", "state");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deny-by-default for direct database clients; the API connects as the owner role.
ALTER TABLE "Shipment" ENABLE ROW LEVEL SECURITY;
