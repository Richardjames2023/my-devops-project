"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ProductCard from "./ProductCard";
import Link from "next/link";
import { products, categories } from "@/lib/catalogue";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, SlidersHorizontal, X } from "lucide-react";

const HOME_FILTERS = [
  { label: "All finds", slug: "all" },
  { label: "Home essentials", slug: "home-living" },
  { label: "Outdoor living", slug: "garden-outdoor" },
  { label: "Kitchen", slug: "kitchen-dining" },
  { label: "Lighting", slug: "electrical-lighting" },
];
const HOMEPAGE_INITIAL_LIMIT = 10;

const CATEGORY_PRESENTATION: Record<string, { title: string; description: string; image: string; subcategories: string[] }> = {
  "garden-outdoor": {
    title: "Garden & outdoor",
    description: "Practical finds for gardens, outdoor spaces and weekends outside.",
    image: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1800&q=85",
    subcategories: ["Outdoor décor", "Insect shelters", "Weekend outdoors"],
  },
  "home-living": {
    title: "Home & living",
    description: "Useful pieces to make your home feel more organised and welcoming.",
    image: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1800&q=85",
    subcategories: ["Storage & organisation", "Soft furnishings", "Home essentials"],
  },
  "electrical-lighting": {
    title: "Electrical & lighting",
    description: "Everyday lighting and practical electrical essentials.",
    image: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1800&q=85",
    subcategories: ["Desk lighting", "Home lighting", "Electrical essentials"],
  },
  "kitchen-dining": {
    title: "Kitchen & dining",
    description: "Useful kitchen tools, tableware and everyday dining essentials.",
    image: "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?auto=format&fit=crop&w=1800&q=85",
    subcategories: ["Tableware", "Food storage", "Kitchen essentials"],
  },
};

