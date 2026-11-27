"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bell, BriefcaseBusiness, ChevronRight, CircleUserRound, ClipboardList,
  Heart, LogOut, MapPin, Package, RotateCcw, ShieldCheck, ShoppingBag,
} from "lucide-react";
import { ApiError, apiRequest, getAccessToken } from "@/lib/api/client";

type OrderStatus = "PENDING" | "CONFIRMED" | "PROCESSING" | "PARTIALLY_FULFILLED" | "FULFILLED" | "CANCELLED" | "COMPLETED";
type OrderItem = { id: string; productName: string; variantName: string; quantity: number };
type CustomerOrder = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: string | number;
  currency: string;
  createdAt: string;
  items: OrderItem[];
};
type OrdersResponse = { orders: CustomerOrder[]; pagination: { total: number } };

const sections = [
  { id: "overview", label: "Overview", icon: CircleUserRound },
  { id: "orders", label: "My Orders", icon: ClipboardList },
  { id: "addresses", label: "Addresses", icon: MapPin },
  { id: "saved", label: "Saved Items", icon: Heart },
  { id: "returns", label: "Returns & Refunds", icon: RotateCcw },
  { id: "warranty", label: "Warranty", icon: ShieldCheck },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "settings", label: "Account Settings", icon: BriefcaseBusiness },
];

const orderTabs = [
  { id: "all", label: "All Orders" },
  { id: "processing", label: "Processing" },
  { id: "shipped", label: "Shipped" },
  { id: "delivered", label: "Delivered" },
  { id: "cancelled", label: "Cancelled" },
] as const;

type OrderTab = (typeof orderTabs)[number]["id"];

function orderGroup(status: OrderStatus): OrderTab {
  if (status === "CANCELLED") return "cancelled";
  if (status === "COMPLETED") return "delivered";
  if (status === "FULFILLED") return "shipped";
  return "processing";
}

function statusLabel(status: OrderStatus) {
  if (status === "CANCELLED") return "Cancelled";
  if (status === "COMPLETED") return "Delivered";
  if (status === "FULFILLED") return "Shipped";
  if (status === "PENDING") return "Pending";
  return "Processing";
}

function money(value: string | number, currency: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Amount unavailable";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: currency || "NGN", maximumFractionDigits: 0 }).format(amount);
}

export default function AccountPage() {
  const [activeSection, setActiveSection] = useState("orders");
  const [activeTab, setActiveTab] = useState<OrderTab>("all");
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const requestedSection = new URLSearchParams(window.location.search).get("section");
    if (requestedSection && sections.some((section) => section.id === requestedSection)) {
      setActiveSection(requestedSection);
    }
  }, []);

  useEffect(() => {
    if (!getAccessToken()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    apiRequest<OrdersResponse>("/orders?page=1&limit=50", { authenticated: true })
      .then((response) => {
        if (cancelled) return;
        setOrders(response.orders ?? []);
        setTotalOrders(response.pagination?.total ?? response.orders?.length ?? 0);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.message : "We couldn't load your orders. Please try again.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visibleOrders = useMemo(
    () => activeTab === "all" ? orders : orders.filter((order) => orderGroup(order.status) === activeTab),
    [activeTab, orders],
  );

  return (
    <div className="account-page">
      <div className="account-page__banner"><span>7</span><h1>My Orders (Account)</h1></div>
      <div className="account-page__layout">
        <aside className="account-sidebar" aria-label="Account navigation">
          <div className="account-sidebar__heading"><ShoppingBag size={19} /><strong>My Account</strong></div>
          <nav>
            {sections.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setActiveSection(id)} className={`account-sidebar__link ${activeSection === id ? "is-active" : ""}`} aria-current={activeSection === id ? "page" : undefined}>
                <Icon size={19} strokeWidth={1.9} /><span>{label}</span>
              </button>
            ))}
          </nav>
          <button type="button" className="account-sidebar__link account-sidebar__signout" onClick={() => setError("Sign out will be available when customer authentication is connected.")}>
            <LogOut size={19} /><span>Sign Out</span>
          </button>
        </aside>

        <main className="account-content">
          {activeSection === "orders" ? (
            <>
              <div className="account-content__heading"><div><h2>My Orders</h2><p>Keep track of your purchases and delivery progress.</p></div><span className="account-order-count">{totalOrders} {totalOrders === 1 ? "order" : "orders"}</span></div>
              <div className="account-order-tabs" role="tablist" aria-label="Filter orders">
                {orderTabs.map((tab) => (
                  <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
                ))}
              </div>
              {loading ? (
                <div className="account-state"><span className="account-spinner" /><p>Loading your orders…</p></div>
              ) : !getAccessToken() ? (
                <div className="account-state"><div className="account-state__icon"><CircleUserRound size={28} /></div><h3>Sign in to view your orders</h3><p>Your order history and delivery updates will appear here once you sign in.</p></div>
              ) : error ? (
                <div className="account-state"><h3>We couldn’t load your orders</h3><p>{error}</p><button type="button" onClick={() => window.location.reload()}>Try again</button></div>
              ) : visibleOrders.length === 0 ? (
                <div className="account-state"><div className="account-state__icon"><Package size={28} /></div><h3>{activeTab === "all" ? "No orders yet" : `No ${orderTabs.find((tab) => tab.id === activeTab)?.label.toLowerCase()} orders`}</h3><p>{activeTab === "all" ? "When you place an order, you’ll find its details and status here." : "Orders in this category will appear here."}</p></div>
              ) : (
                <div className="account-order-list">
                  {visibleOrders.map((order) => (
                    <article className="account-order-card" key={order.id}>
                      <div className="account-order-card__identity"><strong>{order.orderNumber}</strong><time dateTime={order.createdAt}>{new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(new Date(order.createdAt))}</time></div>
                      <div className="account-order-card__products" aria-label={order.items.map((item) => item.productName).join(", ")}>
                        {order.items.slice(0, 3).map((item) => <div className="account-order-product" key={item.id} title={item.productName}><Package size={20} /><span>{item.productName}</span></div>)}
                        {order.items.length > 3 && <span className="account-order-more">+{order.items.length - 3}</span>}
                      </div>
                      <span className={`account-status account-status--${orderGroup(order.status)}`}>{statusLabel(order.status)}</span>
                      <div className="account-order-card__total"><strong>{money(order.totalAmount, order.currency)}</strong><a href={`/track-order?order=${encodeURIComponent(order.orderNumber)}`}>View Details <ChevronRight size={14} /></a></div>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="account-section-placeholder">
              <h2>{sections.find((section) => section.id === activeSection)?.label}</h2>
              <p>This area is part of your ClickClickBuy account. Its tools will appear here as the account features are connected.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
