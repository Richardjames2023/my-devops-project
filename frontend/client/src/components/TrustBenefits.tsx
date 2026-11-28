import { BadgeCheck, PackageCheck, ShieldCheck, Truck } from "lucide-react";
import Link from "next/link";

const benefits = [
  {
    title: "Delivery across Nigeria",
    description: "Six geopolitical zones, including Abuja and its environs.",
    linkLabel: "View delivery information",
    href: "/delivery-information",
    Icon: Truck,
  },
  {
    title: "Secure payments",
    description: "Know what to expect when you pay for your order.",
    linkLabel: "How payments work",
    href: "/payment-information",
    Icon: ShieldCheck,
  },
  {
    title: "7-day returns",
    description: "A seven-day returns policy for eligible purchases.",
    linkLabel: "Read our returns policy",
    href: "/returns-policy",
    Icon: PackageCheck,
  },
  {
    title: "Shop with confidence",
    description: "Clear product details help you choose what is right for you.",
    linkLabel: "Explore products",
    href: "/products",
    Icon: BadgeCheck,
  },
];

export default function TrustBenefits() {
  return (
    <section className="trust-benefits" aria-label="Shopping with confidence">
      <ul className="trust-benefits__list">
        {benefits.map(({ title, description, linkLabel, href, Icon }) => (
          <li className="trust-benefits__item" key={title}>
            <Link className="trust-benefits__link" href={href}>
              <span className="trust-benefits__icon" aria-hidden="true">
                <Icon size={27} strokeWidth={1.8} />
              </span>
              <span className="trust-benefits__copy">
                <span className="trust-benefits__title">{title}</span>
                <span className="trust-benefits__description">{description}</span>
                <span className="trust-benefits__action">
                  {linkLabel} <span aria-hidden="true">→</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
