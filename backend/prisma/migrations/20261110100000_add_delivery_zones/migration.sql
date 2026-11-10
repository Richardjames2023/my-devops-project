CREATE TABLE "delivery_zones" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "deliveryFee" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "delivery_zone_locations" (
    "id" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "delivery_zone_locations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "orders"
ADD COLUMN "deliveryZoneId" UUID,
ADD COLUMN "deliveryZoneName" TEXT;

CREATE UNIQUE INDEX "delivery_zones_name_key" ON "delivery_zones"("name");
CREATE INDEX "delivery_zones_isActive_idx" ON "delivery_zones"("isActive");
CREATE UNIQUE INDEX "delivery_zone_locations_state_city_key" ON "delivery_zone_locations"("state", "city");
CREATE INDEX "delivery_zone_locations_zoneId_idx" ON "delivery_zone_locations"("zoneId");
CREATE INDEX "orders_deliveryZoneId_idx" ON "orders"("deliveryZoneId");

ALTER TABLE "delivery_zone_locations"
ADD CONSTRAINT "delivery_zone_locations_zoneId_fkey"
FOREIGN KEY ("zoneId") REFERENCES "delivery_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "orders"
ADD CONSTRAINT "orders_deliveryZoneId_fkey"
FOREIGN KEY ("deliveryZoneId") REFERENCES "delivery_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
