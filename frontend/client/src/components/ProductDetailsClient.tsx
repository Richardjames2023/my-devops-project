"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Heart, Minus, Plus, ShoppingCart, ShieldCheck, Truck, RotateCcw, PackageCheck, ImageIcon, CheckCircle2 } from "lucide-react";
import { toast } from "react-toastify";
import type { ProductType } from "@/types";
import useCartStore from "@/stores/cartStore";
import ProductCard from "@/components/ProductCard";
import { products } from "@/lib/catalogue";

type Props = { product: ProductType; selectedColor: string; selectedSize: string };

const ProductDetailsClient = ({ product, selectedColor: initialColor, selectedSize }: Props) => {
  const [selectedColor, setSelectedColor] = useState(initialColor);
  const [activeImage, setActiveImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "details" | "reviews">("overview");
  const { addToCart } = useCartStore();

  const gallery = useMemo(() => {
    const unique = [...new Set(Object.values(product.images).filter(Boolean))];
    const chosen = product.images[selectedColor] ?? product.images.default ?? unique[0];
    const available = chosen ? [chosen, ...unique.filter((image) => image !== chosen)] : [];
    return [
      ...available.slice(0, 4),
      ...Array.from({ length: Math.max(0, 4 - available.length) }, () => null),
    ];
  }, [product.images, selectedColor]);

  const discount = product.compareAtPrice && product.compareAtPrice > product.price
    ? Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100)
    : product.discountPercent ?? null;
  const recommendations = products
    .filter((item) => item.id !== product.id)
    .map((item) => {
      const sharedTags = item.tags.filter((tag) => product.tags.includes(tag)).length;
      const sameDepartment = item.categorySlug === product.categorySlug;
      return { item, score: (sameDepartment ? 100 : 0) + sharedTags * 10 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ item }) => item);
  const hasOnlySameDepartmentRecommendations = recommendations.every(
    (item) => item.categorySlug === product.categorySlug,
  );
  const rating = product.reviewSummary?.averageRating;
  const reviews = product.reviewSummary?.totalReviews ?? 0;
  const stockLabel = product.stockStatus === "out-of-stock"
    ? "Out of stock"
    : product.stockStatus === "low-stock"
      ? "Low stock"
      : "In stock";

  const addProduct = () => {
    if (product.stockStatus === "out-of-stock") {
      toast.error("This item is currently out of stock");
      return;
    }
    if (product.availableQuantity != null && quantity > product.availableQuantity) {
      toast.error(`Only ${product.availableQuantity} available`);
      return;
    }
    addToCart({ ...product, quantity, selectedColor, selectedSize });
    toast.success("Product added to cart");
  };

  return (
    <section className="product-detail" aria-label={product.name}>
      <nav className="product-detail__breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link><span>›</span>
        <Link href={`/products?category=${product.categorySlug}`}>{product.categoryName}</Link><span>›</span>
        <span aria-current="page">{product.name}</span>
      </nav>

      <div className="product-detail__main">
        <div className="product-detail__gallery">
          <div className="product-detail__thumbs" aria-label="Product images">
            {gallery.map((src, index) => (
              <button key={src ?? `photo-placeholder-${index}`} type="button" className={activeImage === index ? "is-active" : ""} onClick={() => setActiveImage(index)} aria-label={src ? `View product image ${index + 1}` : `More product photos coming soon, image slot ${index + 1}`} aria-pressed={activeImage === index}>
                {src ? <Image src={src} alt="" fill sizes="76px" /> : <span className="product-detail__thumb-placeholder"><ImageIcon size={19}/><small>Photo</small></span>}
              </button>
            ))}
          </div>
          <div className="product-detail__hero-image">
            {gallery[activeImage] ? <Image src={gallery[activeImage]} alt={product.name} fill priority sizes="(max-width: 800px) 100vw, 48vw" className="object-contain" /> : <div className="product-detail__no-image"><ImageIcon size={38}/><strong>More product photos coming soon</strong><span>We’ll add additional product views when they are available.</span></div>}
            {discount != null && discount > 0 && <span className="product-detail__discount">-{discount}%</span>}
          </div>
        </div>

        <div className="product-detail__summary">
          <Link className="product-detail__category" href={`/products?category=${product.categorySlug}`}>{product.categoryName}</Link>
          <p className="product-detail__brand">{product.brand}</p>
          <h1>{product.name}</h1>
          {rating != null && <div className="product-detail__rating"><span aria-hidden="true">★</span><strong>{rating.toFixed(1)}</strong><a href="#product-reviews">{reviews.toLocaleString("en-NG")} reviews</a></div>}
          <div className="product-detail__price-row">
            <strong>₦{product.price.toLocaleString("en-NG")}</strong>
            {product.compareAtPrice != null && product.compareAtPrice > product.price && <del>₦{product.compareAtPrice.toLocaleString("en-NG")}</del>}
            {discount != null && discount > 0 && <span>{discount}% off</span>}
          </div>
          <p className="product-detail__description">{product.shortDescription || product.description}</p>
          <div className="product-detail__buying-points">
            <div><CheckCircle2 size={16}/><span>{product.stockStatus === "in-stock" ? "Available to add to your basket" : product.stockStatus === "low-stock" ? "Limited availability" : "Currently unavailable"}</span></div>
            <div><Truck size={16}/><span>Delivery available across Nigeria <Link href="/delivery-information">View delivery information</Link></span></div>
            <div><RotateCcw size={16}/><span>7-day returns policy <Link href="/returns-policy">See return conditions</Link></span></div>
          </div>

          {product.colors.length > 0 && (
            <fieldset className="product-detail__options">
              <legend>Colour: <strong>{selectedColor}</strong></legend>
              <div className="product-detail__swatches">
                {product.colors.map((color) => (
                  <button key={color} type="button" className={selectedColor === color ? "is-selected" : ""} onClick={() => { setSelectedColor(color); setActiveImage(0); }} aria-label={`Select ${color}`} aria-pressed={selectedColor === color}>
                    <span>{color}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {product.sizes.length > 0 && <div className="product-detail__size-list"><span>Available sizes</span><div>{product.sizes.map((size) => <span key={size}>{size}</span>)}</div></div>}

          <div className="product-detail__stock-row">
            <div className="product-detail__quantity">
              <span>Quantity</span>
              <div>
                <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity((value) => Math.max(1, value - 1))}><Minus size={16}/></button>
                <strong aria-live="polite">{quantity}</strong>
                <button type="button" aria-label="Increase quantity" disabled={product.availableQuantity != null && quantity >= product.availableQuantity} onClick={() => setQuantity((value) => value + 1)}><Plus size={16}/></button>
              </div>
            </div>
            <span className={`product-detail__stock product-detail__stock--${product.stockStatus}`}><PackageCheck size={17}/>{stockLabel}</span>
          </div>
          <div className="product-detail__actions">
            <button type="button" className="product-detail__add" onClick={addProduct} disabled={product.stockStatus === "out-of-stock"}><ShoppingCart size={19}/>Add to Cart</button>
            <button type="button" className={`product-detail__wishlist ${saved ? "is-saved" : ""}`} onClick={() => setSaved((value) => !value)} aria-label={saved ? "Remove from wishlist" : "Add to wishlist"} aria-pressed={saved}><Heart size={21} fill={saved ? "currentColor" : "none"}/></button>
          </div>
          <div className="product-detail__assurances">
            <div><ShieldCheck/><span>Secure checkout</span></div>
            <span>Payment options are shown securely at checkout.</span>
          </div>
          <p className="product-detail__demo-note">Demonstration catalogue item. Product availability, pricing and checkout are sample storefront content until the catalogue is connected to the backend.</p>
        </div>
      </div>

      <div className="product-detail__information">
        <div className="product-detail__tabs" role="tablist" aria-label="Product information">
          <button type="button" role="tab" aria-selected={activeTab === "overview"} onClick={() => setActiveTab("overview")}>Overview</button>
          <button type="button" role="tab" aria-selected={activeTab === "details"} onClick={() => setActiveTab("details")}>Product details</button>
          <button id="product-reviews" type="button" role="tab" aria-selected={activeTab === "reviews"} onClick={() => setActiveTab("reviews")}>Reviews ({reviews})</button>
        </div>
        <div className="product-detail__tab-panel" role="tabpanel">
          {activeTab === "overview" && <><h2>Overview</h2><p>{product.description}</p></>}
          {activeTab === "details" && <><h2>Product details</h2><dl><div><dt>Brand</dt><dd>{product.brand}</dd></div><div><dt>Category</dt><dd>{product.categoryName}</dd></div><div><dt>SKU</dt><dd>{product.sku}</dd></div><div><dt>Availability</dt><dd>{stockLabel}</dd></div></dl></>}
          {activeTab === "reviews" && <><h2>Customer reviews</h2>{rating != null ? <div className="product-detail__review-summary"><strong>★ {rating.toFixed(1)} / 5</strong><span>Based on {reviews.toLocaleString("en-NG")} review records in this demonstration catalogue.</span></div> : <p>Customer reviews will appear here when available.</p>}<p className="product-detail__demo-note">Individual review comments are not yet available for this demonstration product.</p></>}
        </div>
      </div>

      {recommendations.length > 0 && (
        <section className="product-recommendations" aria-labelledby="product-recommendations-title">
          <div className="product-recommendations__heading">
            <div>
              <h2 id="product-recommendations-title">You might also like</h2>
              <p>{hasOnlySameDepartmentRecommendations ? `More from ${product.categoryName}.` : "More products selected for you."}</p>
            </div>
            <Link href={`/products?category=${product.categorySlug}`}>View all <span aria-hidden="true">→</span></Link>
          </div>
          <div className="product-recommendations__grid">
            {recommendations.map((recommendedProduct) => (
              <ProductCard key={recommendedProduct.id} product={recommendedProduct} variant="catalogue" />
            ))}
          </div>
        </section>
      )}
    </section>
  );
};

export default ProductDetailsClient;
