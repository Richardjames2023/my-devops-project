CREATE TABLE "customer_email_verification_tokens" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_email_verification_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_email_verification_tokens_tokenHash_key"
  ON "customer_email_verification_tokens"("tokenHash");
CREATE INDEX "customer_email_verification_tokens_userId_expiresAt_idx"
  ON "customer_email_verification_tokens"("userId", "expiresAt");
ALTER TABLE "customer_email_verification_tokens"
  ADD CONSTRAINT "customer_email_verification_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
