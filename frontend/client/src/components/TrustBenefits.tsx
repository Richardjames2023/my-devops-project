import { BadgeCheck, PackageCheck, ShieldCheck, Truck } from "lucide-react";

const benefits = [
  {
    title: "Delivery across Nigeria",
    description: "Six geopolitical zones, including Abuja and its environs.",
    Icon: Truck,
  },
  {
    title: "Secure payments",
    description: "Complete your order through our Paystack checkout.",
    Icon: ShieldCheck,
  },
  {
    title: "7-day returns",
    description: "Our 7-day returns policy gives you room to decide.",
    Icon: PackageCheck,
  },
  {
    title: "Shop with confidence",
    description: "Clear product details help you choose what is right for you.",
    Icon: BadgeCheck,
  },
];

export default function TrustBenefits() {
  return (
    <section className="trust-benefits" aria-label="Shopping with confidence">
      <ul className="trust-benefits__list">
        {benefits.map(({ title, description, Icon }) => (
          <li className="trust-benefits__item" key={title}>
            <span className="trust-benefits__icon" aria-hidden="true">
              <Icon size={27} strokeWidth={1.8} />
            </span>
            <span className="trust-benefits__copy">
              <span className="trust-benefits__title">{title}</span>
              <span className="trust-benefits__description">{description}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
