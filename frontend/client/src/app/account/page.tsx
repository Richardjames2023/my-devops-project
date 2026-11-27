"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bell, BriefcaseBusiness, ChevronRight, CircleUserRound, ClipboardList,
  Heart, LogOut, MapPin, Package, RotateCcw, ShieldCheck, ShoppingBag,
  ShoppingBasket, Truck, UserRound,
} from "lucide-react";
import { ApiError, apiRequest, clearAuthTokens, hasAuthSession } from "@/lib/api/client";

type OrderStatus = "PENDING" | "CONFIRMED" | "PROCESSING" | "PARTIALLY_FULFILLED" | "FULFILLED" | "CANCELLED" | "COMPLETED";
type OrderItem = { id: string; productName: string; variantName: string; quantity: number };
type CustomerOrder = { id: string; orderNumber: string; status: OrderStatus; totalAmount: string | number; currency: string; createdAt: string; items: OrderItem[] };
type OrdersResponse = { orders: CustomerOrder[]; pagination: { total: number } };
type Customer = { id: string; email: string; firstName: string; lastName: string; phone: string | null; emailVerified: boolean; createdAt: string };
type ProfileResponse = { user: Customer };
type WishlistResponse = { wishlist: { itemCount: number } };
type InboxResponse = { notifications: Array<{ id: string; isRead?: boolean; readAt?: string | null }>; unreadCount?: number; pagination?: { total: number } };

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
const orderTabs = [{ id: "all", label: "All Orders" }, { id: "processing", label: "Processing" }, { id: "shipped", label: "Shipped" }, { id: "delivered", label: "Delivered" }, { id: "cancelled", label: "Cancelled" }] as const;
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
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-NG", { style: "currency", currency: currency || "NGN", maximumFractionDigits: 0 }).format(amount) : "Amount unavailable";
}

