import Link from "next/link";
import { ArrowLeft, PackageSearch } from "lucide-react";

const TrackOrderPage = () => {
  return (
    <section className="mx-auto flex min-h-[55vh] max-w-3xl flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--shop-peach)] text-[var(--shop-orange-dark)]">
        <PackageSearch size={30} strokeWidth={1.7} aria-hidden="true" />
      </div>
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--shop-orange)]">
        Order updates
      </p>
      <h1 className="text-3xl font-bold tracking-tight text-[var(--shop-navy)] sm:text-4xl">
        Track your order
      </h1>
      <p className="mt-4 max-w-xl text-base leading-7 text-[var(--shop-muted)]">
        Order tracking is coming soon. When tracking is available, you’ll be able
        to view delivery updates through your customer account or the secure
        access details provided for a guest order.
      </p>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--shop-muted)]">
        For your security, guest order tracking uses a private access token.
        We won’t ask you to enter sensitive order-access details on this
        placeholder page.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <span className="rounded-full border border-[var(--shop-border)] bg-[var(--shop-search)] px-6 py-3 text-sm font-semibold text-[var(--shop-muted)]">
          Account sign-in coming soon
        </span>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full border border-[var(--shop-border)] bg-white px-6 py-3 text-sm font-semibold text-[var(--shop-navy)] transition-colors hover:bg-[var(--shop-blue-light)]"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to shopping
        </Link>
      </div>
    </section>
  );
};

export default TrackOrderPage;
