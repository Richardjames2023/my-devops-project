import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import ProductList from "@/components/ProductList";

const Homepage = async ({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) => {
  const { category } = await searchParams;

  return (
    <div className="pb-12">
      <section
        aria-labelledby="home-hero-title"
        className="relative isolate mt-5 min-h-[420px] overflow-hidden rounded-[28px] bg-[var(--shop-navy)] sm:mt-7 sm:min-h-[480px] lg:min-h-[520px]"
      >
        <Image
          src="/featured.png"
          alt="Explore the ClickClickBuy collection"
          fill
          priority
          sizes="(max-width: 768px) 100vw, 1280px"
          className="absolute inset-0 -z-20 object-cover object-center"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#081c41]/95 via-[#081c41]/75 to-[#081c41]/10 sm:to-transparent" />
        <div className="flex min-h-[420px] items-end px-6 py-9 sm:min-h-[480px] sm:px-10 sm:py-12 lg:min-h-[520px] lg:items-center lg:px-16">
          <div className="max-w-2xl text-white">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white backdrop-blur-sm">
              <Sparkles size={14} className="text-[var(--shop-orange)]" aria-hidden="true" />
              Discover ClickClickBuy
            </div>
            <h1
              id="home-hero-title"
              className="max-w-xl text-4xl font-extrabold leading-[1.06] tracking-[-0.045em] text-white sm:text-5xl lg:text-6xl"
            >
              Find your next
              <span className="block text-[#ffb27f]">everyday favourite.</span>
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-7 text-white/80 sm:text-base sm:leading-8">
              Explore clothing, footwear and accessories selected for your
              everyday style.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/products"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--shop-orange)] px-6 py-3 text-sm font-bold text-white shadow-lg shadow-black/15 transition-colors hover:bg-[var(--shop-orange-dark)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Explore the collection
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link
                href="/products?category=shoes"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/45 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Shop footwear
              </Link>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 right-0 hidden h-1.5 w-1/3 bg-[var(--shop-orange)] lg:block" />
      </section>

      <section aria-label="Storefront highlights" className="my-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { number: "01", title: "Explore the edit", detail: "Browse a range of everyday styles." },
          { number: "02", title: "Find your fit", detail: "Discover clothing and footwear options." },
          { number: "03", title: "Make it yours", detail: "Choose pieces that suit your style." },
        ].map((item) => (
          <div
            key={item.number}
            className="flex items-start gap-4 rounded-2xl border border-[var(--shop-border)] bg-white p-4 sm:p-5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--shop-peach)] text-xs font-extrabold text-[var(--shop-orange-dark)]">
              {item.number}
            </span>
            <div>
              <h2 className="text-sm font-bold text-[var(--shop-navy)]">{item.title}</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--shop-muted)]">{item.detail}</p>
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="collection-title" className="pt-5">
        <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--shop-orange-dark)]">
              The ClickClickBuy edit
            </p>
            <h2 id="collection-title" className="text-2xl font-extrabold tracking-tight text-[var(--shop-navy)] sm:text-3xl">
              Explore the collection
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--shop-muted)]">
              Browse the range and find something that feels like you.
            </p>
          </div>
          <Link
            href="/products"
            className="inline-flex items-center gap-2 text-sm font-bold text-[var(--shop-blue)] transition-colors hover:text-[var(--shop-orange-dark)]"
          >
            View all products <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <ProductList category={category} params="homepage" />
      </section>
    </div>
  );
};

export default Homepage;
