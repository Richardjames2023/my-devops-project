import Image from "next/image";
import Link from "next/link";
import { Heart, UserRound } from "lucide-react";
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

const Navbar = () => {
  return (
    <header className="w-full">
      <AnnouncementBar />
      <div className="border-b border-[var(--shop-border)] bg-white">
        <div className="mx-auto flex w-[min(100%-48px,1280px)] flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3 sm:flex-nowrap sm:py-3.5 max-sm:w-[min(100%-28px,1280px)]">
          <Link href="/" aria-label="ShopSphere home" className="flex shrink-0 items-center gap-2">
            <Image
              src="/logo.png"
              alt=""
              width={34}
              height={34}
              priority
              className="h-8 w-8 object-contain"
            />
            <span className="text-[21px] font-bold tracking-[-0.8px] text-[var(--shop-navy)]">
              Shop<span className="text-[var(--shop-orange)]">Sphere</span>
            </span>
          </Link>

          <nav aria-label="Main navigation" className="order-3 hidden items-center gap-5 text-[12px] font-semibold text-[var(--shop-navy)] lg:flex lg:order-2">
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

          <div className="order-2 flex min-w-0 items-center justify-end gap-3 sm:gap-4 lg:order-3">
            <SearchBar />
            <Link
              href="/login"
              aria-label="My account"
              className="hidden h-9 w-9 items-center justify-center rounded-full text-[var(--shop-navy)] transition-colors hover:bg-[var(--shop-blue-light)] sm:flex"
            >
              <UserRound size={18} strokeWidth={1.8} />
            </Link>
            <Link
              href="/"
              aria-label="Wishlist"
              className="hidden h-9 w-9 items-center justify-center rounded-full text-[var(--shop-navy)] transition-colors hover:bg-[var(--shop-blue-light)] sm:flex"
            >
              <Heart size={18} strokeWidth={1.8} />
            </Link>
            <ShoppingCartIcon />
            <Link href="/login" className="hidden text-xs font-semibold text-[var(--shop-navy)] hover:text-[var(--shop-orange)] md:inline">
              Sign in
            </Link>
          </div>

          <nav aria-label="Mobile navigation" className="order-4 flex w-full items-center justify-between border-t border-[var(--shop-border)] pt-2 text-xs font-semibold text-[var(--shop-navy)] lg:hidden">
            {navigation.map((item) => (
              <Link key={item.label} href={item.href} className="whitespace-nowrap hover:text-[var(--shop-orange)]">
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
