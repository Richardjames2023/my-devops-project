ALTER TABLE "orders"
  ADD COLUMN "guestAccessTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "guestAccessTokenRevokedAt" TIMESTAMP(3);

-- Existing guest access tokens remain valid for two years from order creation.
UPDATE "orders"
SET "guestAccessTokenExpiresAt" = "createdAt" + INTERVAL '2 years'
WHERE "guestAccessTokenHash" IS NOT NULL;

CREATE INDEX "orders_guestAccessTokenExpiresAt_idx"
  ON "orders"("guestAccessTokenExpiresAt");
