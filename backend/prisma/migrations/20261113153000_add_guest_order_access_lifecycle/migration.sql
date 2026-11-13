ALTER TABLE "orders"
  ADD COLUMN "guestAccessTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "guestAccessTokenRevokedAt" TIMESTAMP(3);

-- Existing guest tokens remain valid for at least two years, or through the
-- longest purchased warranty plus a three-month recovery window.
UPDATE "orders" AS o
SET "guestAccessTokenExpiresAt" =
  o."createdAt" + make_interval(
    months => GREATEST(
      24,
      COALESCE((
        SELECT MAX(oi."warrantyDuration")
        FROM "order_items" AS oi
        WHERE oi."orderId" = o.id
      ), 0) + 3
    )
  )
WHERE o."guestAccessTokenHash" IS NOT NULL;

CREATE INDEX "orders_guestAccessTokenExpiresAt_idx"
  ON "orders"("guestAccessTokenExpiresAt");
