import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import authRoutes from "./modules/auth/auth.routes";
import productRoutes from "./modules/products/product.routes";
import productVariantRoutes from "./modules/products/product-variant.routes";
import inventoryRoutes from "./modules/inventory/inventory.routes";
import stockMovementRoutes from "./modules/inventory/stock-movement.routes";
import inventoryReservationRoutes from "./modules/inventory/inventory-reservation.routes";
import orderRoutes from "./modules/orders/order.routes";
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
import { errorHandler } from "./common/errors/errorHandler";
import cookieParser from "cookie-parser";

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

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "UP" });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/product-variants", productVariantRoutes);
app.use("/api/v1/cart", cartRoutes);
app.use("/api/v1/inventory/movements", stockMovementRoutes);
app.use("/api/v1/inventory", inventoryRoutes);
app.use("/api/v1/inventory/reservations", inventoryReservationRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/fulfillments", fulfillmentRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/deliveries", deliveryRoutes);
app.use("/api/v1/returns", returnRoutes);
app.use("/api/v1/refunds", refundRoutes);
app.use("/api/v1/guest-session", guestSessionRoutes);
app.use("/api/v1/inventory-reconciliation", inventoryReconciliationRoutes);
app.use("/api/v1/guest-cart", guestCartRoutes);

app.use(errorHandler);

export default app;
