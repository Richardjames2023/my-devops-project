import Link from "next/link";

const deliveryZones = [
  "North Central",
  "North East",
  "North West",
  "South East",
  "South South",
  "South West",
];

export const metadata = {
  title: "Delivery Information | ClickClickBuy",
  description: "See where ClickClickBuy currently delivers across Nigeria.",
};

export default function DeliveryInformationPage() {
  return (
    <article className="store-info-page">
      <Link className="store-info-page__back" href="/">← Back to shopping</Link>
      <p className="store-info-page__eyebrow">DELIVERY INFORMATION</p>
      <h1>Delivery across Nigeria</h1>
      <p className="store-info-page__intro">
        ClickClickBuy currently serves customers across all six geopolitical
        zones of Nigeria, as well as Abuja and its surrounding areas.
      </p>
      <section className="store-info-page__section">
        <h2>Where we deliver</h2>
        <ul className="store-info-page__zones">
          {deliveryZones.map((zone) => <li key={zone}>{zone}</li>)}
        </ul>
        <p>We also deliver to Abuja and its environs.</p>
      </section>
      <section className="store-info-page__section">
        <h2>Delivery fees and timing</h2>
        <p>
          Delivery fees are configured by delivery zone. The applicable fee
          and any available delivery estimate should be checked for your
          destination during the ordering process before you place your order.
        </p>
      </section>
      <Link className="store-info-page__primary-link" href="/products">
        Browse products <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}
