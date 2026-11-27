"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ChevronDown,
  Footprints,
  Glasses,
  Briefcase,
  Shirt,
  ShoppingBasket,
  Hand,
  Venus,
  CircleHelp,
  CreditCard,
  Headphones,
  Heart,
  MessageCircle,
  Package,
  ShoppingCart,
  UserRound,
  Wallet,
  XCircle,
} from "lucide-react";
import SearchBar from "./SearchBar";
import ShoppingCartIcon from "./ShoppingCartIcon";
import AnnouncementBar from "./AnnouncementBar";
import { products as demoProducts } from "@/lib/catalogue";
import { apiRequest, getAccessToken } from "@/lib/api/client";

const navigation = [
  { label: "Shop", href: "/products" },
  { label: "New Arrivals", href: "/products?sort=newest" },
];

const shopCategories = [
  { name: "All", slug: "all", icon: ShoppingBasket, image: "https://images.unsplash.com/photo-1593085260707-5377ba37f868?w=160&auto=format&fit=crop&q=80", items: ["Browse the full catalogue", "Explore every department", "Find something useful for everyday life"], products: [{ name: "Woven Storage Basket Set", image: "https://images.unsplash.com/photo-1593085260707-5377ba37f868?w=320&auto=format&fit=crop&q=80" }, { name: "Compact Watering Can", image: "https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=320&auto=format&fit=crop&q=80" }, { name: "Ceramic Dinnerware Set", image: "https://images.unsplash.com/photo-1603199506016-b9a594b593c0?w=320&auto=format&fit=crop&q=80" }] },
  { name: "Home & Living", slug: "home-living", icon: Shirt, image: "https://images.unsplash.com/photo-1593085260707-5377ba37f868?w=160&auto=format&fit=crop&q=80", items: ["Storage & organisation", "Bedding & soft furnishings", "Everyday home essentials"], products: [{ name: "Woven Storage Basket Set", image: "https://images.unsplash.com/photo-1593085260707-5377ba37f868?w=320&auto=format&fit=crop&q=80" }, { name: "Soft Textured Throw Blanket", image: "https://images.unsplash.com/photo-1600369671236-e74521d4b6ad?w=320&auto=format&fit=crop&q=80" }] },
  { name: "Garden & Outdoor", slug: "garden-outdoor", icon: Footprints, image: "https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=160&auto=format&fit=crop&q=80", items: ["Plant care & gardening", "Outdoor seating", "Patio & balcony essentials"], products: [{ name: "Compact Watering Can", image: "https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=320&auto=format&fit=crop&q=80" }, { name: "Foldable Outdoor Chair", image: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=320&auto=format&fit=crop&q=80" }] },
  { name: "Electrical & Lighting", slug: "electrical-lighting", icon: Glasses, image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=160&auto=format&fit=crop&q=80", items: ["Desk & task lighting", "Ambient home lighting", "Everyday electrical essentials"], products: [{ name: "Rechargeable LED Desk Lamp", image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=320&auto=format&fit=crop&q=80" }, { name: "Warm Glow Table Light", image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=320&auto=format&fit=crop&q=80" }] },
  { name: "Kitchen & Dining", slug: "kitchen-dining", icon: Briefcase, image: "https://images.unsplash.com/photo-1603199506016-b9a594b593c0?w=160&auto=format&fit=crop&q=80", items: ["Cookware & tableware", "Food storage", "Everyday dining essentials"], products: [{ name: "Ceramic Dinnerware Set", image: "https://images.unsplash.com/photo-1603199506016-b9a594b593c0?w=320&auto=format&fit=crop&q=80" }, { name: "Glass Food Storage Containers", image: "https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=320&auto=format&fit=crop&q=80" }] },
  { name: "Tools & Hardware", slug: "tools-hardware", icon: Venus, image: "https://images.unsplash.com/photo-1581147036324-c1c89c2c8b5c?w=160&auto=format&fit=crop&q=80", items: ["Home repair tool kits", "Hand tools & accessories", "DIY and maintenance essentials"], products: [{ name: "Home Repair Tool Kit", image: "https://images.unsplash.com/photo-1581147036324-c1c89c2c8b5c?w=320&auto=format&fit=crop&q=80" }, { name: "Precision Screwdriver Set", image: "https://images.unsplash.com/photo-1504148455328-c376907d081c?w=320&auto=format&fit=crop&q=80" }] },
  { name: "Bags & Luggage", slug: "bags-luggage", icon: Shirt, image: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=160&auto=format&fit=crop&q=80", items: ["Backpacks & everyday bags", "Travel duffel bags", "Bags for work and study"], products: [{ name: "Everyday Canvas Backpack", image: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=320&auto=format&fit=crop&q=80" }, { name: "Weekend Travel Duffel", image: "https://images.unsplash.com/photo-1622560480654-d96214fdc887?w=320&auto=format&fit=crop&q=80" }] },
  { name: "Personal Care", slug: "personal-care", icon: Hand, image: "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=160&auto=format&fit=crop&q=80", items: ["Grooming essentials", "Bathroom organisation", "Everyday personal-care items"], products: [{ name: "Daily Grooming Kit", image: "https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?w=320&auto=format&fit=crop&q=80" }, { name: "Bathroom Organiser Set", image: "https://images.unsplash.com/photo-1620626011761-996317b8d101?w=320&auto=format&fit=crop&q=80" }] },
  { name: "Office & Stationery", slug: "office-stationery", icon: Footprints, image: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=160&auto=format&fit=crop&q=80", items: ["Desk organisation", "Notebooks & planning", "Work and study essentials"], products: [{ name: "Minimal Desk Organiser", image: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=320&auto=format&fit=crop&q=80" }, { name: "Hardcover Notebook Set", image: "https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=320&auto=format&fit=crop&q=80" }] },
  { name: "Home Décor", slug: "home-decor", icon: ShoppingBasket, image: "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?w=160&auto=format&fit=crop&q=80", items: ["Decorative accents", "Vases & ornaments", "Cushions and soft décor"], products: [{ name: "Modern Ceramic Vase", image: "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?w=320&auto=format&fit=crop&q=80" }, { name: "Decorative Cushion Cover Set", image: "https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=320&auto=format&fit=crop&q=80" }] },
];

