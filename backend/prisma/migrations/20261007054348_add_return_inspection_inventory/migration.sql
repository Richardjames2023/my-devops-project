-- AlterEnum
ALTER TYPE "ReturnStatus" ADD VALUE 'INSPECTED';

-- AlterTable
ALTER TABLE "inventory"
ADD COLUMN "quarantineQuantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "return_items"
ADD COLUMN "acceptedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "receivedQuantity" INTEGER NOT NULL DEFAULT 0;

-- Preserve the meaning of the existing accepted flag
UPDATE "return_items"
SET
  "acceptedQuantity" = CASE
    WHEN "accepted" = true THEN "quantity"
    ELSE 0
  END,
  "receivedQuantity" = CASE
    WHEN "accepted" = true THEN "quantity"
    ELSE 0
  END;

-- Remove the old boolean now that its information has been migrated
ALTER TABLE "return_items"
DROP COLUMN "accepted";