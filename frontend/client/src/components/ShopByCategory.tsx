"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, BriefcaseBusiness, ChevronDown, ChevronRight, CookingPot, Heart, House, Lightbulb, Luggage, Package, Plus, Search, ShoppingCart, Sprout, Star, Wrench, X } from "lucide-react";
import { toast } from "react-toastify";
import { categories, products } from "@/lib/catalogue";
import useCartStore from "@/stores/cartStore";

type Product = (typeof products)[number];

const categoryDescriptions: Record<string, string> = {
  "home-living": "Storage, bedding and everyday home essentials",
  "garden-outdoor": "Plant care and outdoor living",
  "electrical-lighting": "Lighting and useful electricals",
  "kitchen-dining": "Cookware, tableware and food storage",
  "tools-hardware": "Tools for home fixes and DIY",
  "bags-luggage": "Everyday bags and travel essentials",
  "personal-care": "Grooming and personal-care essentials",
  "office-stationery": "Desk, work and study essentials",
  "home-decor": "Finishing touches for your space",
};

const INITIAL_PRODUCT_LIMIT = 10;
const PRODUCT_BATCH_SIZE = 8;

const formatPrice = (price: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(price);

export default function ShopByCategory() {
  const [activeCategory, setActiveCategory] = useState("all");
  const [visibleProductLimit, setVisibleProductLimit] = useState(INITIAL_PRODUCT_LIMIT);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [isCategoryDirectoryOpen, setIsCategoryDirectoryOpen] = useState(false);
  const [quickViewProduct, setQuickViewProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedSize, setSelectedSize] = useState("");
  const [selectedColor, setSelectedColor] = useState("default");
  const addToCart = useCartStore((state) => state.addToCart);

  const visibleCategories = useMemo(
    () =>
      categories.filter((category) =>
        category.name.toLocaleLowerCase().includes(categoryQuery.trim().toLocaleLowerCase()),
      ),
    [categoryQuery],
  );

  const homepageCategories = categories.slice(0, 7);

  const filteredProducts = useMemo(
    () =>
      activeCategory === "all"
        ? products
        : products.filter((product) => product.categorySlug === activeCategory),
    [activeCategory],
  );

  const visibleProducts = filteredProducts.slice(0, visibleProductLimit);

  const selectCategory = (slug: string) => {
    setActiveCategory(slug);
    setVisibleProductLimit(INITIAL_PRODUCT_LIMIT);
  };

  const activeCategoryName =
    activeCategory === "all"
      ? "All products"
      : categories.find((category) => category.slug === activeCategory)?.name ?? "Products";

  const openQuickView = (product: Product) => {
    setQuickViewProduct(product);
    setQuantity(1);
    setSelectedSize(product.sizes[0] ?? "");
    setSelectedColor(product.colors[0] ?? "default");
  };

  const handleAddToCart = (product: Product, amount = 1, size = product.sizes[0] ?? "", color = product.colors[0] ?? "default") => {
    if (product.stockStatus === "out-of-stock") {
      toast.error("This item is currently out of stock");
      return;
    }

    addToCart({
      ...product,
      quantity: amount,
      selectedSize: size,
      selectedColor: color,
    });
    toast.success("Product added to cart");
    setQuickViewProduct(null);
  };

  return (
    <section className="shop-categories" aria-labelledby="shop-categories-title">
      <div className="shop-categories__heading">
        <div>
          <h2 id="shop-categories-title">Find it. <span className="shop-categories__heading-accent">Click it.</span> Buy it.</h2>
          <p className="shop-categories__intro">
            Choose a department to see products here, without leaving the page.
          </p>
        </div>
        <Link href="/products" className="shop-categories__view-all">
          Full catalogue <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </div>

      <div className="shop-categories__toolbar">
        <div className="shop-categories__category-list" aria-label="Filter products by category">
          <button
            type="button"
            className={`shop-categories__category-chip ${activeCategory === "all" ? "is-active" : ""}`}
            aria-pressed={activeCategory === "all"}
            onClick={() => selectCategory("all")}
          >
            All products
          </button>
          {homepageCategories.map((category) => (
            <button
              key={category.slug}
              type="button"
              className={`shop-categories__category-chip ${activeCategory === category.slug ? "is-active" : ""}`}
              aria-pressed={activeCategory === category.slug}
              onClick={() => selectCategory(category.slug)}
            >
              {category.name}
            </button>
          ))}
          <button
            type="button"
            className="shop-categories__all-categories"
            onClick={() => {
              setCategoryQuery("");
              setIsCategoryDirectoryOpen(true);
            }}
            aria-haspopup="dialog"
            aria-expanded={isCategoryDirectoryOpen}
          >
            All categories <ChevronDown size={15} aria-hidden="true" />
            <span>{categories.length}</span>
          </button>
        </div>
      </div>

      <div className="shop-categories__products-heading">
        <div>
          {activeCategory !== "all" ? <h3>{activeCategoryName}</h3> : null}
          <p>{activeCategory === "all" ? "A selection from across our departments" : categoryDescriptions[activeCategory]}</p>
        </div>
        <span>Showing {visibleProducts.length} of {filteredProducts.length} {filteredProducts.length === 1 ? "item" : "items"}</span>
      </div>

      {visibleProducts.length ? (
        <div className="shop-categories__product-grid">
          {visibleProducts.map((product) => (
            <article className="shop-categories__product-card" key={product.id}>
              <button
                type="button"
                className="shop-categories__product-image"
                onClick={() => openQuickView(product)}
                aria-label={`Quick view ${product.name}`}
              >
                <Image
                  src={product.images.default ?? Object.values(product.images)[0]}
                  alt={product.name}
                  fill
                  unoptimized
                  sizes="(max-width: 640px) 48vw, (max-width: 1024px) 30vw, 240px"
                />
                <span className="shop-categories__image-category">{product.categoryName}</span>
                <span className="shop-categories__quick-view">Quick view</span>
              </button>
              <div className="shop-categories__product-copy">
                <button type="button" className="shop-categories__product-name" onClick={() => openQuickView(product)}>
                  {product.name}
                </button>
                <div className="shop-categories__product-signals" aria-label="Product reviews, sales and availability">
                  {product.reviewSummary && product.reviewSummary.totalReviews > 0 && product.reviewSummary.averageRating !== null ? (
                    <span className="shop-categories__rating">
                      <Star size={12} fill="currentColor" aria-hidden="true" />
                      {product.reviewSummary.averageRating.toFixed(1)}
                      <small>({product.reviewSummary.totalReviews.toLocaleString("en-NG")})</small>
                    </span>
                  ) : (
                    <span className="shop-categories__signal-placeholder">
                      <Star size={12} aria-hidden="true" /> No reviews yet
                    </span>
                  )}
                  {product.soldCount !== undefined && product.soldCount !== null ? (
                    <span>{product.soldCount.toLocaleString("en-NG")} sold</span>
                  ) : (
                    <span className="shop-categories__signal-placeholder">0 sold</span>
                  )}
                  {product.availableQuantity !== undefined && product.availableQuantity !== null ? (
                    product.availableQuantity === 0 || product.stockStatus === "out-of-stock" ? (
                      <span className="shop-categories__stock-warning">Out of stock</span>
                    ) : product.availableQuantity <= 5 ? (
                      <span className="shop-categories__stock-warning">Only {product.availableQuantity} left</span>
                    ) : (
                      <span className="shop-categories__stock-available">{product.availableQuantity} available</span>
                    )
                  ) : product.stockStatus === "out-of-stock" ? (
                    <span className="shop-categories__stock-warning">Out of stock</span>
                  ) : product.stockStatus === "low-stock" ? (
                    <span className="shop-categories__stock-warning">Low stock</span>
                  ) : (
                    <span className="shop-categories__stock-available">In stock</span>
                  )}
                </div>
                <div className="shop-categories__product-price-row">
                  <div className="shop-categories__price-details">
                    <strong>{formatPrice(product.price)}</strong>
                    {product.compareAtPrice && product.compareAtPrice > product.price ? (
                      <>
                        <del>{formatPrice(product.compareAtPrice)}</del>
                        <span className="shop-categories__discount">
                          {Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100)}% off
                        </span>
                      </>
                    ) : product.discountPercent && product.discountPercent > 0 ? (
                      <span className="shop-categories__discount">{product.discountPercent}% off</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="shop-categories__quick-add"
                    onClick={() => handleAddToCart(product)}
                    disabled={product.stockStatus === "out-of-stock"}
                  >
                    <Plus size={15} /> Add
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="shop-categories__empty">
          <p>No demonstration products are assigned to this category yet.</p>
          <Link href="/products">Browse the full catalogue <ChevronRight size={15} /></Link>
        </div>
      )}

      {visibleProducts.length < filteredProducts.length ? (
        <div className="shop-categories__load-more-wrap">
          <p>Showing <strong>{visibleProducts.length}</strong> of <strong>{filteredProducts.length}</strong> products</p>
          <button
            type="button"
            className="shop-categories__load-more"
            onClick={() => setVisibleProductLimit((limit) => limit + PRODUCT_BATCH_SIZE)}
          >
            Show {Math.min(PRODUCT_BATCH_SIZE, filteredProducts.length - visibleProducts.length)} more <ChevronDown size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {isCategoryDirectoryOpen ? (
        <div
          className="shop-categories__modal-backdrop shop-categories__directory-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsCategoryDirectoryOpen(false);
          }}
        >
          <section
            className="shop-categories__directory-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-directory-title"
          >
            <div className="shop-categories__directory-header">
              <div>
                <span className="shop-categories__directory-kicker"><Package size={13} /> CLICKCLICKBUY DEPARTMENTS</span>
                <h3 id="category-directory-title">Find your next favourite.</h3>
                <p>Explore a department and discover useful things worth adding to your basket.</p>
              </div>
              <button
                type="button"
                className="shop-categories__modal-close"
                onClick={() => setIsCategoryDirectoryOpen(false)}
                aria-label="Close categories"
              >
                <X size={20} />
              </button>
            </div>
            <div className="shop-categories__directory-search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={categoryQuery}
                onChange={(event) => setCategoryQuery(event.target.value)}
                placeholder="What are you looking for?"
                aria-label="Search all categories"
                autoFocus
              />
              {categoryQuery ? (
                <button type="button" onClick={() => setCategoryQuery("")} aria-label="Clear search">
                  <X size={15} />
                </button>
              ) : null}
            </div>
            <div className="shop-categories__directory-list">
              <button
                type="button"
                className="shop-categories__directory-featured"
                onClick={() => {
                  selectCategory("all");
                  setIsCategoryDirectoryOpen(false);
                }}
              >
                <span className="shop-categories__directory-featured-icon"><Package size={21} /></span>
                <span className="shop-categories__directory-item-copy">
                  <strong>Shop all products</strong>
                  <small>Browse the complete selection across every department</small>
                </span>
                <ChevronRight size={19} />
              </button>
              <div className="shop-categories__directory-grid">
                {visibleCategories.map((category) => {
                  const count = products.filter((product) => product.categorySlug === category.slug).length;
                  const CategoryIcon = ({
                    "home-living": House,
                    "garden-outdoor": Sprout,
                    "electrical-lighting": Lightbulb,
                    "kitchen-dining": CookingPot,
                    "tools-hardware": Wrench,
                    "bags-luggage": Luggage,
                    "personal-care": Heart,
                    "office-stationery": BriefcaseBusiness,
                    "home-decor": House,
                  } as Record<string, typeof House>)[category.slug] ?? Package;
                  return (
                    <button
                      key={category.slug}
                      type="button"
                      className="shop-categories__directory-card"
                      onClick={() => {
                        selectCategory(category.slug);
                        setIsCategoryDirectoryOpen(false);
                      }}
                    >
                      <span className="shop-categories__directory-card-icon"><CategoryIcon size={21} /></span>
                      <span className="shop-categories__directory-item-copy">
                        <strong>{category.name}</strong>
                        <small>{categoryDescriptions[category.slug] ?? "Explore this department"}</small>
                        <em>{count} demo {count === 1 ? "item" : "items"}</em>
                      </span>
                      <ArrowUpRight size={16} className="shop-categories__directory-card-arrow" />
                    </button>
                  );
                })}
              </div>
              {visibleCategories.length === 0 ? (
                <p className="shop-categories__directory-empty">No departments match that search. Try another word.</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {quickViewProduct ? (
        <div
          className="shop-categories__modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setQuickViewProduct(null);
          }}
        >
          <section
            className="shop-categories__quick-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-view-title"
          >
            <button
              type="button"
              className="shop-categories__modal-close"
              onClick={() => setQuickViewProduct(null)}
              aria-label="Close quick view"
            >
              <X size={20} />
            </button>
            <div className="shop-categories__modal-image">
              <Image
                src={quickViewProduct.images[selectedColor] ?? quickViewProduct.images.default ?? Object.values(quickViewProduct.images)[0]}
                alt={quickViewProduct.name}
                fill
                unoptimized
                sizes="(max-width: 700px) 100vw, 420px"
              />
            </div>
            <div className="shop-categories__modal-content">
              <span className="shop-categories__product-category">{quickViewProduct.categoryName}</span>
              <h3 id="quick-view-title">{quickViewProduct.name}</h3>
              <strong className="shop-categories__modal-price">{formatPrice(quickViewProduct.price)}</strong>
              <p>{quickViewProduct.description}</p>

              {quickViewProduct.colors.length > 0 ? (
                <label className="shop-categories__option">
                  Colour
                  <select value={selectedColor} onChange={(event) => setSelectedColor(event.target.value)}>
                    {quickViewProduct.colors.map((color) => <option key={color} value={color}>{color}</option>)}
                  </select>
                </label>
              ) : null}

              {quickViewProduct.sizes.length > 0 ? (
                <label className="shop-categories__option">
                  Size
                  <select value={selectedSize} onChange={(event) => setSelectedSize(event.target.value)}>
                    {quickViewProduct.sizes.map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
              ) : null}

              <div className="shop-categories__modal-actions">
                <div className="shop-categories__quantity" aria-label="Quantity">
                  <button type="button" onClick={() => setQuantity((value) => Math.max(1, value - 1))} aria-label="Decrease quantity">−</button>
                  <span>{quantity}</span>
                  <button type="button" onClick={() => setQuantity((value) => value + 1)} aria-label="Increase quantity">+</button>
                </div>
                <button
                  type="button"
                  className="shop-categories__modal-add"
                  disabled={quickViewProduct.stockStatus === "out-of-stock"}
                  onClick={() => handleAddToCart(quickViewProduct, quantity, selectedSize, selectedColor)}
                >
                  <ShoppingCart size={17} />
                  {quickViewProduct.stockStatus === "out-of-stock" ? "Out of stock" : "Add to Cart"}
                </button>
              </div>
              <Link href={`/products/${quickViewProduct.id}`} className="shop-categories__details-link">
                View full product details <ArrowUpRight size={15} />
              </Link>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
