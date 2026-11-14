-- Customer account deletion lifecycle. User rows are retained after anonymization
-- because historical orders, reviews, returns, warranties and audit records refer to them.
CREATE TYPE "CustomerAccountDeletionStatus" AS ENUM ('REQUESTED', 'CANCELLED', 'COMPLETED');

CREATE TABLE "customer_account_deletions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "CustomerAccountDeletionStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastDeferredAt" TIMESTAMP(3),
    "deferralCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_account_deletions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_account_deletions_userId_key"
ON "customer_account_deletions"("userId");
CREATE INDEX "customer_account_deletions_status_scheduledFor_idx"
ON "customer_account_deletions"("status", "scheduledFor");

ALTER TABLE "customer_account_deletions"
ADD CONSTRAINT "customer_account_deletions_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
