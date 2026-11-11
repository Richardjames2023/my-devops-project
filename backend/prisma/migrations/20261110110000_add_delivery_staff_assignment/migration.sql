ALTER TABLE "deliveries"
ADD COLUMN "assignedStaffAccountId" UUID;

CREATE INDEX "deliveries_assignedStaffAccountId_idx"
ON "deliveries"("assignedStaffAccountId");

ALTER TABLE "deliveries"
ADD CONSTRAINT "deliveries_assignedStaffAccountId_fkey"
FOREIGN KEY ("assignedStaffAccountId")
REFERENCES "staff_accounts"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
