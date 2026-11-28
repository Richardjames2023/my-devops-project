import Link from "next/link";

export default function TermsAndConditionsPage() {
  return (
    <main className="legal-page">
      <p className="customer-auth-eyebrow">CLICKCLICKBUY</p>
      <h1>Terms &amp; Conditions</h1>
      <p className="legal-intro">
        These terms explain the rules for using ClickClickBuy. Please read them
        before creating an account or placing an order.
      </p>

      <section>
        <h2>1. About these terms</h2>
        <p>
          In these terms, “ClickClickBuy”, “we”, “us” and “our” refer to the
          operator of the ClickClickBuy shopping service. “You” refers to a
          visitor or customer using our website or services. By creating an
          account or using the service, you agree to these terms.
        </p>
      </section>

      <section>
        <h2>2. Your account</h2>
        <p>
          You must provide accurate, current information and keep your sign-in
          credentials secure. You are responsible for activity carried out
          through your account. Tell us promptly if you believe your account
          has been accessed without permission. You must not impersonate
          another person or use the service for unlawful or fraudulent activity.
        </p>
      </section>

      <section>
        <h2>3. Products, prices and availability</h2>
        <p>
          We aim to display product descriptions, images, prices and stock
          information accurately. Product presentation may vary by screen or
          device. Products are subject to availability. We may correct
          listing or pricing errors and will contact you if an error affects
          an order you have placed.
        </p>
      </section>

      <section>
        <h2>4. Orders and payment</h2>
        <p>
          Placing an order is an offer to purchase the selected products.
          Order acceptance, payment authorisation and confirmation will be
          communicated through the checkout process. Available payment
          methods and any applicable charges will be shown before you confirm
          your order. Do not share payment credentials with anyone claiming
          to represent ClickClickBuy.
        </p>
      </section>

      <section>
        <h2>5. Delivery, returns and refunds</h2>
        <p>
          Delivery estimates, eligible delivery areas, return conditions and
          refund procedures are explained in the relevant information shown
          on our website, including our <Link href="/returns-policy">Returns Policy</Link>.
          Delivery dates are estimates unless expressly confirmed otherwise.
        </p>
      </section>

      <section>
        <h2>6. Acceptable use</h2>
        <p>
          You must not interfere with the website, attempt unauthorised access,
          introduce malicious code, misuse promotions, submit misleading
          information or infringe another person’s rights.
        </p>
      </section>

      <section>
        <h2>7. Privacy</h2>
        <p>
          Our handling of personal information is described in our{" "}
          <Link href="/privacy-policy">Privacy Policy</Link>. By using
          ClickClickBuy, you acknowledge that you have read that policy.
        </p>
      </section>

      <section>
        <h2>8. Changes and service availability</h2>
        <p>
          We may update the website, products, features or these terms from
          time to time. The current version will be published on this page.
          We may suspend parts of the service for maintenance, security or
          operational reasons.
        </p>
      </section>

      <section>
        <h2>9. Contact</h2>
        <p>
          If you have a question about these terms, please use the{" "}
          <Link href="/help">ClickClickBuy Help Centre</Link>.
        </p>
      </section>

      <p className="legal-intro">
        Draft for product implementation. These terms should be reviewed and
        approved by ClickClickBuy’s legal adviser before launch.
      </p>
    </main>
  );
}
