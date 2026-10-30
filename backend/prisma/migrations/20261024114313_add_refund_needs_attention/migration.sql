-- AlterEnum
ALTER TYPE "RefundStatus" ADD VALUE 'NEEDS_ATTENTION';

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "needsAttentionAt" TIMESTAMP(3);
