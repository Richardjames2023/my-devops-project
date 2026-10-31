/*
  Warnings:

  - A unique constraint covering the columns `[guestAccessTokenHash]` on the table `orders` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "guestAccessTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_guestAccessTokenHash_key" ON "orders"("guestAccessTokenHash");
