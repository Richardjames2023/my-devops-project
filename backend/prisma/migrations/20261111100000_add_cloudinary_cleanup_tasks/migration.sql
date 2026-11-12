CREATE TABLE "cloudinary_cleanup_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "publicId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockToken" UUID,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cloudinary_cleanup_tasks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cloudinary_cleanup_tasks_publicId_key" ON "cloudinary_cleanup_tasks"("publicId");
CREATE INDEX "cloudinary_cleanup_tasks_status_availableAt_idx" ON "cloudinary_cleanup_tasks"("status", "availableAt");
