-- Give each refresh-token login session its own family.
-- Existing tokens receive independent families because their historical
-- rotation lineage cannot be reconstructed safely.
ALTER TABLE "refresh_tokens"
  ADD COLUMN "familyId" UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE "staff_refresh_tokens"
  ADD COLUMN "familyId" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE INDEX "refresh_tokens_familyId_revokedAt_idx"
  ON "refresh_tokens" ("familyId", "revokedAt");

CREATE INDEX "staff_refresh_tokens_familyId_revokedAt_idx"
  ON "staff_refresh_tokens" ("familyId", "revokedAt");
