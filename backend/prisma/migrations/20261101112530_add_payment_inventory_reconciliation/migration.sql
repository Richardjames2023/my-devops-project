-- CreateEnum
CREATE TYPE "InventoryReconciliationStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'REFUND_PENDING', 'RESOLVED_FULFILLED', 'RESOLVED_REFUNDED');

-- CreateTable
CREATE TABLE "payment_inventory_reconciliations" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "refundId" UUID,
    "status" "InventoryReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "resolutionNotes" TEXT,
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_inventory_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_inventory_reconciliations_paymentId_key" ON "payment_inventory_reconciliations"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_inventory_reconciliations_refundId_key" ON "payment_inventory_reconciliations"("refundId");

-- CreateIndex
CREATE INDEX "payment_inventory_reconciliations_orderId_idx" ON "payment_inventory_reconciliations"("orderId");

-- CreateIndex
CREATE INDEX "payment_inventory_reconciliations_status_idx" ON "payment_inventory_reconciliations"("status");

-- CreateIndex
CREATE INDEX "payment_inventory_reconciliations_resolvedByUserId_idx" ON "payment_inventory_reconciliations"("resolvedByUserId");

-- AddForeignKey
ALTER TABLE "payment_inventory_reconciliations" ADD CONSTRAINT "payment_inventory_reconciliations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_inventory_reconciliations" ADD CONSTRAINT "payment_inventory_reconciliations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_inventory_reconciliations" ADD CONSTRAINT "payment_inventory_reconciliations_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_inventory_reconciliations" ADD CONSTRAINT "payment_inventory_reconciliations_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
