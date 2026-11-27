"use client";

import ShippingForm from "@/components/ShippingForm";
import useCartStore from "@/stores/cartStore";
import { ShippingFormInputs } from "@/types";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronUp, Clock3, CreditCard, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

const formatNaira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);

const CartPageContent = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [shippingForm, setShippingForm] = useState<ShippingFormInputs>();
  const [showPaymentItems, setShowPaymentItems] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const activeStep = Number(searchParams.get("step") || "1");
  const mockStatus = searchParams.get("mockStatus");
  const isMockResult = activeStep === 4 && (mockStatus === "success" || mockStatus === "failed");
  const { cart } = useCartStore();
  const subtotal = useMemo(() => cart.reduce((total, item) => total + item.price * item.quantity, 0), [cart]);
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const itemOffers = cart.reduce((total, item) => total + Math.max(0, (item.compareAtPrice ?? item.price) - item.price) * item.quantity, 0);
  const itemTotalBeforeOffers = subtotal + itemOffers;
  const isCheckout = activeStep >= 2;
  const step = activeStep >= 3 ? 2 : 1;

  const renderBasketItems = (compact = false) => cart.map((item) => {
    const image = item.images[item.selectedColor] ?? item.images.default ?? Object.values(item.images)[0];
    return (
      <div className={compact ? "checkout-basket-item checkout-basket-item--compact" : "checkout-basket-item"} key={`${item.id}-${item.selectedSize}-${item.selectedColor}`}>
        <div className="checkout-basket-image">{image ? <Image src={image} alt={item.name} fill sizes="56px"/> : null}</div>
        <div className="checkout-basket-copy">
          <strong>{item.name}</strong>
          <span>× {item.quantity}{item.selectedColor !== "default" ? ` · ${item.selectedColor}` : item.selectedSize ? ` · ${item.selectedSize}` : ""} · {formatNaira(item.price)}</span>
        </div>
        <strong className="checkout-basket-line-total">{formatNaira(item.price * item.quantity)}</strong>
      </div>
    );
  });

  if (!isCheckout) {
    return (
      <main className="cart-page">
        <div className="cart-content-grid cart-content-grid--items">
          <section className="cart-items-section" aria-labelledby="cart-heading">
            <div className="cart-section-heading"><h1 id="cart-heading">Your Shopping Bag</h1><span>({itemCount} {itemCount === 1 ? "item" : "items"})</span></div>
            {cart.length ? (
              <div className="cart-items-list">
                {cart.map((item) => {
                  const image = item.images[item.selectedColor] ?? item.images.default ?? Object.values(item.images)[0];
                  return (
                    <article className="cart-item" key={`${item.id}-${item.selectedSize}-${item.selectedColor}`}>
                      <Link className="cart-item-image" href={`/products/${item.id}`} aria-label={`View ${item.name}`}>{image ? <Image src={image} alt={item.name} fill sizes="92px"/> : null}</Link>
                      <div className="cart-item-info"><Link href={`/products/${item.id}`} className="cart-item-name">{item.name}</Link>{(item.selectedColor !== "default" || item.selectedSize) && <p className="cart-item-variant">{[item.selectedColor !== "default" ? item.selectedColor : "", item.selectedSize].filter(Boolean).join(" · ")}</p>}<strong className="cart-item-unit-price">{formatNaira(item.price)}</strong></div>
                      <div className="cart-quantity-control"><span>{item.quantity}</span></div>
                      <strong className="cart-item-line-total">{formatNaira(item.price * item.quantity)}</strong>
                    </article>
                  );
                })}
              </div>
            ) : <div className="cart-empty"><h3>Your shopping bag is empty</h3><p>Find something useful for your home, work and everyday life.</p><Link href="/products">Explore products <ArrowRight size={16}/></Link></div>}
            <Link href="/products" className="cart-continue-shopping">Continue Shopping</Link>
          </section>
          <aside className="cart-order-summary" aria-label="Order summary"><h2>Order Summary</h2><div className="cart-summary-row"><span>Subtotal</span><strong>{formatNaira(subtotal)}</strong></div><div className="cart-summary-row cart-summary-delivery"><span>Delivery</span><span>Calculated at checkout</span></div><div className="cart-summary-total"><span>Total <small>(before delivery)</small></span><strong>{formatNaira(subtotal)}</strong></div><button type="button" onClick={() => router.push("/cart?step=2")} disabled={!cart.length} className="cart-checkout-button">Proceed to Checkout <ArrowRight size={18}/></button></aside>
        </div>
      </main>
    );
  }

  if (isMockResult) {
    const successful = mockStatus === "success";
    return (
      <main className="checkout-flow">
        <div className={successful ? "checkout-result-card is-success" : "checkout-result-card is-failed"}>
          <div className="checkout-result-icon">{successful ? <CheckCircle2 size={34}/> : <CreditCard size={34}/>}</div>
          <span className="checkout-result-demo-label">DEMO PAYMENT FLOW · SIMULATED GATEWAY RESULT</span>
          <h1>{successful ? "Payment confirmed" : "Payment was not completed"}</h1>
          <p>{successful ? "The mock gateway is showing the successful outcome that would follow a verified Paystack webhook. This is a demonstration only; no real payment, webhook or order was created." : "The mock gateway is showing a failed or cancelled outcome as if confirmed by the backend after a Paystack notification. No real payment or webhook was attempted."}</p>
          <div className="checkout-result-reference"><span>Demo payment reference</span><strong>{searchParams.get("reference") || "CCB-DEMO"}</strong></div>
          {successful ? (
            <div className="checkout-result-next"><CheckCircle2 size={18}/><span>Payment status: SUCCESS (mock confirmation)</span></div>
          ) : (
            <div className="checkout-result-next is-error"><CreditCard size={18}/><span>Payment status: FAILED (mock confirmation)</span></div>
          )}
          <div className="checkout-result-actions">
            {successful ? <Link href="/products">Continue shopping <ArrowRight size={16}/></Link> : <Link href="/cart?step=3">Try payment again <ArrowRight size={16}/></Link>}
            <Link href="/cart">Return to basket</Link>
          </div>
        </div>
      </main>
    );
  }

  if (!cart.length) {
    return <main className="checkout-flow"><div className="checkout-empty-state"><PackageCheck size={36}/><h1>Your basket is empty</h1><p>Add something useful before continuing to checkout.</p><Link href="/products">Explore products <ArrowRight size={16}/></Link></div></main>;
  }

  return (
    <main className="checkout-flow">
      <div className="checkout-flow__intro">
        <Link href="/cart" className="checkout-flow__back"><ArrowLeft size={15}/> Basket</Link>
        <h1>{step === 1 ? "Checkout" : "Payment"}</h1>
        <p>{step === 1 ? "Delivery details first. Your items are checked again when payment begins." : "Review your basket and continue securely with Paystack."}</p>
        <nav className="checkout-flow-progress" aria-label="Checkout progress">
          <div className={step === 1 ? "is-current" : "is-complete"}><span>{step > 1 ? <Check size={14}/> : "1"}</span><strong>Delivery</strong></div>
          <i/>
          <div className={step === 2 ? "is-current" : ""}><span>2</span><strong>Payment</strong></div>
          <i/>
          <div><span>3</span><strong>Confirmation</strong></div>
        </nav>
      </div>

      {step === 1 ? (
        <div className="checkout-flow-grid">
          <section className="checkout-flow-card checkout-flow-delivery">
            <h2><Truck size={19}/> Delivery details</h2>
            <ShippingForm setShippingForm={(data) => { setShippingForm(data); router.push("/cart?step=3"); }} initialValues={shippingForm}/>
          </section>
          <aside className="checkout-flow-card checkout-flow-basket">
            <h2>Your basket</h2>
            <div className="checkout-basket-list">{renderBasketItems(true)}</div>
            <div className="checkout-flow-totals">
              <div><span>Items (VAT included)</span><strong>{formatNaira(itemTotalBeforeOffers)}</strong></div>
              {itemOffers > 0 && <div className="checkout-offer-row"><span>Offers on items</span><strong>− {formatNaira(itemOffers)}</strong></div>}
              <div><span>Delivery</span><span className="checkout-flow-muted">Choose an address</span></div>
              <div className="checkout-flow-total"><strong>Total to pay</strong><strong>{formatNaira(subtotal)}</strong></div>
            </div>
            <label className="checkout-promo-label" htmlFor="checkout-promo">Have a promo code?</label>
            <div className="checkout-promo-row"><input id="checkout-promo" value={promoCode} onChange={(e) => setPromoCode(e.target.value)} placeholder="e.g. WELCOME10"/><button type="button" disabled title="Coupon validation will be enabled with the checkout API">Apply</button></div>
            <p className="checkout-basket-footnote">{itemCount} {itemCount === 1 ? "item" : "items"}. Stock is checked again when payment starts. Promo-code validation will be connected with the checkout API.</p>
          </aside>
        </div>
      ) : (
        <div className="checkout-flow-payment-wrap">
          <section className="checkout-flow-card checkout-payment-card">
            <div className="checkout-payment-heading">
              <div><span className="checkout-payment-hold"><Clock3 size={14}/> Ready for payment</span><h2>Choose how to pay</h2><p>Your basket total, before any confirmed delivery fee.</p></div>
              <div className="checkout-payment-amount"><span>{itemCount} {itemCount === 1 ? "item" : "items"}, VAT included</span><strong>{formatNaira(subtotal)}</strong></div>
            </div>
            <button type="button" className="checkout-show-items" onClick={() => setShowPaymentItems(!showPaymentItems)}><span>{showPaymentItems ? <ChevronUp size={16}/> : <ChevronDown size={16}/>} {showPaymentItems ? "Hide" : "Show"} the items in this order</span><span>{itemCount}</span></button>
            {showPaymentItems && <div className="checkout-payment-items">{renderBasketItems(true)}</div>}
            <div className="checkout-payment-method is-selected">
              <span className="checkout-payment-method-icon"><CreditCard size={18}/></span>
              <span><strong>Pay with Paystack</strong><small>Debit or credit card and other payment methods enabled by Paystack</small></span>
              <CheckCircle2 size={18}/>
            </div>
            <div className="checkout-payment-notice"><ShieldCheck size={18}/><p>You&apos;ll complete payment on Paystack. ClickClickBuy does not collect or store your card details.</p></div>
            <div className="checkout-payment-unavailable"><CreditCard size={17}/><p>Demo mode: this opens a simulated Paystack-hosted checkout so we can review the complete customer journey. No real charge will be made.</p></div>
            <Link
              href={`/mock-paystack?amount=${encodeURIComponent(String(subtotal))}&reference=CCB-DEMO-${Date.now()}`}
              className="checkout-paystack-continue"
            >Continue to Paystack <ArrowRight size={17}/></Link>
            <button type="button" className="checkout-cancel-payment" onClick={() => router.push("/cart?step=2")}>Back to delivery details</button>
          </section>
          <aside className="checkout-flow-card checkout-payment-summary"><h2>Order summary</h2><div className="checkout-flow-totals"><div><span>Items (VAT included)</span><strong>{formatNaira(itemTotalBeforeOffers)}</strong></div>{itemOffers > 0 && <div className="checkout-offer-row"><span>Offers on items</span><strong>− {formatNaira(itemOffers)}</strong></div>}<div><span>Delivery</span><span className="checkout-flow-muted">Calculated from your address</span></div><div className="checkout-flow-total"><strong>Total to pay</strong><strong>{formatNaira(subtotal)}</strong></div></div><div className="checkout-payment-summary-address"><strong>Delivering to</strong>{shippingForm ? <><span>{shippingForm.name}</span><span>{shippingForm.address}{shippingForm.flatSuite ? `, ${shippingForm.flatSuite}` : ""}</span><span>{shippingForm.area}, {shippingForm.city}, {shippingForm.state}</span><button type="button" onClick={() => router.push("/cart?step=2")}>Edit delivery details</button></> : <span>Delivery details have not been saved in this session.</span>}</div></aside>
        </div>
      )}
    </main>
  );
};

const CartPage = () => <Suspense fallback={<div className="cart-loading">Loading checkout…</div>}><CartPageContent/></Suspense>;
export default CartPage;