type CatalogPreviewProduct = {
  id: string;
  name: string;
  slug: string;
  images: Array<{ url: string; isPrimary: boolean; sortOrder: number }>;
  reviewSummary: { averageRating: number | null; totalReviews: number };
};

type CatalogPreviewResponse = { items: CatalogPreviewProduct[] };
type CustomerOrderCountResponse = { pagination?: { total?: number } };
type WishlistCountResponse = { wishlist?: { itemCount?: number } };

function CountBadge({ count }: { count: number }) {
  if (count < 1) return null;
  return <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--shop-orange)] px-1.5 text-[10px] font-bold leading-none text-white">{count > 99 ? "99+" : count}</span>;
}

const placeholderClass =
  "flex w-full cursor-not-allowed items-center gap-3 px-4 py-3 text-left text-sm text-[var(--shop-muted)]";
const activeClass =
  "flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--shop-body)] transition-colors hover:bg-[var(--shop-peach-tint)] hover:text-[var(--shop-orange-dark)]";

function ComingSoon({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto shrink-0 rounded-full bg-[var(--shop-search)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--shop-muted)]">
      {children}
    </span>
  );
}

const Navbar = () => {
  const [activeMenu, setActiveMenu] = useState<"account" | "help" | "categories" | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const updateScrollState = () => setIsScrolled(window.scrollY > 24);
    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollState);
  }, []);

  const headerContentRef = useRef<HTMLDivElement>(null);
  const categoryTriggerRef = useRef<HTMLButtonElement>(null);
  const categoryPanelRef = useRef<HTMLDivElement>(null);
  const categoryPointerTypeRef = useRef<"mouse" | "touch" | "pen" | null>(null);
  const accountPointerTypeRef = useRef<"mouse" | "touch" | "pen" | null>(null);
  const helpPointerTypeRef = useRef<"mouse" | "touch" | "pen" | null>(null);
    const [activeCategorySlug, setActiveCategorySlug] = useState("home-living");
  const activeCategory = shopCategories.find((category) => category.slug === activeCategorySlug) ?? shopCategories[1];
  const [catalogProducts, setCatalogProducts] = useState<CatalogPreviewProduct[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [accountCounts, setAccountCounts] = useState({ orders: 0, wishlist: 0 });

  useEffect(() => {
    if (!activeMenu) return;

    const closeMenuOnOutsideInteraction = (event: PointerEvent) => {
      if (!headerContentRef.current?.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    };

    document.addEventListener("pointerdown", closeMenuOnOutsideInteraction);
    return () => document.removeEventListener("pointerdown", closeMenuOnOutsideInteraction);
  }, [activeMenu]);

  useEffect(() => {
    if (activeMenu !== "account") return;
    const token = getAccessToken();
    if (!token) {
      setAccountCounts({ orders: 0, wishlist: 0 });
      return;
    }

    let cancelled = false;
    Promise.allSettled([
      apiRequest<CustomerOrderCountResponse>("/orders?page=1&limit=1", { authenticated: true }),
      apiRequest<WishlistCountResponse>("/wishlist", { authenticated: true }),
    ]).then(([ordersResult, wishlistResult]) => {
      if (cancelled) return;
      setAccountCounts({
        orders: ordersResult.status === "fulfilled" ? ordersResult.value.pagination?.total ?? 0 : 0,
        wishlist: wishlistResult.status === "fulfilled" ? wishlistResult.value.wishlist?.itemCount ?? 0 : 0,
      });
    });

    return () => { cancelled = true; };
  }, [activeMenu]);

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    const categoryQuery = activeCategorySlug === "all" ? "" : `?category=${encodeURIComponent(activeCategorySlug)}&limit=48`;

    apiRequest<CatalogPreviewResponse>(`/products${categoryQuery}`)
      .then((response) => {
        if (!cancelled) setCatalogProducts(response.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setCatalogProducts([]);
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeCategorySlug]);

  const ratedProducts = catalogProducts
    .filter((product) => product.reviewSummary.totalReviews > 0 && product.reviewSummary.averageRating !== null)
    .sort((a, b) => (b.reviewSummary.averageRating ?? 0) - (a.reviewSummary.averageRating ?? 0) || b.reviewSummary.totalReviews - a.reviewSummary.totalReviews);
  const topRatedProduct = ratedProducts[0] ?? null;
  const previewProducts = catalogProducts.length > 0
    ? catalogProducts
    : activeCategory.products.flatMap((product, index) => {
        const demoProduct = demoProducts.find((item) => item.name === product.name);
        if (!demoProduct) return [];
        return [{
          id: String(demoProduct.id),
          name: demoProduct.name,
          slug: String(demoProduct.id),
          images: [{ url: product.image, isPrimary: true, sortOrder: index }],
          reviewSummary: {
            averageRating: demoProduct.reviewSummary?.averageRating ?? null,
            totalReviews: demoProduct.reviewSummary?.totalReviews ?? 0,
          },
        }];
      });

  return (
    <>
      <AnnouncementBar />
      <div className={`sticky top-0 z-40 border-b border-[var(--shop-border)] bg-white transition-shadow duration-200 ${isScrolled ? "shadow-md" : ""}`}>
        <div ref={headerContentRef} onPointerLeave={(event) => { if (event.pointerType === "mouse") setActiveMenu((current) => current === "categories" ? null : current); }} className={`mx-auto flex header-inner flex-wrap items-center justify-between gap-x-3 gap-y-3 transition-[padding] duration-200 ease-out ${isScrolled ? "py-2 sm:py-2.5" : "py-3 sm:py-4"} sm:gap-x-4`}>
          <div className="order-1 flex w-full min-w-0 items-center gap-3 lg:w-auto lg:flex-none">
          <Link href="/" aria-label="ClickClickBuy home" className="flex shrink-0 items-center gap-2">
            <Image
              src="/logo.png"
              alt=""
              width={36}
              height={36}
              priority
              className={`object-contain transition-all duration-200 ${isScrolled ? "h-7 w-7 sm:h-8 sm:w-8" : "h-8 w-8 sm:h-9 sm:w-9"}`}
            />
            <span className={`font-bold tracking-[-0.8px] text-[var(--shop-navy)] transition-all duration-200 ${isScrolled ? "text-[19px] sm:text-[22px]" : "text-[21px] sm:text-[24px]"}`}>
              ClickClick<span className="text-[var(--shop-orange)]">Buy</span>
            </span>
          </Link>
          <div className="ml-auto min-w-0 flex-1 max-w-[30rem] lg:hidden"><SearchBar /></div>
          </div>

          <nav aria-label="Main navigation" className="order-3 hidden items-center gap-5 text-[16px] font-semibold text-[var(--shop-navy)] lg:order-2 lg:flex xl:gap-7">
            {navigation.map((item) => (
              <Link key={item.label} href={item.href} className="whitespace-nowrap transition-colors hover:text-[var(--shop-orange)]">
                {item.label}
              </Link>
            ))}
            <div className="relative z-20" onMouseEnter={() => setActiveMenu("categories")} onMouseLeave={() => setActiveMenu((current) => current === "categories" ? null : current)}>
              <button type="button" aria-expanded={activeMenu === "categories"} onClick={() => setActiveMenu(activeMenu === "categories" ? null : "categories")} className="flex items-center gap-1 whitespace-nowrap transition-colors hover:text-[var(--shop-orange)]">
                Categories
                <ChevronDown size={16} className={`transition-transform duration-200 ${activeMenu === "categories" ? "rotate-180" : ""}`} />
              </button>
              <div aria-hidden={activeMenu !== "categories"} className={`absolute left-1/2 top-[calc(100%+24px)] z-50 mt-0 before:absolute before:-top-6 before:left-0 before:h-6 before:w-full before:content-[''] w-[min(860px,calc(100vw-32px))] -translate-x-1/2 origin-top opacity-0 invisible pointer-events-none -translate-y-2 scale-[0.98] rounded-xl border border-[var(--shop-border)] bg-white shadow-2xl transition-all duration-200 ease-out ${activeMenu === "categories" ? "!visible !pointer-events-auto !translate-y-0 !scale-100 !opacity-100" : ""}`}>
                <div className="grid h-[440px] max-h-[min(440px,calc(100vh-120px))] grid-cols-[230px_minmax(0,1fr)] overflow-hidden rounded-xl">
                  <aside className="flex h-full min-h-0 flex-col overflow-hidden border-r border-[var(--shop-border)] bg-[var(--shop-peach-tint)] p-2">
                    <p className="shrink-0 px-3 py-2 text-xs font-bold uppercase tracking-wider text-[var(--shop-orange-dark)]">Browse categories</p>
                    <div className="h-[360px] max-h-[360px] shrink-0 overflow-y-auto overscroll-y-contain [scrollbar-color:var(--shop-orange)_var(--shop-peach)] [scrollbar-width:thin]">
                    {shopCategories.map((category) => {
                      const Icon = category.icon;
                      return (
                        <button key={category.slug} type="button" onMouseEnter={() => setActiveCategorySlug(category.slug)} onFocus={() => setActiveCategorySlug(category.slug)} onClick={() => setActiveCategorySlug(category.slug)} aria-pressed={activeCategorySlug === category.slug} className={`group flex w-full items-center justify-between gap-2 rounded-lg px-3 py-3 text-left text-sm font-semibold leading-snug transition-colors ${activeCategorySlug === category.slug ? "bg-white text-[var(--shop-orange-dark)] shadow-sm ring-1 ring-[var(--shop-peach)]" : "text-[var(--shop-navy)] hover:bg-white hover:text-[var(--shop-orange)]"}`}>
                          <span className="flex items-center gap-2"><Icon size={17} />{category.name}</span>
                          <ChevronDown size={14} className="-rotate-90 text-[var(--shop-muted)]" />
                        </button>
                      );
                    })}
                    </div>
                  </aside>
                  <div className="min-h-0 overflow-y-hidden overscroll-contain p-5 pb-8">
                    <div className="mb-4 flex items-center justify-between border-b border-[var(--shop-peach)] pb-3">
                      <div>
                        <h3 className="text-lg font-bold text-[var(--shop-navy)]">{activeCategory.name}</h3>
                        <p className="mt-1 text-xs text-[var(--shop-muted)]">{activeCategory.items.join(" · ")}</p>
                      </div>
                      <Link href={`/products?category=${activeCategory.slug}`} onClick={() => setActiveMenu(null)} className="shrink-0 text-sm font-semibold text-[var(--shop-orange)] hover:underline">View all</Link>
                    </div>
                    <div key={activeCategory.slug} className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-4 [scrollbar-color:var(--shop-orange)_var(--shop-peach-tint)] [scrollbar-width:thin]" aria-busy={catalogLoading}>
                      {previewProducts.map((product) => {
                        const imageUrl = product.images.find((image) => image.isPrimary)?.url ?? product.images[0]?.url;
                        return (
                          <Link key={product.id} href={`/products/${product.id}`} onClick={() => setActiveMenu(null)} className="group flex w-[118px] shrink-0 snap-start flex-col items-center rounded-xl p-2 text-center transition-all duration-300 hover:-translate-y-1 hover:bg-[var(--shop-peach-tint)] sm:w-[132px]">
                            <span className="mb-2 flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-[var(--shop-peach-tint)] ring-1 ring-[var(--shop-peach)] transition-all duration-300 group-hover:scale-105 group-hover:ring-2 group-hover:ring-[var(--shop-orange)]">
                              {imageUrl ? <Image src={imageUrl} alt={product.name} width={80} height={80} unoptimized className="h-full w-full object-contain mix-blend-multiply transition-transform duration-300 group-hover:scale-110" /> : <Package size={28} className="text-[var(--shop-muted)]" />}
                            </span>
                            <span className="line-clamp-2 text-xs font-semibold leading-5 text-[var(--shop-navy)] group-hover:text-[var(--shop-orange-dark)]">{product.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                    <div className="mt-2 border-t border-[var(--shop-peach)] pt-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-bold text-[var(--shop-navy)]">Top rated in {activeCategory.name}</h4>
                          <p className="mt-0.5 text-xs text-[var(--shop-muted)]">Customer favourites in this category</p>
                        </div>
                        {topRatedProduct && <span className="rounded-full bg-[var(--shop-orange)] px-2.5 py-1 text-xs font-bold text-white">★ {topRatedProduct.reviewSummary.averageRating?.toFixed(1)} / 5</span>}
                      </div>
                      {topRatedProduct ? (
                        <Link href={`/products/${topRatedProduct.slug}`} className="group flex max-w-md items-center gap-3 rounded-xl bg-[var(--shop-peach-tint)] p-3 transition-colors hover:bg-[var(--shop-peach)]">
                          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
                            {(() => {
                              const imageUrl = topRatedProduct.images.find((image) => image.isPrimary)?.url ?? topRatedProduct.images[0]?.url;
                              return imageUrl ? <Image src={imageUrl} alt={topRatedProduct.name} width={64} height={64} unoptimized className="h-full w-full object-contain" /> : <Package size={24} />;
                            })()}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-[var(--shop-navy)] group-hover:text-[var(--shop-orange-dark)]">{topRatedProduct.name}</span>
                            <span className="mt-1 block text-xs text-[var(--shop-muted)]">{topRatedProduct.reviewSummary.totalReviews} approved {topRatedProduct.reviewSummary.totalReviews === 1 ? "review" : "reviews"}</span>
                          </span>
                          <span className="text-sm font-bold text-[var(--shop-orange-dark)]">★ {topRatedProduct.reviewSummary.averageRating?.toFixed(1)}</span>
                        </Link>
                      ) : (
                        <Link href={`/products?category=${activeCategory.slug}`} className="group flex max-w-md items-center gap-3 rounded-xl bg-[var(--shop-peach-tint)] p-3 transition-colors hover:bg-[var(--shop-peach)]">
                          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
                            <Image src={activeCategory.products[0]?.image ?? activeCategory.image} alt={activeCategory.products[0]?.name ?? activeCategory.name} width={64} height={64} className="h-full w-full object-contain" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-[var(--shop-navy)] group-hover:text-[var(--shop-orange-dark)]">{activeCategory.products[0]?.name ?? `${activeCategory.name} featured pick`}</span>
                            <span className="mt-1 block text-xs text-[var(--shop-muted)]">A featured pick while approved customer ratings become available.</span>
                          </span>
                          <span className="ml-auto shrink-0 rounded-full border border-[var(--shop-orange)] px-2 py-1 text-[10px] font-bold text-[var(--shop-orange-dark)]">FEATURED</span>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {navigation.slice(2).map((item) => (
              <Link key={item.label} href={item.href} className="whitespace-nowrap transition-colors hover:text-[var(--shop-orange)]">
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="relative order-2 flex w-full min-w-0 items-center justify-end gap-1 lg:w-auto lg:shrink-0 lg:gap-2 lg:order-3">
            <button ref={categoryTriggerRef} type="button" aria-label="Browse categories" aria-expanded={activeMenu === "categories"} onPointerDown={(event) => { categoryPointerTypeRef.current = event.pointerType; }} onPointerEnter={(event) => { if (event.pointerType === "mouse") setActiveMenu("categories"); }} onClick={() => { if (categoryPointerTypeRef.current === "mouse") setActiveMenu("categories"); else setActiveMenu((current) => current === "categories" ? null : "categories"); }} className={`mr-auto flex h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-[var(--shop-navy)] transition-colors hover:bg-[var(--shop-peach-tint)] hover:text-[var(--shop-orange)] focus-visible:bg-[var(--shop-peach-tint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--shop-orange)] active:bg-[var(--shop-peach)] lg:hidden ${activeMenu === "categories" ? "bg-[var(--shop-peach-tint)] text-[var(--shop-orange)]" : ""}`}>
              Categories <ChevronDown size={15} className={`transition-transform duration-200 ${activeMenu === "categories" ? "rotate-180" : ""}`} />
            </button>
            <div className="hidden lg:block"><SearchBar /></div>

            <div
              className="relative z-10"
              onPointerEnter={(event) => { if (event.pointerType === "mouse") setActiveMenu("account"); }}
              onPointerLeave={(event) => { if (event.pointerType === "mouse") setActiveMenu((current) => current === "account" ? null : current); }}
            >
              <button
                type="button"
                aria-label="Account menu"
                aria-expanded={activeMenu === "account"}
                onPointerDown={(event) => { accountPointerTypeRef.current = event.pointerType; }}
                onClick={() => {
                  if (accountPointerTypeRef.current === "mouse") setActiveMenu("account");
                  else setActiveMenu((current) => current === "account" ? null : "account");
                  accountPointerTypeRef.current = null;
                }}
                className={`flex h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-[var(--shop-navy)] transition-colors hover:bg-[var(--shop-blue-light)] active:bg-[var(--shop-blue-light)] focus-visible:bg-[var(--shop-blue-light)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--shop-orange)] sm:px-3 ${activeMenu === "account" ? "bg-[var(--shop-blue-light)]" : ""}`}
              >
                <UserRound size={22} strokeWidth={1.9} />
                <span className="hidden text-sm font-semibold sm:inline">Account</span>
                <ChevronDown size={16} className={`hidden transition-transform duration-200 sm:block ${activeMenu === "account" ? "rotate-180" : ""}`} />
              </button>
              <div aria-hidden={activeMenu !== "account"} className={`absolute left-auto right-0 top-[calc(100%+16px)] z-50 mt-0 before:absolute before:-top-4 before:left-0 before:h-4 before:w-full before:content-[''] w-[min(19rem,calc(100vw-2rem))] origin-top-right rounded-xl border border-[var(--shop-border)] bg-white shadow-xl transition-all duration-200 ease-out ${activeMenu === "account" ? "visible translate-y-0 scale-100 opacity-100" : "invisible -translate-y-2 scale-[0.98] opacity-0 pointer-events-none"}`}>
                <div className="border-b border-[var(--shop-peach)] bg-[var(--shop-peach-tint)] p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--shop-navy)]">
                    <UserRound size={18} className="text-[var(--shop-orange)]" />
                    Welcome to ClickClickBuy
                  </div>
                  <div className="flex items-center justify-center rounded-lg bg-[var(--shop-orange)] px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[var(--shop-orange-dark)]">
                    Sign In <ComingSoon>Coming soon</ComingSoon>
                  </div>
                </div>
                <div className="py-1">
                  <Link href="/account" onClick={() => setActiveMenu(null)} className={activeClass}>
                    <UserRound size={19} /> My Account
                  </Link>
                  <Link href="/account?section=orders" onClick={() => setActiveMenu(null)} className={activeClass}>
                    <Package size={19} /> Orders <CountBadge count={accountCounts.orders} />
                  </Link>
                  <div className={placeholderClass}>
                    <Heart size={19} /> Wishlist <CountBadge count={accountCounts.wishlist} /> <ComingSoon>Coming soon</ComingSoon>
                  </div>
                </div>
              </div>
            </div>

            <div
              className="relative z-10"
              onPointerEnter={(event) => { if (event.pointerType === "mouse") setActiveMenu("help"); }}
              onPointerLeave={(event) => { if (event.pointerType === "mouse") setActiveMenu((current) => current === "help" ? null : current); }}
            >
              <button
                type="button"
                aria-label="Help menu"
                aria-expanded={activeMenu === "help"}
                onPointerDown={(event) => { helpPointerTypeRef.current = event.pointerType; }}
                onClick={() => {
                  if (helpPointerTypeRef.current === "mouse") setActiveMenu("help");
                  else setActiveMenu((current) => current === "help" ? null : "help");
                  helpPointerTypeRef.current = null;
                }}
                className={`flex h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-[var(--shop-navy)] transition-colors hover:bg-[var(--shop-blue-light)] active:bg-[var(--shop-blue-light)] focus-visible:bg-[var(--shop-blue-light)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--shop-orange)] sm:px-3 ${activeMenu === "help" ? "bg-[var(--shop-blue-light)]" : ""}`}
              >
                <CircleHelp size={22} strokeWidth={1.9} />
                <span className="hidden text-sm font-semibold sm:inline">Help</span>
                <ChevronDown size={16} className={`hidden transition-transform duration-200 sm:block ${activeMenu === "help" ? "rotate-180" : ""}`} />
              </button>
              <div aria-hidden={activeMenu !== "help"} className={`absolute left-auto right-0 top-[calc(100%+16px)] z-50 mt-0 before:absolute before:-top-4 before:left-0 before:h-4 before:w-full before:content-[''] w-[min(20rem,calc(100vw-2rem))] origin-top-right rounded-xl border border-[var(--shop-border)] bg-white shadow-xl transition-all duration-200 ease-out ${activeMenu === "help" ? "visible translate-y-0 scale-100 opacity-100" : "invisible -translate-y-2 scale-[0.98] opacity-0 pointer-events-none"}`}>
                <div className="py-1">
                  <Link href="/help" className={activeClass}>
                    <CircleHelp size={19} /> Help Centre
                  </Link>
                  <div className={placeholderClass}>
                    <ShoppingCart size={19} /> Place an order <ComingSoon>Coming soon</ComingSoon>
                  </div>
                  <div className={placeholderClass}>
                    <Wallet size={19} /> Payment options <ComingSoon>Coming soon</ComingSoon>
                  </div>
                  <Link href="/track-order" className={activeClass}>
                    <Package size={19} /> Track an order
                  </Link>
                  <div className={placeholderClass}>
                    <XCircle size={19} /> Cancel an order <ComingSoon>Coming soon</ComingSoon>
                  </div>
                  <div className={placeholderClass}>
                    <CreditCard size={19} /> Returns &amp; Refunds <ComingSoon>Coming soon</ComingSoon>
                  </div>
                  <div className={placeholderClass}>
                    <UserRound size={19} /> Cookie Preferences <ComingSoon>Coming soon</ComingSoon>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 border-t border-[var(--shop-border)] p-3">
                  <div className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[var(--shop-orange)] px-2 text-center text-xs font-bold text-white">
                    <MessageCircle size={18} /> Live Chat
                    <span className="text-[9px] font-medium">Soon</span>
                  </div>
                  <div className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[var(--shop-success)] bg-white px-2 text-center text-xs font-bold text-[var(--shop-success)]">
                    <Headphones size={18} /> WhatsApp
                    <span className="text-[9px] font-medium">Soon</span>
                  </div>
                </div>
              </div>
            </div>

            <ShoppingCartIcon />
          </div>

          <div ref={categoryPanelRef} onPointerEnter={(event) => { if (event.pointerType === "mouse") setActiveMenu("categories"); }} className={`order-3 w-full lg:hidden ${activeMenu === "categories" ? "block" : "hidden"}`}>
            <div className="grid grid-cols-2 gap-2 border-t border-[var(--shop-border)] py-3 sm:grid-cols-4">
              {shopCategories.map((category) => (
                <Link key={category.slug} href={`/products?category=${category.slug}`} onClick={() => setActiveMenu(null)} className="flex items-center gap-2 rounded-lg bg-[var(--shop-search)] p-2 text-sm font-medium text-[var(--shop-navy)] transition-colors duration-200 hover:bg-[var(--shop-peach)] hover:text-[var(--shop-orange-dark)] focus-visible:bg-[var(--shop-peach)] focus-visible:text-[var(--shop-orange-dark)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--shop-orange)] active:bg-[var(--shop-peach)]">
                  <Image src={category.image} alt="" width={40} height={40} className="h-10 w-10 rounded-full object-contain" />
                  {category.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Navbar;
