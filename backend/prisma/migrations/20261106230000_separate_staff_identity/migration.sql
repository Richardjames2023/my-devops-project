-- Separate staff identities from customer accounts while preserving legacy actor history.
CREATE TYPE "StaffAccountStatus" AS ENUM ('PENDING_SETUP', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');
CREATE TYPE "StaffInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

CREATE TABLE "staff_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "passwordHash" TEXT,
  "status" "StaffAccountStatus" NOT NULL DEFAULT 'PENDING_SETUP',
  "emailVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_accounts_email_key" ON "staff_accounts"("email");
CREATE INDEX "staff_accounts_status_idx" ON "staff_accounts"("status");

CREATE TABLE "staff_account_roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "staffAccountId" UUID NOT NULL,
  "roleId" UUID NOT NULL,
  "assignedByStaffAccountId" UUID,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_account_roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_account_roles_staffAccountId_roleId_key" ON "staff_account_roles"("staffAccountId", "roleId");
CREATE INDEX "staff_account_roles_staffAccountId_idx" ON "staff_account_roles"("staffAccountId");
CREATE INDEX "staff_account_roles_roleId_idx" ON "staff_account_roles"("roleId");
CREATE INDEX "staff_account_roles_assignedByStaffAccountId_idx" ON "staff_account_roles"("assignedByStaffAccountId");

CREATE TABLE "staff_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "StaffInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdByStaffAccountId" UUID,
  CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_invitations_tokenHash_key" ON "staff_invitations"("tokenHash");
CREATE INDEX "staff_invitations_email_status_idx" ON "staff_invitations"("email", "status");
CREATE INDEX "staff_invitations_expiresAt_status_idx" ON "staff_invitations"("expiresAt", "status");
CREATE INDEX "staff_invitations_createdByStaffAccountId_idx" ON "staff_invitations"("createdByStaffAccountId");
CREATE UNIQUE INDEX "staff_invitations_one_pending_email_key"
ON "staff_invitations"("email") WHERE "status" = 'PENDING';

CREATE TABLE "staff_invitation_roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invitationId" UUID NOT NULL,
  "roleId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_invitation_roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_invitation_roles_invitationId_roleId_key" ON "staff_invitation_roles"("invitationId", "roleId");
CREATE INDEX "staff_invitation_roles_invitationId_idx" ON "staff_invitation_roles"("invitationId");
CREATE INDEX "staff_invitation_roles_roleId_idx" ON "staff_invitation_roles"("roleId");

CREATE TABLE "staff_refresh_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "staffAccountId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_refresh_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_refresh_tokens_tokenHash_key" ON "staff_refresh_tokens"("tokenHash");
CREATE INDEX "staff_refresh_tokens_staffAccountId_idx" ON "staff_refresh_tokens"("staffAccountId");
CREATE INDEX "staff_refresh_tokens_expiresAt_idx" ON "staff_refresh_tokens"("expiresAt");

ALTER TABLE "audit_logs" ADD COLUMN "staffAccountId" UUID;
ALTER TABLE "return_item_inspections" ADD COLUMN "inspectedByStaffAccountId" UUID;
ALTER TABLE "return_item_inspections" ALTER COLUMN "inspectedByUserId" DROP NOT NULL;
ALTER TABLE "payment_inventory_reconciliations" ADD COLUMN "resolvedByStaffAccountId" UUID;

-- Temporary mapping is used only during migration and is dropped before completion.
CREATE TEMP TABLE "_legacy_staff_identity_map" (
  "legacyUserId" UUID PRIMARY KEY,
  "staffAccountId" UUID NOT NULL
);

-- Convert every legacy non-customer role holder into a separate staff identity.
-- Legacy customer credentials remain exclusively on the User record.
INSERT INTO "staff_accounts" (
  "email", "firstName", "lastName", "passwordHash",
  "status", "createdAt", "updatedAt"
)
SELECT lower(u."email"), u."firstName", u."lastName", NULL,
       'PENDING_SETUP'::"StaffAccountStatus", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
WHERE EXISTS (
  SELECT 1
  FROM "user_roles" ur
  JOIN "roles" r ON r."id" = ur."roleId"
  WHERE ur."userId" = u."id" AND r."name" <> 'CUSTOMER'
);

INSERT INTO "_legacy_staff_identity_map" ("legacyUserId", "staffAccountId")
SELECT u."id", sa."id"
FROM "users" u
JOIN "staff_accounts" sa ON sa."email" = lower(u."email")
WHERE EXISTS (
  SELECT 1 FROM "user_roles" ur
  JOIN "roles" r ON r."id" = ur."roleId"
  WHERE ur."userId" = u."id" AND r."name" <> 'CUSTOMER'
);

-- Preserve every legacy staff role, but require the staff member to establish
-- a new, independent credential before the staff account can be activated.
INSERT INTO "staff_account_roles" ("staffAccountId", "roleId", "assignedAt")
SELECT legacy_map."staffAccountId", ur."roleId", ur."createdAt"
FROM "_legacy_staff_identity_map" legacy_map
JOIN "user_roles" ur ON ur."userId" = legacy_map."legacyUserId"
JOIN "roles" r ON r."id" = ur."roleId"
WHERE r."name" <> 'CUSTOMER';

-- Move historical staff actions to the staff actor column without losing the
-- original actor identity. Customer-originated audit records remain on userId.
UPDATE "audit_logs" al
SET "staffAccountId" = legacy_map."staffAccountId", "userId" = NULL
FROM "_legacy_staff_identity_map" legacy_map
WHERE al."userId" = legacy_map."legacyUserId";

UPDATE "return_item_inspections" ri
SET "inspectedByStaffAccountId" = legacy_map."staffAccountId", "inspectedByUserId" = NULL
FROM "_legacy_staff_identity_map" legacy_map
WHERE ri."inspectedByUserId" = legacy_map."legacyUserId";

UPDATE "payment_inventory_reconciliations" pir
SET "resolvedByStaffAccountId" = legacy_map."staffAccountId", "resolvedByUserId" = NULL
FROM "_legacy_staff_identity_map" legacy_map
WHERE pir."resolvedByUserId" = legacy_map."legacyUserId";

DROP TABLE "_legacy_staff_identity_map";

-- Every User row remains a customer identity. This intentionally keeps
-- customer login credentials and commerce history separate from staff access.
INSERT INTO "user_roles" ("id", "userId", "roleId", "createdAt")
SELECT gen_random_uuid(), u."id", customer."id", CURRENT_TIMESTAMP
FROM "users" u
CROSS JOIN "roles" customer
WHERE customer."name" = 'CUSTOMER'
  AND NOT EXISTS (
    SELECT 1 FROM "user_roles" existing
    WHERE existing."userId" = u."id" AND existing."roleId" = customer."id"
  );

DELETE FROM "user_roles" ur
USING "roles" r
WHERE ur."roleId" = r."id" AND r."name" <> 'CUSTOMER';

ALTER TABLE "staff_account_roles"
  ADD CONSTRAINT "staff_account_roles_staffAccountId_fkey"
  FOREIGN KEY ("staffAccountId") REFERENCES "staff_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_account_roles"
  ADD CONSTRAINT "staff_account_roles_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_account_roles"
  ADD CONSTRAINT "staff_account_roles_assignedByStaffAccountId_fkey"
  FOREIGN KEY ("assignedByStaffAccountId") REFERENCES "staff_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "staff_invitations"
  ADD CONSTRAINT "staff_invitations_createdByStaffAccountId_fkey"
  FOREIGN KEY ("createdByStaffAccountId") REFERENCES "staff_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "staff_invitation_roles"
  ADD CONSTRAINT "staff_invitation_roles_invitationId_fkey"
  FOREIGN KEY ("invitationId") REFERENCES "staff_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_invitation_roles"
  ADD CONSTRAINT "staff_invitation_roles_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_refresh_tokens"
  ADD CONSTRAINT "staff_refresh_tokens_staffAccountId_fkey"
  FOREIGN KEY ("staffAccountId") REFERENCES "staff_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_staffAccountId_fkey"
  FOREIGN KEY ("staffAccountId") REFERENCES "staff_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "return_item_inspections"
  ADD CONSTRAINT "return_item_inspections_inspectedByStaffAccountId_fkey"
  FOREIGN KEY ("inspectedByStaffAccountId") REFERENCES "staff_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_inventory_reconciliations"
  ADD CONSTRAINT "payment_inventory_reconciliations_resolvedByStaffAccountId_fkey"
  FOREIGN KEY ("resolvedByStaffAccountId") REFERENCES "staff_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_single_actor_check"
  CHECK (NOT ("userId" IS NOT NULL AND "staffAccountId" IS NOT NULL));
ALTER TABLE "return_item_inspections"
  ADD CONSTRAINT "return_item_inspections_single_actor_check"
  CHECK (("inspectedByUserId" IS NOT NULL) <> ("inspectedByStaffAccountId" IS NOT NULL));
ALTER TABLE "payment_inventory_reconciliations"
  ADD CONSTRAINT "payment_inventory_reconciliations_single_actor_check"
  CHECK (NOT ("resolvedByUserId" IS NOT NULL AND "resolvedByStaffAccountId" IS NOT NULL));
