ALTER TABLE "product_images"
ADD COLUMN "publicId" TEXT;

CREATE UNIQUE INDEX "product_images_publicId_key"
ON "product_images"("publicId");