export default function AccountPage() {
  const [activeSection, setActiveSection] = useState("overview");
  const [activeTab, setActiveTab] = useState<OrderTab>("all");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [wishlistCount, setWishlistCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authenticated, setAuthenticated] = useState(false);

  const loadDashboard = useCallback(async () => {
    if (!hasAuthSession()) { setLoading(false); setAuthenticated(false); return; }
    setAuthenticated(true); setLoading(true); setError("");
    const results = await Promise.allSettled([
      apiRequest<ProfileResponse>("/auth/me", { authenticated: true }),
      apiRequest<OrdersResponse>("/orders?page=1&limit=50", { authenticated: true }),
      apiRequest<WishlistResponse>("/wishlist", { authenticated: true }),
      apiRequest<InboxResponse>("/notifications?page=1&pageSize=1", { authenticated: true }),
    ]);
    const profile = results[0];
    if (profile.status === "fulfilled") setCustomer(profile.value.user);
    else {
      setError(profile.reason instanceof ApiError ? profile.reason.message : "Your account details could not be loaded.");
      if (profile.reason instanceof ApiError && profile.reason.status === 401) clearAuthTokens();
    }
    if (results[1].status === "fulfilled") {
      setOrders(results[1].value.orders ?? []);
      setTotalOrders(results[1].value.pagination?.total ?? 0);
    }
    if (results[2].status === "fulfilled") setWishlistCount(results[2].value.wishlist?.itemCount ?? 0);
    if (results[3].status === "fulfilled") setUnreadCount(results[3].value.unreadCount ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("section");
    if (requested && sections.some((section) => section.id === requested)) setActiveSection(requested);
    void loadDashboard();
  }, [loadDashboard]);

  const visibleOrders = useMemo(() => activeTab === "all" ? orders : orders.filter((order) => orderGroup(order.status) === activeTab), [activeTab, orders]);
  const processingCount = orders.filter((order) => orderGroup(order.status) === "processing").length;
  const deliveredCount = orders.filter((order) => orderGroup(order.status) === "delivered").length;

  function signOut() {
    clearAuthTokens(); setAuthenticated(false); setCustomer(null); setOrders([]); window.location.assign("/login");
  }

  if (!authenticated && !loading) {
    return <div className="account-page"><div className="account-page__banner"><span><ShoppingBag size={19}/></span><h1>My Account</h1></div><div className="account-auth-required"><CircleUserRound size={42}/><h2>Sign in to your ClickClickBuy account</h2><p>Access your orders, saved items, delivery updates and account details in one place.</p><Link href="/login">Sign In</Link><small>New to ClickClickBuy? <Link href="/register">Create an account</Link></small></div></div>;
  }

  return (
    <div className="account-page">
      <div className="account-page__banner"><span><ShoppingBag size={19}/></span><h1>My Account</h1></div>
      <div className="account-page__layout">
        <aside className="account-sidebar" aria-label="Account navigation">
          <div className="account-sidebar__heading"><ShoppingBag size={19}/><strong>My Account</strong></div>
          <nav>{sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setActiveSection(id)} className={`account-sidebar__link ${activeSection === id ? "is-active" : ""}`} aria-current={activeSection === id ? "page" : undefined}><Icon size={19}/><span>{label}</span>{id === "notifications" && unreadCount > 0 && <b className="account-nav-count">{unreadCount}</b>}</button>)}</nav>
          <button type="button" className="account-sidebar__link account-sidebar__signout" onClick={signOut}><LogOut size={19}/><span>Sign Out</span></button>
        </aside>
        <main className="account-content">
          {loading ? <div className="account-state"><span className="account-spinner"/><p>Loading your account…</p></div> : error && !customer ? <div className="account-state"><h3>We couldn’t load your account</h3><p>{error}</p><button onClick={() => void loadDashboard()}>Try again</button></div> : null}
          {!loading && customer && activeSection === "overview" && <>
            <div className="account-welcome"><div><p className="account-welcome__eyebrow">YOUR ACCOUNT DASHBOARD</p><h2>Welcome back, {customer.firstName}</h2><p>Here’s what’s happening with your ClickClickBuy account.</p></div><div className="account-welcome__avatar"><UserRound size={27}/></div></div>
            <div className="account-profile-strip"><div><span>Signed in as</span><strong>{customer.email}</strong></div><div><span>Member since</span><strong>{new Intl.DateTimeFormat("en-NG",{month:"long",year:"numeric"}).format(new Date(customer.createdAt))}</strong></div><span className={customer.emailVerified ? "account-verified" : "account-unverified"}>{customer.emailVerified ? "Email verified" : "Email not verified"}</span></div>
            <div className="account-summary-grid">
              <button onClick={() => setActiveSection("orders")} className="account-summary-card"><span className="account-summary-icon is-blue"><Package size={21}/></span><span>Total orders</span><strong>{totalOrders}</strong><small>View order history <ChevronRight size={13}/></small></button>
              <button onClick={() => {setActiveSection("orders");setActiveTab("processing");}} className="account-summary-card"><span className="account-summary-icon is-amber"><Truck size={21}/></span><span>In progress</span><strong>{processingCount}</strong><small>Track purchases <ChevronRight size={13}/></small></button>
              <button onClick={() => {setActiveSection("orders");setActiveTab("delivered");}} className="account-summary-card"><span className="account-summary-icon is-green"><ShoppingBag size={21}/></span><span>Delivered</span><strong>{deliveredCount}</strong><small>Past deliveries <ChevronRight size={13}/></small></button>
              <button onClick={() => setActiveSection("saved")} className="account-summary-card"><span className="account-summary-icon is-rose"><Heart size={21}/></span><span>Saved items</span><strong>{wishlistCount}</strong><small>View wishlist <ChevronRight size={13}/></small></button>
            </div>
            <div className="account-overview-columns"><section className="account-overview-panel"><div className="account-panel-heading"><div><h3>Recent orders</h3><p>Your latest purchases and their status</p></div><button onClick={() => setActiveSection("orders")}>View all <ChevronRight size={14}/></button></div>{orders.length === 0 ? <div className="account-panel-empty"><Package size={25}/><strong>No orders yet</strong><span>Your purchases will appear here.</span><Link href="/products">Start shopping</Link></div> : orders.slice(0,4).map(order => <div className="account-recent-order" key={order.id}><div><strong>{order.orderNumber}</strong><span>{new Intl.DateTimeFormat("en-NG",{day:"numeric",month:"short",year:"numeric"}).format(new Date(order.createdAt))} · {order.items.length} {order.items.length === 1 ? "item" : "items"}</span></div><div><b className={`account-status account-status--${orderGroup(order.status)}`}>{statusLabel(order.status)}</b><strong>{money(order.totalAmount,order.currency)}</strong></div></div>)}</section>
            <section className="account-overview-panel"><div className="account-panel-heading"><div><h3>Quick links</h3><p>Manage your shopping experience</p></div></div><div className="account-quick-links"><button onClick={() => setActiveSection("addresses")}><MapPin size={18}/>Manage addresses<ChevronRight size={15}/></button><button onClick={() => setActiveSection("saved")}><Heart size={18}/>Saved items<ChevronRight size={15}/></button><button onClick={() => setActiveSection("notifications")}><Bell size={18}/>Notifications{unreadCount > 0 && <b>{unreadCount}</b>}<ChevronRight size={15}/></button><Link href="/products"><ShoppingBasket size={18}/>Continue shopping<ChevronRight size={15}/></Link></div></section></div>
          </>}
          {!loading && customer && activeSection === "orders" && <>
            <div className="account-content__heading"><div><h2>My Orders</h2><p>Keep track of your purchases and delivery progress.</p></div><span className="account-order-count">{totalOrders} {totalOrders === 1 ? "order" : "orders"}</span></div>
            <div className="account-order-tabs" role="tablist" aria-label="Filter orders">{orderTabs.map(tab => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}</div>
            {visibleOrders.length === 0 ? <div className="account-state"><Package size={28}/><h3>{activeTab === "all" ? "No orders yet" : `No ${orderTabs.find(tab=>tab.id===activeTab)?.label.toLowerCase()} orders`}</h3><p>Your order history and delivery updates will appear here.</p><Link href="/products">Browse products</Link></div> : <div className="account-order-list">{visibleOrders.map(order => <article className="account-order-card" key={order.id}><div className="account-order-card__identity"><strong>{order.orderNumber}</strong><time>{new Intl.DateTimeFormat("en-NG",{day:"numeric",month:"short",year:"numeric"}).format(new Date(order.createdAt))}</time></div><div className="account-order-card__products">{order.items.slice(0,3).map(item=><div className="account-order-product" key={item.id} title={item.productName}><Package size={20}/></div>)}{order.items.length>3 && <span className="account-order-more">+{order.items.length-3}</span>}</div><span className={`account-status account-status--${orderGroup(order.status)}`}>{statusLabel(order.status)}</span><div className="account-order-card__total"><strong>{money(order.totalAmount,order.currency)}</strong><Link href={`/track-order?order=${encodeURIComponent(order.orderNumber)}`}>View Details <ChevronRight size={14}/></Link></div></article>)}</div>}
          </>}
          {!loading && customer && activeSection !== "overview" && activeSection !== "orders" && <div className="account-section-placeholder"><h2>{sections.find(section=>section.id===activeSection)?.label}</h2><p>This account feature is not connected yet. Your account dashboard and order history are live; this section will be implemented against its corresponding account service.</p>{activeSection==="saved" && <p>Your saved item count is {wishlistCount}.</p>}</div>}
        </main>
      </div>
    </div>
  );
}
