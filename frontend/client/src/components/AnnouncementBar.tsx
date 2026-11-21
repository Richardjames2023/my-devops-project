import { RotateCcw, ShieldCheck, Truck } from "lucide-react";

const AnnouncementBar = () => {
  return (
    <div className="bg-[var(--shop-navy)] text-white">
      <div className="mx-auto flex min-h-[30px] w-[min(100%-48px,1280px)] items-center justify-between gap-4 text-[10px] font-medium tracking-[0.01em] max-sm:w-[min(100%-28px,1280px)]">
        <div className="flex min-w-0 items-center gap-4 overflow-hidden whitespace-nowrap">
          <span className="flex items-center gap-1.5">
            <Truck size={12} aria-hidden="true" />
            Free shipping on orders over ₦50,000
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            <RotateCcw size={12} aria-hidden="true" />
            30-day easy returns
          </span>
          <span className="hidden items-center gap-1.5 md:flex">
            <ShieldCheck size={12} aria-hidden="true" />
            Secure checkout
          </span>
        </div>
        <span className="shrink-0 text-white/80">Help Centre</span>
      </div>
    </div>
  );
};

export default AnnouncementBar;
