import Image from "next/image";
import Link from "next/link";
import { RotateCcw, ShieldCheck } from "lucide-react";

const featuredProducts = [
  { name: "Puma Ultra Warm Zip", detail: "Layer up in comfort", image: "/products/2g.png", href: "/products?category=jackets" },
  { name: "Nike Air Essentials", detail: "Everyday style, easy comfort", image: "/products/3gr.png", href: "/products?category=jackets" },
  { name: "Nike Air Max 270", detail: "Find your next favourite pair", image: "/products/6g.png", href: "/products?category=shoes" },
  { name: "Nike Ultraboost Pulse", detail: "Made to move with you", image: "/products/7g.png", href: "/products?category=sportswear" },
];

const AnnouncementBar = () => {
  return (
    <div className="bg-[var(--shop-navy)] text-white">
      <div className="header-inner mx-auto grid min-h-[58px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 py-1.5 sm:gap-4">
        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold sm:gap-2 sm:text-xs">
          <RotateCcw size={15} className="text-[var(--shop-orange)]" aria-hidden="true" />
          <span><span className="hidden sm:inline">30-day easy returns</span><span className="sm:hidden">30-day returns</span></span>
        </div>

        <div aria-label="Featured product promotions" className="group relative block min-w-0 overflow-hidden rounded-md border border-white/10 bg-gradient-to-r from-[#101326] via-[#18264a] to-[#713b35] shadow-inner">
          <div className="shopsphere-ad-track flex w-max">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
                {featuredProducts.map((product) => (
                  <Link href={product.href} key={product.name} tabIndex={copy === 1 ? -1 : 0} className="flex h-11 w-[250px] items-center gap-3 px-3 transition-colors hover:bg-white/10 sm:w-[310px] sm:px-4">
                    <Image src={product.image} alt="" width={42} height={42} className="h-9 w-9 shrink-0 object-contain drop-shadow-md sm:h-10 sm:w-10" />
                    <span className="min-w-0">
                      <span className="block truncate text-[10px] font-extrabold tracking-wide text-white sm:text-xs">{product.name}</span>
                      <span className="block truncate text-[9px] font-medium text-white/75 sm:text-[10px]">{product.detail}</span>
                    </span>
                    <span className="ml-auto shrink-0 rounded-full bg-[var(--shop-orange)] px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-white sm:text-[9px]">Shop now</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </a>

        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[10px] font-semibold sm:gap-2 sm:text-xs">
          <ShieldCheck size={15} className="text-[var(--shop-orange)]" aria-hidden="true" />
          <span><span className="hidden sm:inline">Secure checkout</span><span className="sm:hidden">Secure</span></span>
        </div>
      </div>
    </div>
  );
};

export default AnnouncementBar;
