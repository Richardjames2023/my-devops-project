"use client";

import PaymentForm from "@/components/PaymentForm";
import ShippingForm from "@/components/ShippingForm";
import useCartStore from "@/stores/cartStore";
import { ShippingFormInputs } from "@/types";
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

const steps = [
  { id: 1, title: "Shopping Cart" },
  { id: 2, title: "Shipping Address" },
  { id: 3, title: "Payment Method" },
];

const formatNaira = (amount: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(amount);

const CartPageContent = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [shippingForm, setShippingForm] = useState<ShippingFormInputs>();
  const activeStep = Number(searchParams.get("step") || "1");
  const { cart, addToCart, removeFromCart } = useCartStore();

  const subtotal = cart.reduce((total, item) => total + item.price * item.quantity, 0);
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);

  const changeQuantity = (item: (typeof cart)[number], quantity: number) => {
    if (quantity < 1) {
      removeFromCart(item);
      return;
    }
    removeFromCart(item);
    addToCart({ ...item, quantity });
  };

  const summary = (
    <aside className="cart-order-summary" aria-label="Order summary">
      <h2>Order Summary</h2>
      <div className="cart-summary-row">
        <span>Subtotal</span>
        <strong>{formatNaira(subtotal)}</strong>
      </div>
      <div className="cart-summary-row cart-summary-delivery">
        <span>Delivery</span>
        <span>Calculated at checkout</span>
      </div>
      <div className="cart-summary-total">
        <span>Total <small>(before delivery)</small></span>
        <strong>{formatNaira(subtotal)}</strong>
      </div>
      {activeStep === 1 && (
        <button
          type="button"
          onClick={() => router.push("/cart?step=2", { scroll: false })}
          disabled={cart.length === 0}
          className="cart-checkout-button"
        >
          Proceed to Checkout <ArrowRight size={18} />
        </button>
      )}
    </aside>
  );

  return (
    <main className="cart-page">
      <div className="cart-step-banner">
        <span>{activeStep}</span>
        <h1>{steps.find((step) => step.id === activeStep)?.title ?? "Shopping Cart"}</h1>
      </div>

      {activeStep === 1 ? (
        <>
          <div className="cart-content-grid">
            <section className="cart-items-section" aria-labelledby="cart-heading">
              <div className="cart-section-heading">
                <h2 id="cart-heading">Your Shopping Bag</h2>
                <span>({itemCount} {itemCount === 1 ? "item" : "items"})</span>
              </div>

              {cart.length > 0 ? (
                <div className="cart-items-list">
                  {cart.map((item) => {
                    const image = item.images[item.selectedColor] ?? item.images.default ?? Object.values(item.images)[0];
                    return (
                      <article className="cart-item" key={`${item.id}-${item.selectedSize}-${item.selectedColor}`}>
                        <Link className="cart-item-image" href={`/products/${item.id}`} aria-label={`View ${item.name}`}>
                          {image ? <Image src={image} alt={item.name} fill sizes="92px" /> : <ShoppingBag size={28} />}
                        </Link>
                        <div className="cart-item-info">
                          <Link href={`/products/${item.id}`} className="cart-item-name">{item.name}</Link>
                          {(item.selectedColor && item.selectedColor !== "default") || item.selectedSize ? (
                            <p className="cart-item-variant">
                              {[item.selectedColor !== "default" ? item.selectedColor : "", item.selectedSize].filter(Boolean).join(" · ")}
                            </p>
                          ) : null}
                          <strong className="cart-item-unit-price">{formatNaira(item.price)}</strong>
                        </div>
                        <div className="cart-quantity-control" aria-label={`Quantity for ${item.name}`}>
                          <button type="button" aria-label="Decrease quantity" onClick={() => changeQuantity(item, item.quantity - 1)}><Minus size={15}/></button>
                          <span aria-live="polite">{item.quantity}</span>
                          <button type="button" aria-label="Increase quantity" onClick={() => changeQuantity(item, item.quantity + 1)}><Plus size={15}/></button>
                        </div>
                        <strong className="cart-item-line-total">{formatNaira(item.price * item.quantity)}</strong>
                        <button type="button" className="cart-item-remove" onClick={() => removeFromCart(item)} aria-label={`Remove ${item.name} from cart`}><Trash2 size={16}/></button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="cart-empty">
                  <ShoppingBag size={34}/>
                  <h3>Your shopping bag is empty</h3>
                  <p>Find something useful for your home, work and everyday life.</p>
                  <Link href="/products">Explore products <ArrowRight size={16}/></Link>
                </div>
              )}

              <Link href="/products" className="cart-continue-shopping">Continue Shopping</Link>
            </section>
            {summary}
          </div>
        </>
      ) : (
        <div className="cart-checkout-layout">
          <section className="cart-checkout-panel">
            <div className="cart-progress-steps">
              {steps.map((step) => (
                <div key={step.id} className={`cart-progress-step ${step.id === activeStep ? "is-active" : step.id < activeStep ? "is-complete" : ""}`}>
                  <span>{step.id}</span><strong>{step.title}</strong>
                </div>
              ))}
            </div>
            {activeStep === 2 ? (
              <ShippingForm setShippingForm={setShippingForm} />
            ) : activeStep === 3 && shippingForm ? (
              <PaymentForm />
            ) : (
              <p className="text-sm text-gray-500">Please complete the shipping details to continue.</p>
            )}
            <button type="button" className="cart-back-button" onClick={() => router.push(activeStep === 3 ? "/cart?step=2" : "/cart", { scroll: false })}>Back</button>
          </section>
          {summary}
        </div>
      )}
    </main>
  );
};

const CartPage = () => (
  <Suspense fallback={<div className="cart-loading">Loading your shopping bag…</div>}>
    <CartPageContent />
  </Suspense>
);

export default CartPage;
