import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Facebook, Instagram, MapPin, Music2, ShieldCheck, Youtube } from "lucide-react";

const footerGroups = [
  { title: "Shop", links: [
    { label: "All products", href: "/products" },
    { label: "New arrivals", href: "/products?sort=newest" },
    { label: "Browse categories", href: "/products" },
  ] },
  { title: "Information", links: [
    { label: "Delivery information", href: "/delivery-information" },
    { label: "Payment information", href: "/payment-information" },
    { label: "Returns policy", href: "/returns-policy" },
  ] },
  { title: "Customer care", links: [
    { label: "Help centre", href: "/help" },
    { label: "Track an order", href: "/track-order" },
    { label: "Contact support", href: "/help" },
  ] },
];

const Footer = () => (
  <footer className="storefront-footer">
    <div className="storefront-footer__main">
      <div className="storefront-footer__brand">
        <Link href="/" className="storefront-footer__logo" aria-label="ClickClickBuy homepage">
          <Image src="/logo.png" alt="" width={44} height={44} />
          <span>ClickClick<span>Buy</span></span>
        </Link>
        <p className="storefront-footer__description">
          Everyday essentials and useful finds, all in one place. Discover something that makes life a little easier.
        </p>
        <div className="storefront-footer__assurance">
          <span><MapPin size={16} aria-hidden="true" /> Delivery across Nigeria</span>
          <span><ShieldCheck size={16} aria-hidden="true" /> Secure payment options</span>
        </div>
        <Link href="/products" className="storefront-footer__shop-link">
          Shop all products <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
        <div className="storefront-footer__socials" aria-label="ClickClickBuy social media">
          <span role="img" aria-label="Facebook"><Facebook size={19} aria-hidden="true" /></span>
          <span role="img" aria-label="Instagram"><Instagram size={19} aria-hidden="true" /></span>
          <span role="img" aria-label="TikTok"><Music2 size={19} aria-hidden="true" /></span>
          <span role="img" aria-label="YouTube"><Youtube size={19} aria-hidden="true" /></span>
        </div>
      </div>

      {footerGroups.map((group) => (
        <nav className="storefront-footer__group" aria-label={group.title} key={group.title}>
          <h2>{group.title}</h2>
          <ul>
            {group.links.map((link) => (
              <li key={link.label}>
                <Link href={link.href}>{link.label}<ArrowUpRight size={13} aria-hidden="true" /></Link>
              </li>
            ))}
          </ul>
        </nav>
      ))}

      <div className="storefront-footer__contact">
        <h2>Find your next everyday essential</h2>
        <p>Explore useful finds for your home, work and everyday routines. Need a hand? We&apos;re here to help.</p>
        <Link href="/products" className="storefront-footer__help-link">
          Explore products <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
        <Link href="/help" className="storefront-footer__secondary-link">Visit our help centre</Link>
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

export default Footer;
