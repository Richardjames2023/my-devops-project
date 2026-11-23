import Link from "next/link";
import { RotateCcw, ShieldCheck, Truck } from "lucide-react";

const AnnouncementBar = () => (
  <div className="bg-[var(--shop-navy)] text-white">
    <div className="header-inner mx-auto flex min-h-10 flex-wrap items-center justify-center gap-x-6 gap-y-2 py-2 text-[11px] font-semibold sm:min-h-11 sm:justify-between sm:text-xs">
      <Link href="/delivery-information" className="inline-flex items-center gap-2 transition-colors hover:text-[var(--shop-orange)]">
        <Truck size={15} className="text-[var(--shop-orange)]" aria-hidden="true" />
        <span>Delivery across Nigeria</span>
      </Link>
      <Link href="/returns-policy" className="inline-flex items-center gap-2 transition-colors hover:text-[var(--shop-orange)]">
        <RotateCcw size={15} className="text-[var(--shop-orange)]" aria-hidden="true" />
        <span>7-day returns policy</span>
      </Link>
      <Link href="/payment-information" className="inline-flex items-center gap-2 transition-colors hover:text-[var(--shop-orange)]">
        <ShieldCheck size={15} className="text-[var(--shop-orange)]" aria-hidden="true" />
        <span>Payment information</span>
      </Link>
    </div>
  </div>
);

export default AnnouncementBar;
