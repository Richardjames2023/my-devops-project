import Image from "next/image";
import Link from "next/link";
import { RotateCcw, ShieldCheck } from "lucide-react";

const featuredCategories = [
  {
    name: "Home & Living",
    detail: "Everyday essentials for your space",
    image: "https://images.unsplash.com/photo-1593085260707-5377ba37f868?w=160&auto=format&fit=crop&q=80",
    href: "/products?category=home-living",
  },
  {
    name: "Garden & Outdoor",
    detail: "Make more of your outdoor space",
    image: "https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=160&auto=format&fit=crop&q=80",
    href: "/products?category=garden-outdoor",
  },
  {
    name: "Kitchen & Dining",
    detail: "Useful finds for everyday meals",
    image: "https://images.unsplash.com/photo-1603199506016-b9a594b593c0?w=160&auto=format&fit=crop&q=80",
    href: "/products?category=kitchen-dining",
  },
  {
    name: "Electrical & Lighting",
    detail: "Bright ideas for home and work",
    image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=160&auto=format&fit=crop&q=80",
    href: "/products?category=electrical-lighting",
  },
];

const AnnouncementBar = () => {
  return (
    <div className="bg-[var(--shop-navy)] text-white">
      <div className="header-inner mx-auto grid min-h-[48px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 py-1 sm:min-h-[58px] sm:gap-4">
        <Link href="/returns-policy" className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold transition-colors hover:text-[var(--shop-orange)] sm:gap-2 sm:text-xs">
          <RotateCcw size={15} className="text-[var(--shop-orange)]" aria-hidden="true" />
          <span><span className="hidden sm:inline">7-day easy returns</span><span className="sm:hidden">7-day returns</span></span>
        </Link>

        <div aria-label="Explore ClickClickBuy categories" className="group relative block min-w-0 overflow-hidden rounded-md border border-white/10 bg-gradient-to-r from-[#101326] via-[#18264a] to-[#713b35] shadow-inner">
          <div className="shopsphere-ad-track flex w-max">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
                {featuredCategories.map((category) => (
                  <Link href={category.href} key={category.name} tabIndex={copy === 1 ? -1 : 0} className="flex h-10 w-[190px] items-center gap-2 px-2 transition-colors hover:bg-white/10 sm:h-11 sm:w-[310px] sm:gap-3 sm:px-4">
                    <Image src={category.image} alt="" width={36} height={36} className="h-8 w-8 shrink-0 rounded object-cover sm:h-10 sm:w-10" />
                    <span className="min-w-0">
                      <span className="block truncate text-[10px] font-extrabold tracking-wide text-white sm:text-xs">{category.name}</span>
                      <span className="hidden truncate text-[9px] font-medium text-white/75 sm:block sm:text-[10px]">{category.detail}</span>
                    </span>
                    <span className="ml-auto shrink-0 rounded-full bg-[var(--shop-orange)] px-1.5 py-1 text-[8px] font-bold uppercase tracking-wider text-white sm:px-2 sm:text-[9px]">Explore</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </div>

        <Link href="/payment-information" className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold transition-colors hover:text-[var(--shop-orange)] sm:gap-2 sm:text-xs">
          <ShieldCheck size={15} className="text-[var(--shop-orange)]" aria-hidden="true" />
          <span><span className="hidden sm:inline">Secure checkout</span><span className="sm:hidden">Secure</span></span>
        </Link>
      </div>
    </div>
  );
};

export default AnnouncementBar;
