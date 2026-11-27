"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Bell, BriefcaseBusiness, ChevronRight, CircleUserRound, ClipboardList,
  Heart, LogOut, MapPin, Package, RotateCcw, ShieldCheck, ShoppingBag,
  ShoppingBasket, Truck, UserRound, CreditCard, Settings, CheckCircle2,
} from "lucide-react";
import { DemoCustomer, getDemoCustomer, getDemoOrders, getDemoUnreadCount, getDemoWishlistCount, logoutDemoCustomer } from "@/lib/demo-account";

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
const orderTabs = [{id:"all",label:"All Orders"},{id:"processing",label:"Processing"},{id:"shipped",label:"Shipped"},{id:"delivered",label:"Delivered"},{id:"cancelled",label:"Cancelled"}] as const;
type Tab = typeof orderTabs[number]["id"];
const statusGroup = (status:string):Tab => status==="CANCELLED"?"cancelled":status==="COMPLETED"?"delivered":status==="FULFILLED"?"shipped":"processing";
const statusText = (status:string) => status==="COMPLETED"?"Delivered":status==="FULFILLED"?"Shipped":status==="CANCELLED"?"Cancelled":"Processing";
const formatMoney = (amount:number) => new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(amount);

export default function AccountPage() {
  const [customer,setCustomer] = useState<DemoCustomer|null>(null);
  const [activeSection,setActiveSection] = useState("overview");
  const [activeTab,setActiveTab] = useState<Tab>("all");
  const [ready,setReady] = useState(false);
  useEffect(()=>{
    setCustomer(getDemoCustomer());
    const section = new URLSearchParams(window.location.search).get("section");
    if(section && sections.some(s=>s.id===section)) setActiveSection(section);
    setReady(true);
  },[]);
  const orders = getDemoOrders();
  const filtered = useMemo(()=>activeTab==="all"?orders:orders.filter(o=>statusGroup(o.status)===activeTab),[activeTab,orders]);
  const wishlistCount = getDemoWishlistCount();
  const unreadCount = getDemoUnreadCount();
  const signOut=()=>{logoutDemoCustomer();window.location.assign("/login");};

  if(!ready) return <div className="account-page"><div className="account-state"><span className="account-spinner"/><p>Opening your demo account…</p></div></div>;
  if(!customer) return <div className="account-page"><div className="account-page__banner"><span><ShoppingBag size={19}/></span><h1>My Account</h1></div><div className="account-auth-required"><CircleUserRound size={42}/><h2>Welcome to your ClickClickBuy account</h2><p>Sign in or create a demo account to explore your customer dashboard.</p><Link href="/login">Sign In</Link><small>New to ClickClickBuy? <Link href="/register">Create an account</Link></small></div></div>;

  return <div className="account-page">
    <div className="account-page__banner"><span><ShoppingBag size={19}/></span><h1>My Account</h1></div>
    <div className="account-page__layout">
      <aside className="account-sidebar" aria-label="Account navigation">
        <div className="account-sidebar__heading"><ShoppingBag size={19}/><strong>My Account</strong></div>
        <nav>{sections.map(({id,label,icon:Icon})=><button key={id} type="button" onClick={()=>setActiveSection(id)} className={`account-sidebar__link ${activeSection===id?"is-active":""}`} aria-current={activeSection===id?"page":undefined}><Icon size={19}/><span>{label}</span>{id==="notifications"&&<b className="account-nav-count">{unreadCount}</b>}</button>)}</nav>
        <button type="button" className="account-sidebar__link account-sidebar__signout" onClick={signOut}><LogOut size={19}/><span>Sign Out</span></button>
      </aside>
      <main className="account-content">
        {activeSection==="overview"&&<>
          <div className="account-welcome"><div><p className="account-welcome__eyebrow">YOUR ACCOUNT DASHBOARD</p><h2>Welcome back, {customer.firstName}</h2><p>Here’s what’s happening with your ClickClickBuy account.</p></div><div className="account-welcome__avatar"><UserRound size={27}/></div></div>
          <div className="account-profile-strip"><div><span>Signed in as</span><strong>{customer.email}</strong></div><div><span>Member since</span><strong>{new Intl.DateTimeFormat("en-NG",{month:"long",year:"numeric"}).format(new Date(customer.createdAt))}</strong></div><span className="account-demo-tag">Demo account</span></div>
          <div className="account-summary-grid">
            <button onClick={()=>setActiveSection("orders")} className="account-summary-card"><span className="account-summary-icon is-blue"><Package size={21}/></span><span>Total orders</span><strong>{orders.length}</strong><small>View order history <ChevronRight size={13}/></small></button>
            <button onClick={()=>{setActiveSection("orders");setActiveTab("processing");}} className="account-summary-card"><span className="account-summary-icon is-amber"><Truck size={21}/></span><span>In progress</span><strong>{orders.filter(o=>statusGroup(o.status)==="processing").length}</strong><small>Track purchases <ChevronRight size={13}/></small></button>
            <button onClick={()=>{setActiveSection("orders");setActiveTab("delivered");}} className="account-summary-card"><span className="account-summary-icon is-green"><ShoppingBag size={21}/></span><span>Delivered</span><strong>{orders.filter(o=>statusGroup(o.status)==="delivered").length}</strong><small>Past deliveries <ChevronRight size={13}/></small></button>
            <button onClick={()=>setActiveSection("saved")} className="account-summary-card"><span className="account-summary-icon is-rose"><Heart size={21}/></span><span>Saved items</span><strong>{wishlistCount}</strong><small>View wishlist <ChevronRight size={13}/></small></button>
          </div>
          <div className="account-overview-columns">
            <section className="account-overview-panel"><div className="account-panel-heading"><div><h3>Recent orders</h3><p>Your latest purchases and their status</p></div><button onClick={()=>setActiveSection("orders")}>View all <ChevronRight size={14}/></button></div>
              {orders.slice(0,3).map(order=><div className="account-recent-order" key={order.id}><div><strong>{order.orderNumber}</strong><span>{new Intl.DateTimeFormat("en-NG",{day:"numeric",month:"short",year:"numeric"}).format(new Date(order.createdAt))} · {order.items.length} {order.items.length===1?"item":"items"}</span></div><div><b className={`account-status account-status--${statusGroup(order.status)}`}>{statusText(order.status)}</b><strong>{formatMoney(order.totalAmount)}</strong></div></div>)}
            </section>
            <section className="account-overview-panel"><div className="account-panel-heading"><div><h3>Quick links</h3><p>Manage your shopping experience</p></div></div><div className="account-quick-links"><button onClick={()=>setActiveSection("addresses")}><MapPin size={18}/>Manage addresses<ChevronRight size={15}/></button><button onClick={()=>setActiveSection("saved")}><Heart size={18}/>Saved items<ChevronRight size={15}/></button><button onClick={()=>setActiveSection("notifications")}><Bell size={18}/>Notifications<b>{unreadCount}</b><ChevronRight size={15}/></button><Link href="/products"><ShoppingBasket size={18}/>Continue shopping<ChevronRight size={15}/></Link></div></section>
          </div>
        </>}
        {activeSection==="orders"&&<>
          <div className="account-content__heading"><div><h2>My Orders</h2><p>Keep track of your purchases and delivery progress.</p></div><span className="account-order-count">{orders.length} orders</span></div>
          <div className="account-order-tabs" role="tablist" aria-label="Filter orders">{orderTabs.map(tab=><button key={tab.id} type="button" role="tab" aria-selected={activeTab===tab.id} onClick={()=>setActiveTab(tab.id)}>{tab.label}</button>)}</div>
          <div className="account-order-list">{filtered.map(order=><article className="account-order-card" key={order.id}><div className="account-order-card__identity"><strong>{order.orderNumber}</strong><time>{new Intl.DateTimeFormat("en-NG",{day:"numeric",month:"short",year:"numeric"}).format(new Date(order.createdAt))}</time></div><div className="account-order-card__products">{order.items.slice(0,3).map(item=><div className="account-order-product" key={item.id} title={item.productName}><Package size={20}/></div>)}</div><span className={`account-status account-status--${statusGroup(order.status)}`}>{statusText(order.status)}</span><div className="account-order-card__total"><strong>{formatMoney(order.totalAmount)}</strong><Link href={`/track-order?order=${encodeURIComponent(order.orderNumber)}`}>View Details <ChevronRight size={14}/></Link></div></article>)}</div>
        </>}
        {activeSection==="addresses"&&<section className="account-feature-page"><div className="account-content__heading"><div><h2>Saved Addresses</h2><p>Manage where your ClickClickBuy orders are delivered.</p></div><span className="account-demo-tag">Preview</span></div><article className="account-feature-card"><div><strong>Home</strong><span>{customer.firstName} {customer.lastName}</span><span>{customer.phone||"Phone number not added"}</span><span>12 Admiralty Way, Lekki Phase 1, Lagos, Nigeria</span></div><b>Default address</b></article><p className="account-demo-caption">Sample address for frontend preview. Address editing will be connected later.</p></section>}
        {activeSection==="saved"&&<section className="account-feature-page"><h2>Saved Items</h2><p>Your wishlist, ready when you are.</p><div className="account-saved-grid">{["Wireless Headphones","Smart Watch","Home Coffee Maker","Everyday Backpack"].map((name,i)=><article className="account-saved-card" key={name}><div className="account-saved-art"><Heart size={26}/></div><strong>{name}</strong><span>{["₦48,000","₦75,000","₦39,500","₦26,000"][i]}</span><Link href="/products">Explore products</Link></article>)}</div><p className="account-demo-caption">{wishlistCount} sample saved items shown for preview.</p></section>}
        {activeSection==="returns"&&<section className="account-feature-page"><h2>Returns & Refunds</h2><p>Follow the progress of return requests and refunds.</p><div className="account-feature-empty"><RotateCcw size={28}/><strong>No active return requests</strong><span>When you request a return, its progress will appear here.</span></div></section>}
        {activeSection==="warranty"&&<section className="account-feature-page"><h2>Warranty</h2><p>Keep track of warranty coverage on eligible purchases.</p><div className="account-feature-empty"><ShieldCheck size={28}/><strong>No warranty claims yet</strong><span>Eligible product warranty information will appear here.</span></div></section>}
        {activeSection==="notifications"&&<section className="account-feature-page"><h2>Notifications</h2><p>Updates about your account and purchases.</p><div className="account-notification-row"><span className="account-notification-dot"/><div><strong>Your order CCB-104583 is being processed</strong><p>We’re preparing your items for the next delivery step.</p><small>Today · Unread</small></div></div><div className="account-notification-row"><span className="account-notification-dot"/><div><strong>Welcome to ClickClickBuy</strong><p>Your customer account is ready to explore.</p><small>Yesterday · Unread</small></div></div></section>}
        {activeSection==="settings"&&<section className="account-feature-page"><h2>Account Settings</h2><p>Your profile details for this frontend demo.</p><div className="account-settings-list"><label>First name<input readOnly value={customer.firstName}/></label><label>Last name<input readOnly value={customer.lastName}/></label><label>Email address<input readOnly value={customer.email}/></label><label>Phone number<input readOnly value={customer.phone||"Not provided"}/></label></div><p className="account-demo-caption">Profile editing and password management will be connected later.</p></section>}
      </main>
    </div>
  </div>;
}
