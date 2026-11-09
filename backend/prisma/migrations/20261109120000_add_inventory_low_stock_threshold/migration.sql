ALTER TABLE "inventory"
  ADD COLUMN "lowStockThreshold" INTEGER NOT NULL DEFAULT 5;

ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_lowStockThreshold_nonnegative_check"
  CHECK ("lowStockThreshold" >= 0);
