import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

const Footer = () => {
  return (
    <footer className="mt-16 overflow-hidden rounded-t-[28px] bg-[var(--shop-navy)] text-white">
      <div className="grid gap-10 px-6 py-10 sm:px-9 sm:py-12 lg:grid-cols-[1.5fr_1fr_1fr] lg:gap-16">
        <div className="max-w-sm">
          <Link href="/" aria-label="ClickClickBuy home" className="inline-flex items-center gap-3">
            <Image src="/logo.png" alt="" width={42} height={42} className="h-10 w-10 object-contain" />
            <span className="text-xl font-extrabold tracking-tight">
              ClickClick<span className="text-[var(--shop-orange)]">Buy</span>
            </span>
          </Link>
          <p className="mt-5 max-w-xs text-sm leading-7 text-white/65">
            Discover clothing, footwear and accessories for your everyday style.
          </p>
        </div>

        <nav aria-label="Explore" className="grid content-start gap-3 text-sm">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-white/45">Explore</h2>
          <Link href="/products" className="w-fit text-white/80 transition-colors hover:text-[var(--shop-orange)]">Shop all products</Link>
          <Link href="/products?category=shoes" className="w-fit text-white/80 transition-colors hover:text-[var(--shop-orange)]">Shoes</Link>
          <Link href="/products?category=t-shirts" className="w-fit text-white/80 transition-colors hover:text-[var(--shop-orange)]">T-shirts</Link>
          <Link href="/products?category=jackets" className="w-fit text-white/80 transition-colors hover:text-[var(--shop-orange)]">Jackets</Link>
        </nav>

        <nav aria-label="Customer help" className="grid content-start gap-3 text-sm">
          <h2 className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-white/45">Need a hand?</h2>
          <Link href="/help" className="w-fit text-white/80 transition-colors hover:text-[var(--shop-orange)]">Help centre</Link>
          <Link href="/track-order" className="w-fit text-white/80 transition-colors hover:text-[var(--shop-orange)]">Track an order</Link>
          <Link href="/cart" className="w-fit inline-flex items-center gap-1 text-white/80 transition-colors hover:text-[var(--shop-orange)]">
            Your shopping cart <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </nav>
      </div>

      <div className="flex flex-col gap-2 border-t border-white/10 px-6 py-5 text-xs text-white/45 sm:flex-row sm:items-center sm:justify-between sm:px-9">
        <p>© {new Date().getFullYear()} ClickClickBuy. All rights reserved.</p>
        <p>Find your next everyday favourite.</p>
      </div>
    </footer>
  );
};

export default Footer;
