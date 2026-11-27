CREATE TYPE "SocialAuthProvider" AS ENUM ('GOOGLE', 'FACEBOOK');

CREATE TABLE "social_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "provider" "SocialAuthProvider" NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "social_accounts_provider_providerUserId_key"
ON "social_accounts"("provider", "providerUserId");
CREATE INDEX "social_accounts_userId_idx" ON "social_accounts"("userId");

ALTER TABLE "social_accounts"
ADD CONSTRAINT "social_accounts_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
