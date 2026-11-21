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
        <div className="mx-auto flex header-inner flex-wrap items-center justify-between gap-x-2 gap-y-3 py-3 sm:gap-x-4 sm:py-3.5">
          <Link href="/" aria-label="ShopSphere home" className="flex shrink-0 items-center gap-2">
            <Image
              src="/logo.png"
              alt=""
              width={36}
              height={36}
              priority
              className="h-8 w-8 object-contain sm:h-9 sm:w-9"
            />
            <span className="text-[20px] font-bold tracking-[-0.8px] text-[var(--shop-navy)] sm:text-[23px]">
              Shop<span className="text-[var(--shop-orange)]">Sphere</span>
            </span>
          </Link>

          <nav aria-label="Main navigation" className="order-3 hidden items-center gap-5 text-sm font-semibold text-[var(--shop-navy)] lg:order-2 lg:flex">
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

          <div className="order-2 flex shrink-0 items-center justify-end gap-1 sm:gap-3 lg:order-3">
            <SearchBar />
            <Link
              href="/login"
              aria-label="My account"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--shop-navy)] transition-colors hover:bg-[var(--shop-blue-light)]"
            >
              <UserRound size={20} strokeWidth={1.8} />
            </Link>
            <Link
              href="/"
              aria-label="Wishlist"
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--shop-navy)] transition-colors hover:bg-[var(--shop-blue-light)] sm:flex"
            >
              <Heart size={20} strokeWidth={1.8} />
            </Link>
            <ShoppingCartIcon />
            <Link href="/login" className="hidden whitespace-nowrap text-sm font-semibold text-[var(--shop-navy)] hover:text-[var(--shop-orange)] lg:inline">
              Sign in
            </Link>
          </div>

          <nav aria-label="Mobile and tablet navigation" className="order-4 flex w-full items-center justify-around border-t border-[var(--shop-border)] pt-2 text-sm font-semibold text-[var(--shop-navy)] lg:hidden">
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
