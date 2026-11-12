import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import authRoutes from "./modules/auth/auth.routes";
import staffAuthRoutes from "./modules/staff/staff-auth.routes";
import staffRoutes from "./modules/staff/staff.routes";
import productRoutes from "./modules/products/product.routes";
import productImageRoutes from "./modules/products/product-image.routes";
import categoryRoutes from "./modules/products/category.routes";
import productVariantRoutes from "./modules/products/product-variant.routes";
import inventoryRoutes from "./modules/inventory/inventory.routes";
import stockMovementRoutes from "./modules/inventory/stock-movement.routes";
import inventoryReservationRoutes from "./modules/inventory/inventory-reservation.routes";
import orderRoutes from "./modules/orders/order.routes";
import staffOrderRoutes from "./modules/orders/staff-order.routes";
import paymentRoutes from "./modules/payment/payment.routes";
import fulfillmentRoutes from "./modules/fulfillment/fulfillment.routes";
import deliveryRoutes from "./modules/delivery/delivery.routes";
import returnRoutes from "./modules/return/return.routes";
import { paystackWebhook } from "./modules/payment/payment.controller";
import refundRoutes from "./modules/refund/refund.routes";
import cartRoutes from "./modules/cart/cart.routes";
import guestSessionRoutes from "./modules/guest-session/guest-session.routes";
import guestCartRoutes from "./modules/cart/guest-cart.routes";
import inventoryReconciliationRoutes from "./modules/inventory-reconciliation/inventory-reconciliation.routes";
import warrantyClaimRoutes from "./modules/warranty-claims/warranty-claim.routes";
import productReviewRoutes from "./modules/product-reviews/product-review.routes";
import notificationInboxRoutes from "./modules/notifications/notification-inbox.routes";
import staffNotificationInboxRoutes from "./modules/notifications/staff-notification-inbox.routes";
import notificationPreferenceRoutes from "./modules/notifications/notification-preferences.routes";
import staffNotificationPreferenceRoutes from "./modules/notifications/staff-notification-preferences.routes";
import notificationOperationsRoutes from "./modules/notifications/notification-operations.routes";
import { resendEmailWebhook } from "./modules/notifications/notification-email-webhook.controller";
import { errorHandler } from "./common/errors/errorHandler";
import cookieParser from "cookie-parser";
import healthRoutes from "./modules/health/health.routes";
import deliveryZoneRoutes from "./modules/delivery-zones/delivery-zone.routes";
import deliveryZonePublicRoutes from "./modules/delivery-zones/delivery-zone.public.routes";
import couponRoutes from "./modules/coupons/coupon.routes";

const app = express();
const allowedOrigins = env.CORS_ORIGIN.split(",").map((origin) => origin.trim());

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Permit non-browser requests (webhooks and server-to-server calls).
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed by CORS"));
    },
    credentials: true,
  }),
);
app.use(cookieParser());

app.post(
  "/api/v1/payments/paystack/webhook",
  express.raw({
    type: "application/json",
    limit: "100kb",
  }),
  paystackWebhook,
);

app.post(
  "/api/v1/notifications/webhooks/resend",
  express.raw({ type: "application/json", limit: "100kb" }),
  resendEmailWebhook,
);

app.use(express.json());

app.use("/health", healthRoutes);

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/notifications", notificationInboxRoutes);
app.use("/api/v1/staff/notifications", staffNotificationInboxRoutes);
app.use("/api/v1/notifications/preferences", notificationPreferenceRoutes);
app.use("/api/v1/staff/notifications/preferences", staffNotificationPreferenceRoutes);
app.use("/api/v1/staff/notifications/operations", notificationOperationsRoutes);
app.use("/api/v1/staff-auth", staffAuthRoutes);
app.use("/api/v1/staff/orders", staffOrderRoutes);
app.use("/api/v1/staff", staffRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/products", productImageRoutes);
app.use("/api/v1/categories", categoryRoutes);
app.use("/api/v1/product-variants", productVariantRoutes);
app.use("/api/v1/cart", cartRoutes);
app.use("/api/v1/inventory/movements", stockMovementRoutes);
app.use("/api/v1/inventory", inventoryRoutes);
app.use("/api/v1/inventory/reservations", inventoryReservationRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/coupons", couponRoutes);
app.use("/api/v1/fulfillments", fulfillmentRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/deliveries", deliveryRoutes);
app.use("/api/v1/delivery-zones", deliveryZonePublicRoutes);
app.use("/api/v1/staff/delivery-zones", deliveryZoneRoutes);
app.use("/api/v1/returns", returnRoutes);
app.use("/api/v1/warranty-claims", warrantyClaimRoutes);
app.use("/api/v1/reviews", productReviewRoutes);
app.use("/api/v1/refunds", refundRoutes);
app.use("/api/v1/guest-session", guestSessionRoutes);
app.use("/api/v1/inventory-reconciliation", inventoryReconciliationRoutes);
app.use("/api/v1/guest-cart", guestCartRoutes);

app.use(errorHandler);

export default app;
