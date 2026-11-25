import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Headphones, MapPin, ShieldCheck } from "lucide-react";

const footerGroups = [
  {
    title: "Shop",
    links: [
      { label: "All products", href: "/products" },
      { label: "New arrivals", href: "/products?sort=newest" },
      { label: "Shop by category", href: "/#shop-by-category" },
    ],
  },
  {
    title: "Information",
    links: [
      { label: "Delivery information", href: "/delivery-information" },
      { label: "Payment information", href: "/payment-information" },
      { label: "Returns policy", href: "/returns-policy" },
    ],
  },
  {
    title: "Customer care",
    links: [
      { label: "Help centre", href: "/help" },
      { label: "Track an order", href: "/track-order" },
      { label: "My account", href: "/account" },
    ],
  },
];

const Footer = () => {
  return (
    <footer className="storefront-footer">
      <div className="storefront-footer__main">
        <div className="storefront-footer__brand">
          <Link href="/" className="storefront-footer__logo" aria-label="ClickClickBuy homepage">
            <Image src="/logo.png" alt="" width={42} height={42} />
            <span>ClickClick<span>Buy</span></span>
          </Link>
          <p className="storefront-footer__description">
            Everyday essentials and useful finds, all in one place. Discover something that makes life a little easier.
          </p>
          <div className="storefront-footer__assurance">
            <span><MapPin size={15} aria-hidden="true" /> Delivery across Nigeria</span>
            <span><ShieldCheck size={15} aria-hidden="true" /> Secure payment options</span>
          </div>
        </div>

        {footerGroups.map((group) => (
          <nav className="storefront-footer__group" aria-label={group.title} key={group.title}>
            <h2>{group.title}</h2>
            <ul>
              {group.links.map((link) => (
                <li key={link.label}>
                  <Link href={link.href}>{link.label}<ArrowUpRight size={12} aria-hidden="true" /></Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <div className="storefront-footer__contact">
          <h2>We're here to help</h2>
          <p>Questions about an order or need help choosing? Visit our help centre.</p>
          <Link href="/help" className="storefront-footer__help-link">
            <Headphones size={16} aria-hidden="true" />
            Visit help centre
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>

      <div className="storefront-footer__bottom">
        <p>© {new Date().getFullYear()} ClickClickBuy. All rights reserved.</p>
        <div className="storefront-footer__bottom-meta">
          <span className="storefront-footer__country"><span aria-hidden="true">🇳🇬</span> Nigeria</span>
          <span className="storefront-footer__currency">Prices in NGN (₦)</span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
