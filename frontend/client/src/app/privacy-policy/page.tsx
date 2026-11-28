import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <main className="legal-page">
      <p className="customer-auth-eyebrow">CLICKCLICKBUY</p>
      <h1>Privacy Policy</h1>
      <p className="legal-intro">
        This policy explains what information ClickClickBuy may collect when
        you browse, create an account, contact us or place an order, and how
        that information is used.
      </p>

      <section>
        <h2>1. Information we collect</h2>
        <p>
          Depending on how you use the service, information may include your
          name, email address, phone number, delivery details, account
          credentials, order and transaction records, support conversations,
          and preferences. We may also collect technical information such as
          device, browser, log and website-usage data.
        </p>
      </section>

      <section>
        <h2>2. How we use information</h2>
        <p>We may use information to:</p>
        <ul>
          <li>create and manage your account;</li>
          <li>process orders, payments, delivery, returns and refunds;</li>
          <li>provide customer support and respond to enquiries;</li>
          <li>protect the service, detect fraud and maintain security;</li>
          <li>improve our website, products and customer experience; and</li>
          <li>send service messages and, where permitted, marketing messages.</li>
        </ul>
      </section>

      <section>
        <h2>3. Sharing information</h2>
        <p>
          We may share relevant information with service providers who help
          operate the store, process payments, deliver orders, host systems,
          provide customer support or protect against fraud. We do not
          authorise these providers to use the information for unrelated
          purposes. We may also disclose information where required by law
          or necessary to protect customers, the business or the service.
        </p>
      </section>

      <section>
        <h2>4. Payments</h2>
        <p>
          Payments may be handled by third-party payment providers. Payment
          details are processed according to the provider’s systems and
          policies. ClickClickBuy should not store full payment-card security
          credentials.
        </p>
      </section>

      <section>
        <h2>5. Cookies and similar technologies</h2>
        <p>
          The website may use cookies or similar technologies to support
          essential functions, maintain sessions, remember preferences,
          understand website usage and improve performance. Browser settings
          may allow you to manage some cookies, although disabling essential
          cookies can affect website functionality.
        </p>
      </section>

      <section>
        <h2>6. Security and retention</h2>
        <p>
          We use reasonable technical and organisational measures intended
          to protect personal information. No online service can guarantee
          absolute security. We retain information for as long as reasonably
          needed for the purposes described in this policy, including legal,
          accounting, dispute-resolution and security requirements.
        </p>
      </section>

      <section>
        <h2>7. Your choices and rights</h2>
        <p>
          Depending on applicable law, you may be able to request access to,
          correction or deletion of personal information, object to or
          restrict certain processing, or withdraw consent where processing
          is based on consent. You may also opt out of marketing messages.
          Some records may need to be retained where the law permits or
          requires it.
        </p>
      </section>

      <section>
        <h2>8. Children</h2>
        <p>
          ClickClickBuy is intended for people who can legally enter into
          purchases and account agreements. We do not knowingly seek to
          collect personal information from children in violation of
          applicable law.
        </p>
      </section>

      <section>
        <h2>9. Updates and contact</h2>
        <p>
          We may update this policy as our service or legal obligations
          change. The current version will be published here. For privacy
          questions or requests, contact us through the{" "}
          <Link href="/help">ClickClickBuy Help Centre</Link>.
        </p>
      </section>

      <p className="legal-intro">
        Draft for product implementation. ClickClickBuy should confirm its
        data practices, service providers, retention periods and contact
        details, and obtain legal review before launch.
      </p>
    </main>
  );
}
