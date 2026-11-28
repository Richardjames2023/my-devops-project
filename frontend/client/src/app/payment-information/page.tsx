import Link from "next/link";

export const metadata = {
  title: "Payment Information | ClickClickBuy",
  description: "Learn what to expect when paying for a ClickClickBuy order.",
};

export default function PaymentInformationPage() {
  return (
    <article className="store-info-page">
      <Link className="store-info-page__back" href="/">← Back to shopping</Link>
      <p className="store-info-page__eyebrow">PAYMENT INFORMATION</p>
      <h1>Payments at ClickClickBuy</h1>
      <p className="store-info-page__intro">
        We want the payment step to be clear and straightforward. Review your
        order and the payment instructions presented at checkout before
        confirming a purchase.
      </p>
      <section className="store-info-page__section">
        <h2>Before you pay</h2>
        <ul>
          <li>Check that your items, quantities and delivery details are correct.</li>
          <li>Review the order total and delivery fee shown at checkout.</li>
          <li>Use the payment option and instructions presented in the checkout flow.</li>
          <li>Keep your payment confirmation for your records.</li>
        </ul>
      </section>
      <section className="store-info-page__section">
        <h2>Need help?</h2>
        <p>
          If a payment appears unsuccessful or you are unsure whether an order
          was completed, check your order status before attempting to pay again.
        </p>
      </section>
      <Link className="store-info-page__primary-link" href="/products">
        Continue shopping <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
