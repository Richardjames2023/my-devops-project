/*
  Warnings:

  - You are about to drop the column `acceptedQuantity` on the `return_items` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "return_items" DROP COLUMN "acceptedQuantity";

-- CreateTable
CREATE TABLE "return_item_inspections" (
    "id" UUID NOT NULL,
    "returnItemId" UUID NOT NULL,
    "inspectedByUserId" UUID NOT NULL,
    "inspectedQuantity" INTEGER NOT NULL,
    "acceptedQuantity" INTEGER NOT NULL,
    "rejectedQuantity" INTEGER NOT NULL,
    "condition" "ReturnCondition" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_item_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "return_item_inspections_returnItemId_createdAt_idx" ON "return_item_inspections"("returnItemId", "createdAt");

-- CreateIndex
CREATE INDEX "return_item_inspections_inspectedByUserId_createdAt_idx" ON "return_item_inspections"("inspectedByUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "return_item_inspections" ADD CONSTRAINT "return_item_inspections_returnItemId_fkey" FOREIGN KEY ("returnItemId") REFERENCES "return_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_item_inspections" ADD CONSTRAINT "return_item_inspections_inspectedByUserId_fkey" FOREIGN KEY ("inspectedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
