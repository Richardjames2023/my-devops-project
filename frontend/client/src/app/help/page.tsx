import Link from "next/link";
import { ArrowLeft, LifeBuoy } from "lucide-react";

const HelpCentrePage = () => {
  return (
    <section className="mx-auto flex min-h-[55vh] max-w-3xl flex-col items-center justify-center px-4 py-16 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--shop-blue-light)] text-[var(--shop-blue)]">
        <LifeBuoy size={30} strokeWidth={1.7} aria-hidden="true" />
      </div>
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--shop-orange)]">
        Customer support
      </p>
      <h1 className="text-3xl font-bold tracking-tight text-[var(--shop-navy)] sm:text-4xl">
        Help Centre
      </h1>
      <p className="mt-4 max-w-xl text-base leading-7 text-[var(--shop-muted)]">
        We’re putting our help resources together. Helpful answers and support
        information will be available here soon.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-[var(--shop-navy)] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--shop-blue)]"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Back to shopping
      </Link>
    </section>
  );
};

export default HelpCentrePage;
