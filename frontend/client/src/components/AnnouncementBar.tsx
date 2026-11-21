import Link from "next/link";
import { RotateCcw, ShieldCheck, Sparkles } from "lucide-react";

const AnnouncementBar = () => {
  return (
    <div className="bg-[var(--shop-navy)] text-white">
      <div className="mx-auto flex min-h-9 header-inner items-center justify-between gap-3 text-[11px] font-medium tracking-[0.01em] sm:text-xs">
        <div className="flex min-w-0 items-center gap-3 whitespace-nowrap lg:gap-4">
          <span className="hidden items-center gap-1.5 lg:flex">
            <Sparkles size={14} aria-hidden="true" />
            Discover new arrivals and everyday favourites
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <RotateCcw size={14} aria-hidden="true" />
            <span className="sm:hidden">30-day returns</span>
            <span className="hidden sm:inline">30-day easy returns</span>
          </span>
          <span className="hidden items-center gap-1.5 lg:flex">
            <ShieldCheck size={14} aria-hidden="true" />
            Secure checkout
          </span>
        </div>
        <nav aria-label="Customer support" className="flex shrink-0 items-center gap-3 sm:gap-5">
          <Link href="/track-order" className="whitespace-nowrap text-white/90 transition-colors hover:text-white hover:underline">
            Track Order
          </Link>
          <Link href="/help" className="whitespace-nowrap text-white/90 transition-colors hover:text-white hover:underline">
            Help Centre
          </Link>
        </nav>
      </div>
    </div>
  );
};

export default AnnouncementBar;
