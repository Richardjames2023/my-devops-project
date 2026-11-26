"use client";

import useCartStore from "@/stores/cartStore";
import { ProductType } from "@/types";
import { ShoppingCart, Heart } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { toast } from "react-toastify";

const ProductCard = ({ product, variant = "default" }: { product: ProductType; variant?: "default" | "catalogue" }) => {
  const [productTypes, setProductTypes] = useState({
    size: product.sizes[0] ?? "",
    color: product.colors[0] ?? "default",
  });
  const [saved, setSaved] = useState(false);
  const { addToCart } = useCartStore();
  const imageSrc = product.images[productTypes.color] ?? product.images.default ?? Object.values(product.images)[0];
  const discount = product.compareAtPrice && product.compareAtPrice > product.price
    ? Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100)
    : product.discountPercent ?? null;

  const handleAddToCart = () => {
    if (product.stockStatus === "out-of-stock") {
      toast.error("This item is currently out of stock");
      return;
    }
    addToCart({ ...product, quantity: 1, selectedSize: productTypes.size, selectedColor: productTypes.color });
    toast.success("Product added to cart");
  };

  if (variant === "catalogue") {
    return (
      <article className="catalogue-card">
        <Link href={`/products/${product.id}`} className="catalogue-card__image-link">
          <div className="catalogue-card__image">
            <Image src={imageSrc} alt={product.name} fill sizes="(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 25vw" className="object-contain transition-transform duration-300 hover:scale-105"/>
          </div>
        </Link>
        {discount !== null && discount > 0 && <span className="catalogue-card__discount">{discount}% off</span>}
        <button type="button" className={`catalogue-card__save ${saved ? "is-saved" : ""}`} aria-label={saved ? `Remove ${product.name} from saved items` : `Save ${product.name}`} aria-pressed={saved} onClick={() => setSaved((value) => !value)}><Heart size={15} fill={saved ? "currentColor" : "none"}/></button>
        <div className="catalogue-card__body">
          <Link href={`/products/${product.id}`} className="catalogue-card__details">
            <span className="catalogue-card__category">{product.categoryName}</span>
            <h2>{product.name}</h2>
          </Link>
          {product.reviewSummary?.averageRating != null && (
            <div className="catalogue-card__rating"><span aria-label={`${product.reviewSummary.averageRating} out of 5 stars`}>★★★★★</span><strong>{product.reviewSummary.averageRating.toFixed(1)}</strong><small>({product.reviewSummary.totalReviews} reviews)</small></div>
          )}
          <p className={`catalogue-card__stock catalogue-card__stock--${product.stockStatus}`}>{product.stockStatus === "out-of-stock" ? "Currently unavailable" : product.stockStatus === "low-stock" ? "Only a few left" : "In stock"}</p>
          <div className="catalogue-card__purchase">
            <div className="catalogue-card__prices"><strong>₦{product.price.toLocaleString("en-NG")}</strong>{product.compareAtPrice && product.compareAtPrice > product.price && <del>₦{product.compareAtPrice.toLocaleString("en-NG")}</del>}</div>
            <button type="button" onClick={handleAddToCart} disabled={product.stockStatus === "out-of-stock"} aria-label={`Add ${product.name} to basket`}><ShoppingCart size={17}/></button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="overflow-hidden rounded-xl border border-[var(--shop-border)] bg-white shadow-sm transition-shadow hover:shadow-lg">
      <Link href={`/products/${product.id}`} className="block">
        <div className="relative aspect-[1.4/1] bg-[var(--shop-search)]"><Image src={imageSrc} alt={product.name} fill sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw" className="object-cover transition-transform duration-300 hover:scale-105"/></div>
      </Link>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex flex-col gap-1"><p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--shop-orange-dark)]">{product.categoryName}</p><h2 className="line-clamp-2 font-semibold leading-snug text-[var(--shop-navy)]">{product.name}</h2><p className="line-clamp-1 text-xs text-[var(--shop-muted)]">{product.shortDescription}</p></div>
        <div className="flex items-center justify-between gap-3"><p className="font-bold text-[var(--shop-navy)]">₦{product.price.toLocaleString("en-NG")}</p><button type="button" aria-label={`Add ${product.name} to cart`} title="Add to cart" onClick={handleAddToCart} disabled={product.stockStatus === "out-of-stock"} className="flex items-center gap-1.5 rounded-lg bg-[var(--shop-orange)] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--shop-orange-dark)] disabled:cursor-not-allowed disabled:opacity-50"><ShoppingCart className="h-4 w-4" aria-hidden="true"/><span className="product-card__add-label">Add to Cart</span></button></div>
      </div>
    </article>
  );
};

export default ProductCard;
