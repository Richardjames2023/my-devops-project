# Customer Wishlist API

Base path: `/api/v1/wishlist`

All endpoints require a valid customer access token:

```http
Authorization: Bearer <customer-access-token>
```

Guest sessions and staff identities cannot use these endpoints.

## Retrieve the current customer's wishlist

`GET /api/v1/wishlist`

Returns only the authenticated customer's saved products.

Successful response:

```json
{
  "message": "Wishlist retrieved successfully",
  "wishlist": {
    "items": [
      {
        "id": "wishlist-item-uuid",
        "addedAt": "2026-11-12T12:00:00.000Z",
        "product": {
          "id": "product-uuid",
          "name": "Example product",
          "slug": "example-product",
          "description": "Product description",
          "basePrice": "100.00",
          "image": {
            "url": "https://example.test/product.jpg",
            "altText": "Example product"
          },
          "isActive": true,
          "isAvailable": true,
          "variants": [
            {
              "id": "variant-uuid",
              "name": "Standard",
              "sku": "EXAMPLE-001",
              "price": "100.00",
              "isActive": true,
              "availableQuantity": 7,
              "isAvailable": true
            }
          ]
        }
      }
    ],
    "itemCount": 1
  }
}
```

Availability is calculated from active product/variant state and stock remaining after reservations and quarantine. Products already saved remain in the wishlist if subsequently deactivated or unavailable; their status is returned so the storefront can explain the change.

## Add a product

`POST /api/v1/wishlist`

Request:

```json
{
  "productId": "product-uuid"
}
```

Only active products can be newly added. Repeated additions are idempotent and do not create duplicate entries. The response contains the updated wishlist.

## Remove a product

`DELETE /api/v1/wishlist/:productId`

Removes the product only from the authenticated customer's wishlist. Returns the updated wishlist. Returns `404` if the product is not in that customer's wishlist.

## Error behavior

- `400`: malformed product UUID or request validation failure.
- `401`: missing, invalid, or expired authentication.
- `403`: identity is not an active, verified customer.
- `404`: product is missing/inactive on add, or the item does not exist in the customer's wishlist on remove.

## MVP boundaries

- Wishlists are authenticated-customer-only; guest wishlists are not supported.
- Wishlist entries are product-level, not variant-level. All variants and their current availability are included in the response.
- Adding an item to the cart remains a separate cart operation and must continue to use existing cart validation.
