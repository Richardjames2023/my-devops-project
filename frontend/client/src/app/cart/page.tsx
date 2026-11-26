"use client";

import ShippingForm from "@/components/ShippingForm";
import useCartStore from "@/stores/cartStore";
import { ShippingFormInputs } from "@/types";
import { ArrowRight, CheckCircle2, CreditCard, MapPin, ShieldCheck, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

const formatNaira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);

const CartPageContent = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [shippingForm, setShippingForm] = useState<ShippingFormInputs>();
  const activeStep = Number(searchParams.get("step") || "1");
  const { cart } = useCartStore();
  const subtotal = cart.reduce((total, item) => total + item.price * item.quantity, 0);
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const itemOffers = cart.reduce((total, item) => total + Math.max(0, (item.compareAtPrice ?? item.price) - item.price) * item.quantity, 0);

  if (activeStep === 1) {
    return (
      <main className="cart-page">
        <div className="cart-content-grid cart-content-grid--items">
          <section className="cart-items-section" aria-labelledby="cart-heading">
            <div className="cart-section-heading">
              <h1 id="cart-heading">Your Shopping Bag</h1>
              <span>({itemCount} {itemCount === 1 ? "item" : "items"})</span>
            </div>
            {cart.length ? (
              <div className="cart-items-list">
                {cart.map((item) => {
                  const image = item.images[item.selectedColor] ?? item.images.default ?? Object.values(item.images)[0];
                  return (
                    <article className="cart-item" key={`${item.id}-${item.selectedSize}-${item.selectedColor}`}>
                      <Link className="cart-item-image" href={`/products/${item.id}`} aria-label={`View ${item.name}`}>
                        {image ? <Image src={image} alt={item.name} fill sizes="92px" /> : null}
                      </Link>
                      <div className="cart-item-info">
                        <Link href={`/products/${item.id}`} className="cart-item-name">{item.name}</Link>
                        {(item.selectedColor !== "default" || item.selectedSize) && <p className="cart-item-variant">{[item.selectedColor !== "default" ? item.selectedColor : "", item.selectedSize].filter(Boolean).join(" · ")}</p>}
                        <strong className="cart-item-unit-price">{formatNaira(item.price)}</strong>
                      </div>
                      <div className="cart-quantity-control"><span>{item.quantity}</span></div>
                      <strong className="cart-item-line-total">{formatNaira(item.price * item.quantity)}</strong>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="cart-empty"><h3>Your shopping bag is empty</h3><p>Find something useful for your home, work and everyday life.</p><Link href="/products">Explore products <ArrowRight size={16}/></Link></div>
            )}
            <Link href="/products" className="cart-continue-shopping">Continue Shopping</Link>
          </section>
          <aside className="cart-order-summary" aria-label="Order summary">
            <h2>Order Summary</h2>
            <div className="cart-summary-row"><span>Subtotal</span><strong>{formatNaira(subtotal)}</strong></div>
            <div className="cart-summary-row cart-summary-delivery"><span>Delivery</span><span>Calculated at checkout</span></div>
            <div className="cart-summary-total"><span>Total <small>(before delivery)</small></span><strong>{formatNaira(subtotal)}</strong></div>
            <button type="button" onClick={() => router.push("/cart?step=2")} disabled={!cart.length} className="cart-checkout-button">Proceed to Checkout <ArrowRight size={18}/></button>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className="checkout-page">
      <header className="checkout-page__header">
        <h1>Checkout <span>(3 Steps)</span></h1>
      </header>
      <nav className="checkout-progress" aria-label="Checkout progress">
        <div className="is-active"><span>1</span><strong>Delivery</strong></div>
        <i />
        <div className={activeStep >= 3 ? "is-active" : ""}><span>2</span><strong>Payment</strong></div>
        <i />
        <div className={activeStep >= 3 ? "is-active" : ""}><span>3</span><strong>Review</strong></div>
      </nav>

      <div className="checkout-columns">
        <section className="checkout-panel checkout-delivery">
          <h2><Truck size={19}/> Delivery Information</h2>
          {shippingForm && activeStep >= 3 ? (
            <div className="checkout-delivery-summary">
              <strong>{shippingForm.name}</strong>
              <span>{shippingForm.email}</span>
              <span>{shippingForm.phone}</span>
              <span>{shippingForm.address}</span>
              {shippingForm.flatSuite && <span>{shippingForm.flatSuite}</span>}
              <span>{shippingForm.address}</span>
              {shippingForm.landmark && <span>Near {shippingForm.landmark}</span>}
              <span>{shippingForm.area}, {shippingForm.city}, {shippingForm.state}</span>
              <span>{shippingForm.deliverySpeed === "express" ? "Express delivery" : "Standard delivery"}</span>
              {shippingForm.deliveryNote && <span>Delivery note: {shippingForm.deliveryNote}</span>}
              <button type="button" onClick={() => router.push("/cart?step=2")}>Edit delivery details</button>
            </div>
          ) : (
            <ShippingForm setShippingForm={setShippingForm}/>
          )}
        </section>

        <section className="checkout-panel checkout-payment">
          <h2><CreditCard size={19}/> Payment Method</h2>
          <div className="checkout-paystack-option">
            <span className="checkout-radio is-selected"><span/></span>
            <div>
              <strong>Pay with Paystack</strong>
              <p>Pay securely using the payment methods available through Paystack at checkout.</p>
            </div>
            <span className="checkout-paystack-wordmark">paystack</span>
          </div>
          <div className="checkout-payment-assurance"><ShieldCheck size={17}/><span>Your payment is processed through Paystack. Card details are entered on Paystack's secure payment page.</span></div>
          {activeStep === 2 ? (
            <button type="button" className="checkout-primary-action" onClick={() => router.push("/cart?step=3")} disabled={!shippingForm}>
              Continue to Review <ArrowRight size={17}/>
            </button>
          ) : (
            <div className="checkout-payment-status"><CheckCircle2 size={17}/> Paystack selected</div>
          )}
        </section>

        <aside className="checkout-panel checkout-review">
          <h2><MapPin size={19}/> Your basket</h2>
          <div className="checkout-review-items">
            {cart.map((item) => {
              const image = item.images[item.selectedColor] ?? item.images.default ?? Object.values(item.images)[0];
              return (
                <div className="checkout-review-item" key={`${item.id}-${item.selectedSize}-${item.selectedColor}`}>
                  <div className="checkout-review-image">{image ? <Image src={image} alt={item.name} fill sizes="54px"/> : null}</div>
                  <div className="checkout-review-name"><strong>{item.name}</strong><span>{item.selectedColor !== "default" ? item.selectedColor : item.selectedSize || ""}</span></div>
                  <span className="checkout-review-quantity">×{item.quantity}</span>
                  <strong className="checkout-review-price">{formatNaira(item.price * item.quantity)}</strong>
                </div>
              );
            })}
          </div>
          <div className="checkout-review-totals">
            <div><span>Items (VAT included)</span><strong>{formatNaira(subtotal)}</strong></div>
            {itemOffers > 0 && <div className="checkout-review-offers"><span>Offers on items</span><strong>−{formatNaira(itemOffers)}</strong></div>}
            <div><span>Delivery</span><span className="checkout-delivery-estimate">{shippingForm ? "Fee confirmed at checkout" : "Choose an address"}</span></div>
            <div className="is-total"><span>Total to pay</span><strong>{formatNaira(subtotal)}</strong></div>
          </div>
          {activeStep >= 3 ? (
            <>
              <p className="checkout-review-hint">Review your delivery details and order before placing it.</p>
              <button type="button" className="checkout-review-action" disabled aria-disabled="true">
                Place Order <ArrowRight size={17}/>
              </button>
              <p className="checkout-review-note">Order placement will be enabled when Paystack initialization is connected.</p>
            </>
          ) : (
            <>
              <p className="checkout-review-hint">{shippingForm ? "Delivery details saved for this checkout. Check your basket before continuing." : "Your basket total updates as you change item quantities."}</p>
              <button type="button" className="checkout-review-action" onClick={() => router.push("/cart?step=3")} disabled={!cart.length || !shippingForm}>
                Continue to Review <ArrowRight size={17}/>
              </button>
            </>
          )}
        </aside>
      </div>
      <Link href="/cart" className="checkout-back-to-cart">← Back to shopping bag</Link>
    </main>
  );
};

const CartPage = () => <Suspense fallback={<div className="cart-loading">Loading checkout…</div>}><CartPageContent/></Suspense>;
export default CartPage;
