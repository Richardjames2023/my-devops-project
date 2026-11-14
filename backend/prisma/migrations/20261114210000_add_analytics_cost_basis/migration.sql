-- Add optional cost basis fields without changing existing catalogue or order values.
ALTER TABLE "product_variants"
ADD COLUMN "costPrice" DECIMAL(12,2);

ALTER TABLE "order_items"
ADD COLUMN "unitCostSnapshot" DECIMAL(12,2);

-- Cost visibility and updates are restricted to the business-owner role by default.
INSERT INTO "permissions" ("id", "name", "description", "createdAt")
VALUES (
  gen_random_uuid(),
  'products.cost.manage',
  'View and update confidential product variant cost prices',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid(), r.id, p.id, CURRENT_TIMESTAMP
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name = 'BUSINESS_OWNER'
  AND p.name = 'products.cost.manage'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
