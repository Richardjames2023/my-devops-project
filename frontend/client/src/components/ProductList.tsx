"use client";

import { useMemo, useState } from "react";
import Categories from "./Categories";
import ProductCard from "./ProductCard";
import Link from "next/link";
import Filter from "./Filter";
import { products } from "@/lib/catalogue";

const HOME_FILTERS = [
  { label: "All finds", slug: "all" },
  { label: "Home essentials", slug: "home-living" },
  { label: "Outdoor living", slug: "garden-outdoor" },
  { label: "Kitchen", slug: "kitchen-dining" },
  { label: "Lighting", slug: "electrical-lighting" },
];

const HOMEPAGE_INITIAL_LIMIT = 10;

const ProductList = ({ category, query, sort, params }: { category?: string; query?: string; sort?: string; params: "homepage" | "products" }) => {
  const [homeFilter, setHomeFilter] = useState("all");

  const normalizedCategory = category?.toLowerCase();
  const categoryFilteredProducts =
    !normalizedCategory || normalizedCategory === "all"
      ? products
      : products.filter((product) => product.categorySlug === normalizedCategory);

  const normalizedQuery = query?.trim().toLocaleLowerCase() ?? "";
  const searchedProducts = normalizedQuery
    ? categoryFilteredProducts.filter((product) =>
        [product.name, product.brand, product.categoryName, product.categorySlug, product.shortDescription, product.description, ...product.tags]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
    : categoryFilteredProducts;

  const visibleProducts = useMemo(() => [...searchedProducts].sort((a, b) => {
    switch (sort) {
      case "oldest": return String(b.id).localeCompare(String(a.id));
      case "asc": return a.price - b.price;
      case "desc": return b.price - a.price;
      case "newest":
      default: return 0;
    }
  }), [searchedProducts, sort]);

  const homepageProducts = useMemo(() => {
    const filtered = homeFilter === "all"
      ? visibleProducts
      : visibleProducts.filter((product) => product.categorySlug === homeFilter);
    return params === "homepage" ? filtered.slice(0, HOMEPAGE_INITIAL_LIMIT) : filtered;
  }, [homeFilter, params, visibleProducts]);

  const homepageFilteredCount = homeFilter === "all"
    ? visibleProducts.length
    : visibleProducts.filter((product) => product.categorySlug === homeFilter).length;

  return (
    <section className={params === "homepage" ? "homepage-collection" : "w-full"} aria-labelledby={params === "homepage" ? "homepage-collection-title" : undefined}>
      <div className={params === "homepage" ? "homepage-collection__inner" : "w-full"}>
        {params === "homepage" && (
          <>
            <div className="homepage-collection__intro">
              <div className="homepage-collection__intro-row">
                <div>
                  <h2 id="homepage-collection-title">Something <span className="homepage-collection__title-accent">useful</span> is waiting for you.</h2>
                  <p>From everyday essentials to little upgrades, find things that make life easier.</p>
                </div>
                <span className="homepage-collection__intro-note" aria-hidden="true">GOOD FINDS. EVERYDAY.</span>
              </div>
            </div>
            <div className="homepage-collection__discovery-bar">
              <div className="homepage-collection__filters" role="group" aria-label="Filter collection products">
                {HOME_FILTERS.map((filter) => (
                  <button
                    key={filter.slug}
                    type="button"
                    className={`homepage-collection__filter ${homeFilter === filter.slug ? "is-active" : ""}`}
                    aria-pressed={homeFilter === filter.slug}
                    onClick={() => {
                      setHomeFilter(filter.slug);
                    }}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <span className="homepage-collection__count">{homepageFilteredCount} finds</span>
            </div>
          </>
        )}
        {query?.trim() && <p className="mb-4 text-sm text-[var(--shop-muted)]">Search results for <span className="font-semibold text-[var(--shop-navy)]">&ldquo;{query.trim()}&rdquo;</span> · {visibleProducts.length} {visibleProducts.length === 1 ? "product" : "products"} found</p>}
        {params === "products" && <Categories />}
        {params === "products" && <Filter />}
        <div className={params === "homepage" ? "homepage-collection__grid" : "grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"}>
          {(params === "homepage" ? homepageProducts : visibleProducts).length > 0 ? (params === "homepage" ? homepageProducts : visibleProducts).map((product) => <ProductCard key={product.id} product={product} />) : (
            <div className="col-span-full rounded-xl border border-[var(--shop-border)] bg-white px-6 py-12 text-center">
              <h2 className="text-lg font-semibold text-[var(--shop-navy)]">No products found</h2>
              <p className="mt-2 text-sm text-[var(--shop-muted)]">{params === "homepage" ? "No demonstration products are in this collection yet. Try another selection." : "Try another product name or a broader search term."}</p>
              {params === "homepage" ? (
                <button type="button" onClick={() => setHomeFilter("all")} className="mt-4 inline-flex rounded-lg bg-[var(--shop-orange)] px-4 py-2 text-sm font-semibold text-white">See all finds</button>
              ) : (
                <Link href="/products" className="mt-4 inline-flex rounded-lg bg-[var(--shop-orange)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--shop-orange-dark)]">Browse all products</Link>
              )}
            </div>
          )}
        </div>
        {params === "homepage" ? (
          homepageFilteredCount > 0 && (
            <div className="homepage-collection__more">
              <Link href={homeFilter === "all" ? "/products" : "/products?category=" + homeFilter}>
                Explore more finds
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          )
        ) : (
          <Link href={category ? `/products/?category=${category}` : "/products"} className="mt-4 flex justify-end text-sm text-gray-500 underline">View all products</Link>
        )}
      </div>
    </section>
  );
};

export default ProductList;
