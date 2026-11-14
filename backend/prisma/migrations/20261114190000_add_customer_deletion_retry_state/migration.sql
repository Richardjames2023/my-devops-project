-- Persist retry state for transient failures in the customer account-deletion worker.
ALTER TABLE "customer_account_deletions"
ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastError" TEXT;
