ALTER TABLE "cloudinary_cleanup_tasks"
ADD COLUMN "resourceType" TEXT NOT NULL DEFAULT 'image',
ADD COLUMN "deliveryType" TEXT NOT NULL DEFAULT 'upload';
