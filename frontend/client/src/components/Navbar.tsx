"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ChevronDown,
  CircleHelp,
  CreditCard,
  Headphones,
  Heart,
  MessageCircle,
  Package,
  ShoppingCart,
  UserRound,
  Wallet,
  XCircle,
} from "lucide-react";
import SearchBar from "./SearchBar";
import ShoppingCartIcon from "./ShoppingCartIcon";
import AnnouncementBar from "./AnnouncementBar";

const navigation = [
  { label: "Home", href: "/" },
  { label: "Shop", href: "/products" },
  { label: "Categories", href: "/products" },
  { label: "Deals", href: "/products?sort=discount" },
  { label: "New Arrivals", href: "/products?sort=newest" },
];

const placeholderClass =
  "flex w-full cursor-not-allowed items-center gap-3 px-4 py-3 text-left text-sm text-[var(--shop-muted)]";
const activeClass =
  "flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--shop-body)] transition-colors hover:bg-[var(--shop-blue-light)] hover:text-[var(--shop-navy)]";

function ComingSoon({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto shrink-0 rounded-full bg-[var(--shop-search)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--shop-muted)]">
      {children}
    </span>
  );
}

const Navbar = () => {
  const [activeMenu, setActiveMenu] = useState<"account" | "help" | null>(null);

  return (
    <header className="w-full">
      <AnnouncementBar />
      <div className="border-b border-[var(--shop-border)] bg-white">
        <div className="mx-auto flex header-inner flex-wrap items-center justify-between gap-x-3 gap-y-3 py-3 sm:gap-x-4 sm:py-4">
          <Link href="/" aria-label="ShopSphere home" className="flex shrink-0 items-center gap-2">
            <Image
              src="/logo.png"
              alt=""
              width={36}
              height={36}
              priority
              className="h-8 w-8 object-contain sm:h-9 sm:w-9"
            />
            <span className="text-[21px] font-bold tracking-[-0.8px] text-[var(--shop-navy)] sm:text-[24px]">
              Shop<span className="text-[var(--shop-orange)]">Sphere</span>
            </span>
          </Link>

          <nav aria-label="Main navigation" className="order-3 hidden items-center gap-5 text-[15px] font-semibold text-[var(--shop-navy)] lg:order-2 lg:flex xl:gap-6">
            {navigation.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="whitespace-nowrap transition-colors hover:text-[var(--shop-orange)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="order-2 flex shrink-0 items-center justify-end gap-1 sm:gap-2 lg:order-3">
            <SearchBar />

            <div className="relative z-10" onMouseEnter={() => setActiveMenu("account")} onMouseLeave={() => setActiveMenu(null)}> {
                if (event.currentTarget.open && helpMenuRef.current) {
                  helpMenuRef.current.open = false;
                }
              }}
              className="group relative z-10 open:z-50"
            >
              <button
                type="button"
                aria-label="Account menu"
                aria-expanded={activeMenu === "account"}
                onClick={() => setActiveMenu(activeMenu === "account" ? null : "account")}
                className="flex h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-[var(--shop-navy)] transition-colors hover:bg-[var(--shop-blue-light)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--shop-orange)] sm:px-3"
              >
                <UserRound size={22} strokeWidth={1.9} />
                <span className="hidden text-sm font-semibold sm:inline">Account</span>
                <ChevronDown size={16} className={`hidden transition-transform duration-200 sm:block ${activeMenu === "account" ? "rotate-180" : ""}`} />
              </button>
              <div aria-hidden={activeMenu !== "account"} className={`absolute right-0 top-full z-50 mt-2 w-[min(19rem,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-xl border border-[var(--shop-border)] bg-white shadow-xl transition-all duration-200 ease-out ${activeMenu === "account" ? "visible translate-y-0 scale-100 opacity-100" : "invisible -translate-y-2 scale-[0.98] opacity-0 pointer-events-none"}`}>
                <div className="border-b border-[var(--shop-border)] p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--shop-navy)]">
                    <UserRound size={18} />
                    Welcome to ShopSphere
                  </div>
                  <div className="flex items-center justify-center rounded-lg bg-[var(--shop-orange)] px-4 py-3 text-sm font-bold text-white shadow-sm">
                    Sign In <ComingSoon>Coming soon</ComingSoon>
                  </div>
                </div>
                <div className="py-1">
                  <div className={placeholderClass}>
                    <UserRound size={19} /> My Account <ComingSoon>Coming soon</ComingSoon>
                  </div>
                  <div className={placeholderClass}>
                    <Package size={19} /> Orders <ComingSoon>Coming soon</ComingSoon>
                  </div>
                  <div className={placeholderClass}>
                    <Heart size={19} /> Wishlist <ComingSoon>Coming soon</ComingSoon>
                  </div>
                </div>
              </div>
            </details>

            <div className="relative z-10" onMouseEnter={() => setActiveMenu("help")} onMouseLeave={() => setActiveMenu(null)}> {
                if (event.currentTarget.open && accountMenuRef.current) {
                  accountMenuRef.current.open = false;
                }
              }}
              className="group relative z-10 open:z-50"
            >
              <button
                type="button"
                aria-label="Help menu"
                aria-expanded={activeMenu === "help"}
                onClick={() => setActiveMenu(activeMenu === "help" ? null : "help")}
                className="flex h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-[var(--shop-navy)] transition-colors hover:bg-[var(--shop-blue-light)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--shop-orange)] sm:px-3"
              >
                <CircleHelp size={22} strokeWidth={1.9} />
                <span className="hidden text-sm font-semibold sm:inline">Help</span>
                <ChevronDown size={16} className={`hidden transition-transform duration-200 sm:block ${activeMenu === "help" ? "rotate-180" : ""}`} />
              </button>
              <div aria-hidden={activeMenu !== "help"} className={`absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-xl border border-[var(--shop-border)] bg-white shadow-xl transition-all duration-200 ease-out ${activeMenu === "help" ? "visible translate-y-0 scale-100 opacity-100" : "invisible -translate-y-2 scale-[0.98] opacity-0 pointer-events-none"}`}>
                <div className="py-1">
                  <Link href="/help" className={activeClass}>
                    <CircleHelp size={19} /> Help Centre
                  </Link>
                  <div className={placeholderClass}>
                    <ShoppingCart size={19} /> Place an order <ComingSoon>Coming soon</ComingSoon>
                  </div>
                  <div className={placeholderClass}>
                    <Wallet size={19} /> Payment options <ComingSoon>Coming soon</ComingSoon>
                  </div>
                  <Link href="/track-order" className={activeClass}>
                    <Package size={19} /> Track an order
                  </Link>
                  <div className={placeholderClass}>
                    <XCircle size={19} /> Cancel an order <ComingSoon>Coming soon</ComingSoon>
                  </div>
                  <div className={placeholderClass}>
                    <CreditCard size={19} /> Returns &amp; Refunds <ComingSoon>Coming soon</ComingSoon>
                  </div>
                  <div className={placeholderClass}>
                    <UserRound size={19} /> Cookie Preferences <ComingSoon>Coming soon</ComingSoon>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 border-t border-[var(--shop-border)] p-3">
                  <div className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[var(--shop-orange)] px-2 text-center text-xs font-bold text-white">
                    <MessageCircle size={18} /> Live Chat
                    <span className="text-[9px] font-medium">Soon</span>
                  </div>
                  <div className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-emerald-500 px-2 text-center text-xs font-bold text-emerald-600">
                    <Headphones size={18} /> WhatsApp
                    <span className="text-[9px] font-medium">Soon</span>
                  </div>
                </div>
              </div>
            </details>

            <ShoppingCartIcon />
          </div>

          <nav aria-label="Mobile and tablet navigation" className="order-4 flex w-full items-center justify-around border-t border-[var(--shop-border)] pt-2 text-[15px] font-semibold text-[var(--shop-navy)] lg:hidden">
            {navigation.map((item, index) => (
              <Link
                key={item.label}
                href={item.href}
                className={`whitespace-nowrap hover:text-[var(--shop-orange)] ${index > 2 ? "hidden md:inline-flex" : ""}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
