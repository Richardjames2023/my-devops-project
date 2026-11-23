"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, Plus, Search, ShoppingCart, X } from "lucide-react";
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

const formatPrice = (price: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(price);

export default function ShopByCategory() {
  const [activeCategory, setActiveCategory] = useState("all");
  const [categoryQuery, setCategoryQuery] = useState("");
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

  const visibleProducts = useMemo(
    () =>
      activeCategory === "all"
        ? products.slice(0, 8)
        : products.filter((product) => product.categorySlug === activeCategory),
    [activeCategory],
  );

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
          <p className="shop-categories__eyebrow">SHOP WHAT YOU NEED</p>
          <h2 id="shop-categories-title">Find it. View it. Add it.</h2>
          <p className="shop-categories__intro">
            Choose a department to see products here, without leaving the page.
          </p>
        </div>
        <Link href="/products" className="shop-categories__view-all">
          Full catalogue <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </div>

      <div className="shop-categories__toolbar">
        <div className="shop-categories__category-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={categoryQuery}
            onChange={(event) => setCategoryQuery(event.target.value)}
            placeholder="Find a category"
            aria-label="Search categories"
          />
          {categoryQuery ? (
            <button type="button" onClick={() => setCategoryQuery("")} aria-label="Clear category search">
              <X size={15} />
            </button>
          ) : null}
        </div>
        <div className="shop-categories__category-list" aria-label="Filter products by category">
          <button
            type="button"
            className={`shop-categories__category-chip ${activeCategory === "all" ? "is-active" : ""}`}
            aria-pressed={activeCategory === "all"}
            onClick={() => setActiveCategory("all")}
          >
            All products
          </button>
          {visibleCategories.map((category) => (
            <button
              key={category.slug}
              type="button"
              className={`shop-categories__category-chip ${activeCategory === category.slug ? "is-active" : ""}`}
              aria-pressed={activeCategory === category.slug}
              onClick={() => setActiveCategory(category.slug)}
            >
              {category.name}
            </button>
          ))}
          {visibleCategories.length === 0 ? (
            <span className="shop-categories__no-categories">No matching categories</span>
          ) : null}
        </div>
      </div>

      <div className="shop-categories__products-heading">
        <div>
          <h3>{activeCategoryName}</h3>
          <p>{activeCategory === "all" ? "A selection from across our departments" : categoryDescriptions[activeCategory]}</p>
        </div>
        <span>{visibleProducts.length} {visibleProducts.length === 1 ? "item" : "items"}</span>
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
                <span className="shop-categories__quick-view">Quick view</span>
              </button>
              <div className="shop-categories__product-copy">
                <span className="shop-categories__product-category">{product.categoryName}</span>
                <button type="button" className="shop-categories__product-name" onClick={() => openQuickView(product)}>
                  {product.name}
                </button>
                <div className="shop-categories__product-bottom">
                  <strong>{formatPrice(product.price)}</strong>
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