const ProductList = ({ category, query, sort, params }: { category?: string; query?: string; sort?: string; params: "homepage" | "products" }) => {
  const [homeFilter, setHomeFilter] = useState("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(9);
  const [isDraggingCategories, setIsDraggingCategories] = useState(false);
  const categoryFlowRef = useRef<HTMLDivElement>(null);
  const categoryDragRef = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false });
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const normalizedCategory = category?.toLowerCase();
  const categoryFilteredProducts = !normalizedCategory || normalizedCategory === "all"
    ? products
    : products.filter((product) => product.categorySlug === normalizedCategory);

  const normalizedQuery = query?.trim().toLocaleLowerCase() ?? "";
  const searchedProducts = normalizedQuery
    ? categoryFilteredProducts.filter((product) =>
        [product.name, product.brand, product.categoryName, product.categorySlug, product.shortDescription, product.description, ...product.tags]
          .join(" ").toLocaleLowerCase().includes(normalizedQuery),
      )
    : categoryFilteredProducts;

  const filteredProducts = useMemo(() => searchedProducts.filter((product) => {
    const min = minPrice === "" ? 0 : Number(minPrice);
    const max = maxPrice === "" ? Number.POSITIVE_INFINITY : Number(maxPrice);
    return product.price >= min && product.price <= max
      && (selectedBrands.length === 0 || selectedBrands.includes(product.brand))
      && (!inStockOnly || product.stockStatus !== "out-of-stock");
  }), [searchedProducts, minPrice, maxPrice, selectedBrands, inStockOnly]);

  const visibleProducts = useMemo(() => [...filteredProducts].sort((a, b) => {
    switch (sort) {
      case "asc": return a.price - b.price;
      case "desc": return b.price - a.price;
      case "rating": return (b.reviewSummary?.averageRating ?? 0) - (a.reviewSummary?.averageRating ?? 0);
      case "newest": return String(b.id).localeCompare(String(a.id));
      default: return 0;
    }
  }), [filteredProducts, sort]);

  const homepageProducts = useMemo(() => {
    const filtered = homeFilter === "all" ? visibleProducts : visibleProducts.filter((product) => product.categorySlug === homeFilter);
    return params === "homepage" ? filtered.slice(0, HOMEPAGE_INITIAL_LIMIT) : filtered;
  }, [homeFilter, params, visibleProducts]);

  const homepageFilteredCount = homeFilter === "all" ? visibleProducts.length : visibleProducts.filter((product) => product.categorySlug === homeFilter).length;
  const categoryInfo = normalizedCategory ? CATEGORY_PRESENTATION[normalizedCategory] : undefined;
  const categoryName = categoryFilteredProducts[0]?.categoryName ?? categories.find((item) => item.slug === normalizedCategory)?.name ?? "All products";
  const brands = [...new Set(categoryFilteredProducts.map((product) => product.brand))].sort();
  const maxCataloguePrice = Math.max(...categoryFilteredProducts.map((product) => product.price), 100000);
  const activeFilterCount = selectedBrands.length + (minPrice ? 1 : 0) + (maxPrice ? 1 : 0) + (inStockOnly ? 1 : 0) + (selectedTag ? 1 : 0);
  const displayedProducts = visibleProducts.slice(0, visibleCount);
  const hasMoreProducts = displayedProducts.length < visibleProducts.length;

  useEffect(() => {
    setVisibleCount(9);
  }, [normalizedCategory, normalizedQuery, minPrice, maxPrice, selectedBrands, inStockOnly, sort]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasMoreProducts) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((count) => Math.min(count + 9, visibleProducts.length));
      }
    }, { rootMargin: "240px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreProducts, visibleProducts.length]);

  const handleCategoryPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = categoryFlowRef.current;
    if (!element || event.pointerType === "touch") return;
    categoryDragRef.current = { active: true, startX: event.clientX, scrollLeft: element.scrollLeft, moved: false };
    setIsDraggingCategories(true);
    element.setPointerCapture(event.pointerId);
  };
  const handleCategoryPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = categoryFlowRef.current;
    const drag = categoryDragRef.current;
    if (!element || !drag.active) return;
    const distance = event.clientX - drag.startX;
    if (Math.abs(distance) > 4) drag.moved = true;
    element.scrollLeft = drag.scrollLeft - distance;
  };
  const stopCategoryDrag = () => {
    categoryDragRef.current.active = false;
    setIsDraggingCategories(false);
  };

  const updateSort = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "recommended") next.delete("sort");
    else next.set("sort", value);
    router.push(`/products?${next.toString()}`, { scroll: false });
  };
  const clearFilters = () => { setMinPrice(""); setMaxPrice(""); setSelectedBrands([]); setInStockOnly(false); setSelectedTag(""); };

  if (params === "products") {
    return (
      <section className="category-shop" aria-label="Product catalogue">
        <div className="category-shop__inner">
          <nav className="category-shop__breadcrumb" aria-label="Breadcrumb">
            <Link href="/products">Everything</Link><ChevronRight size={13}/><span>{normalizedCategory ? categoryName : "All products"}</span>
          </nav>

          {categoryInfo && (
            <div className="category-shop__hero" style={{ backgroundImage: `linear-gradient(90deg,rgba(7,25,57,.62),rgba(7,25,57,.04)),url("${categoryInfo.image}")` }}>
              <span>Department</span>
            </div>
          )}

          <div className="category-shop__heading">
            <div><h1>{categoryInfo?.title ?? (normalizedQuery ? "Search results" : "Everything you need")}</h1>
              <p>{normalizedQuery ? `Products matching “${query}”` : categoryInfo?.description ?? "Explore practical finds for home, work and everyday life."}</p>
            </div>
            <div className="category-shop__sort">
              <span>{visibleProducts.length} products</span>
              <label className="sr-only" htmlFor="category-sort">Sort products</label>
              <select id="category-sort" value={sort ?? "recommended"} onChange={(event) => updateSort(event.target.value)}>
                <option value="recommended">Recommended</option><option value="newest">Newest</option>
                <option value="asc">Price: low to high</option><option value="desc">Price: high to low</option>
                <option value="rating">Top rated</option>
              </select>
              <ChevronDown size={13} aria-hidden="true"/>
            </div>
          </div>

          <div
            className={`category-shop__subcategories ${isDraggingCategories ? "is-dragging" : ""}`}
            aria-label="Browse departments"
            ref={categoryFlowRef}
            onPointerDown={handleCategoryPointerDown}
            onPointerMove={handleCategoryPointerMove}
            onPointerUp={stopCategoryDrag}
            onPointerCancel={stopCategoryDrag}
            onLostPointerCapture={stopCategoryDrag}
          >
            <Link href="/products" aria-current={!normalizedCategory || normalizedCategory === "all" ? "page" : undefined}>Everything</Link>
            {categories.map((item) => (
              <Link
                href={`/products?category=${item.slug}`}
                key={item.slug}
                aria-current={normalizedCategory === item.slug ? "page" : undefined}
                onClick={(event) => {
                  if (categoryDragRef.current.moved) {
                    event.preventDefault();
                    categoryDragRef.current.moved = false;
                  }
                }}
              >
                {item.name}
              </Link>
            ))}
          </div>

          <div className="category-shop__toolbar">
            <button type="button" className="category-shop__filter-toggle" onClick={() => setFiltersOpen((open) => !open)}><SlidersHorizontal size={15}/> Filters {activeFilterCount > 0 && <span>{activeFilterCount}</span>}</button>
            <span>{visibleProducts.length} {visibleProducts.length === 1 ? "product" : "products"}</span>
            {activeFilterCount > 0 && <button type="button" onClick={clearFilters} className="category-shop__clear">Clear all</button>}
          </div>

          <div className="category-shop__layout">
            <aside className={`category-shop__sidebar ${filtersOpen ? "is-open" : ""}`} aria-label="Product filters">
              <div className="category-shop__sidebar-head"><strong>Filters</strong><button type="button" onClick={clearFilters}>Clear all</button><button type="button" className="category-shop__close-filters" onClick={() => setFiltersOpen(false)} aria-label="Close filters"><X size={17}/></button></div>
              <div className="category-shop__filter-group">
                <h2>Price</h2><div className="category-shop__price-values"><label>₦<input aria-label="Minimum price" inputMode="numeric" value={minPrice} onChange={(e) => setMinPrice(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Min"/></label><span>to</span><label>₦<input aria-label="Maximum price" inputMode="numeric" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value.replace(/[^0-9]/g, ""))} placeholder={String(maxCataloguePrice)}/></label></div>
                <input className="category-shop__range" type="range" min="0" max={maxCataloguePrice} step="500" value={Math.min(Number(maxPrice || maxCataloguePrice), maxCataloguePrice)} onChange={(e) => setMaxPrice(e.target.value)} aria-label="Maximum price range"/>
                <div className="category-shop__quick-prices">
                  <button type="button" onClick={() => { setMinPrice(""); setMaxPrice("20000"); }}>
                    Under ₦20,000
                  </button>
                  <button type="button" onClick={() => { setMinPrice("20000"); setMaxPrice("50000"); }}>
                    ₦20k–₦50k
                  </button>
                  <button type="button" onClick={() => { setMinPrice("50000"); setMaxPrice(""); }}>
                    Over ₦50,000
                  </button>
                </div>
              </div>
              <div className="category-shop__filter-group"><h2>Availability</h2><label className="category-shop__check"><input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)}/> In stock only <small>{categoryFilteredProducts.filter((p) => p.stockStatus !== "out-of-stock").length}</small></label></div>
              <div className="category-shop__filter-group"><h2>Brand</h2>{brands.map((brand) => <label className="category-shop__check" key={brand}><input type="checkbox" checked={selectedBrands.includes(brand)} onChange={(e) => setSelectedBrands((current) => e.target.checked ? [...current, brand] : current.filter((item) => item !== brand))}/>{brand}<small>{categoryFilteredProducts.filter((p) => p.brand === brand).length}</small></label>)}</div>
              <div className="category-shop__filter-group"><h2>Material</h2><p className="category-shop__filter-note">Material filters will appear when product attributes are available.</p></div>
            </aside>

            <div className="category-shop__results">
              {visibleProducts.length > 0 ? (
                <>
                  <div className="category-shop__grid">{displayedProducts.map((product) => <ProductCard key={product.id} product={product} variant="catalogue"/>)}</div>
                  {hasMoreProducts && <div className="category-shop__load-more" ref={loadMoreRef} aria-live="polite">Loading more products…</div>}
                  {!hasMoreProducts && visibleProducts.length > 9 && <p className="category-shop__end-message">You've reached the end of the catalogue.</p>}
                </>
              ) : <div className="category-shop__empty"><h2>No products match these filters</h2><p>Try adjusting your filters or browsing the full catalogue.</p><button type="button" onClick={clearFilters}>Clear filters</button></div>}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="homepage-collection" aria-labelledby="homepage-collection-title">
      <div className="homepage-collection__inner">
        <div className="homepage-collection__intro"><div className="homepage-collection__intro-row"><div><h2 id="homepage-collection-title">Something <span className="homepage-collection__title-accent">useful</span> is waiting for you.</h2><p>From everyday essentials to little upgrades, find things that make life easier.</p></div><span className="homepage-collection__intro-note" aria-hidden="true">GOOD FINDS. EVERYDAY.</span></div></div>
        <div className="homepage-collection__discovery-bar"><div className="homepage-collection__filters" role="group" aria-label="Filter collection products">{HOME_FILTERS.map((filter) => <button key={filter.slug} type="button" className={`homepage-collection__filter ${homeFilter === filter.slug ? "is-active" : ""}`} aria-pressed={homeFilter === filter.slug} onClick={() => setHomeFilter(filter.slug)}>{filter.label}</button>)}</div><span className="homepage-collection__count">{homepageFilteredCount} finds</span></div>
        <div className="homepage-collection__grid">{homepageProducts.length > 0 ? homepageProducts.map((product) => <ProductCard key={product.id} product={product}/>) : <div className="col-span-full rounded-xl border border-[var(--shop-border)] bg-white px-6 py-12 text-center"><h2 className="text-lg font-semibold text-[var(--shop-navy)]">No products found</h2><p className="mt-2 text-sm text-[var(--shop-muted)]">Try another selection.</p></div>}</div>
        {homepageFilteredCount > 0 && <div className="homepage-collection__more"><Link href={homeFilter === "all" ? "/products" : "/products?category=" + homeFilter}>Explore more finds <span aria-hidden="true">→</span></Link></div>}
      </div>
    </section>
  );
};

export default ProductList;
