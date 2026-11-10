ALTER TABLE "users" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "customer_password_reset_tokens" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_password_reset_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_password_reset_tokens_tokenHash_key"
  ON "customer_password_reset_tokens"("tokenHash");
CREATE INDEX "customer_password_reset_tokens_userId_expiresAt_idx"
  ON "customer_password_reset_tokens"("userId", "expiresAt");
ALTER TABLE "customer_password_reset_tokens"
  ADD CONSTRAINT "customer_password_reset_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
