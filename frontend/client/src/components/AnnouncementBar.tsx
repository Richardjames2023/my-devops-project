import Link from "next/link";
import { RotateCcw, ShieldCheck, Sparkles } from "lucide-react";

const AnnouncementBar = () => {
  return (
    <div className="bg-[var(--shop-navy)] text-white">
      <div className="mx-auto flex min-h-9 header-inner items-center justify-between gap-4 text-xs font-medium tracking-[0.01em]">
        <div className="flex min-w-0 items-center gap-4 overflow-hidden whitespace-nowrap">
          <span className="flex items-center gap-1.5">
            <Sparkles size={14} aria-hidden="true" />
            Discover new arrivals and everyday favourites
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            <RotateCcw size={14} aria-hidden="true" />
            30-day easy returns
          </span>
          <span className="hidden items-center gap-1.5 md:flex">
            <ShieldCheck size={14} aria-hidden="true" />
            Secure checkout
          </span>
        </div>
        <nav aria-label="Customer support" className="flex shrink-0 items-center gap-4 sm:gap-5">
          <Link href="/track-order" className="text-white/90 transition-colors hover:text-white hover:underline">
            Track Order
          </Link>
          <Link href="/help" className="text-white/90 transition-colors hover:text-white hover:underline">
            Help Centre
          </Link>
        </nav>
      </div>
    </div>
  );
};

export default AnnouncementBar;
