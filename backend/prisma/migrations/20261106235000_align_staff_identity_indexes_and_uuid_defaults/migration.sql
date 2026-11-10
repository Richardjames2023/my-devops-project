-- AlterTable
ALTER TABLE "staff_account_roles" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "staff_accounts" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "staff_invitation_roles" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "staff_invitations" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "staff_refresh_tokens" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "audit_logs_staffAccountId_idx" ON "audit_logs"("staffAccountId");

-- CreateIndex
CREATE INDEX "payment_inventory_reconciliations_resolvedByStaffAccountId_idx" ON "payment_inventory_reconciliations"("resolvedByStaffAccountId");

-- CreateIndex
CREATE INDEX "return_item_inspections_inspectedByStaffAccountId_createdAt_idx" ON "return_item_inspections"("inspectedByStaffAccountId", "createdAt");
