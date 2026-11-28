import Link from "next/link";

export const metadata = {
  title: "7-day Returns Policy | ClickClickBuy",
  description: "Read about the ClickClickBuy seven-day returns policy.",
};

export default function ReturnsPolicyPage() {
  return (
    <article className="store-info-page">
      <Link className="store-info-page__back" href="/">← Back to shopping</Link>
      <p className="store-info-page__eyebrow">RETURNS POLICY</p>
      <h1>7-day returns</h1>
      <p className="store-info-page__intro">
        ClickClickBuy has a seven-day returns policy. If something is not right
        with your purchase, please get in touch with our team within seven days
        to discuss the next steps.
      </p>
      <section className="store-info-page__section">
        <h2>Before requesting a return</h2>
        <p>
          Keep your order details and the product information available so
          your request can be reviewed. Return eligibility and the appropriate
          next steps should be confirmed with ClickClickBuy before sending an
          item back.
        </p>
      </section>
      <section className="store-info-page__section">
        <h2>Important information</h2>
        <p>
          The detailed conditions, eligible product categories, return
          arrangements and refund timelines still need to be confirmed in the
          store policy. Please check with ClickClickBuy before arranging a
          return.
        </p>
      </section>
      <Link className="store-info-page__primary-link" href="/products">
        Continue shopping <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
