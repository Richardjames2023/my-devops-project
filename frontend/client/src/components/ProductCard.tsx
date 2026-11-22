"use client";

import useCartStore from "@/stores/cartStore";
import { ProductType } from "@/types";
import { Check, ShoppingCart } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { toast } from "react-toastify";

const ProductCard = ({ product }: { product: ProductType }) => {
  const [productTypes, setProductTypes] = useState({
    size: product.sizes[0],
    color: product.colors[0],
  });
  const { addToCart } = useCartStore();

  const handleAddToCart = () => {
    addToCart({
      ...product,
      quantity: 1,
      selectedSize: productTypes.size,
      selectedColor: productTypes.color,
    });
    toast.success("Product added to cart");
  };

  return (
    <article className="group overflow-hidden rounded-2xl border border-[var(--shop-border)] bg-white shadow-[0_5px_22px_rgba(8,28,65,0.045)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shop-shadow)]">
      <Link
        href={`/products/${product.id}`}
        aria-label={`View ${product.name}`}
        className="relative block overflow-hidden bg-[var(--shop-search)]"
      >
        <div className="relative aspect-[4/4.5] w-full">
          <Image
            src={product.images[productTypes.color]}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 90vw, (max-width: 1280px) 45vw, 300px"
            className="object-contain p-5 transition-transform duration-500 group-hover:scale-105"
          />
        </div>
        <span className="absolute left-3 top-3 rounded-full border border-white/80 bg-white/90 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--shop-navy)] backdrop-blur">
          Explore
        </span>
      </Link>

      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="min-h-[54px]">
          <Link href={`/products/${product.id}`} className="font-bold leading-5 text-[var(--shop-navy)] transition-colors hover:text-[var(--shop-orange-dark)]">
            {product.name}
          </Link>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--shop-muted)]">
            {product.shortDescription}
          </p>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3 border-t border-[var(--shop-border)] pt-3">
          {product.sizes.length > 0 && (
            <label className="flex min-w-0 flex-col gap-1.5 text-[11px] font-semibold text-[var(--shop-muted)]">
              Size
              <select
                name={`size-${product.id}`}
                aria-label={`Choose size for ${product.name}`}
                value={productTypes.size}
                className="h-9 rounded-lg border border-[var(--shop-border)] bg-white px-2 text-xs font-semibold text-[var(--shop-navy)] outline-none focus:border-[var(--shop-orange)] focus:ring-2 focus:ring-[var(--shop-peach)]"
                onChange={(event) => setProductTypes((current) => ({ ...current, size: event.target.value }))}
              >
                {product.sizes.map((size) => (
                  <option key={size} value={size}>{size.toUpperCase()}</option>
                ))}
              </select>
            </label>
          )}

          {product.colors.length > 0 && (
            <fieldset className="flex min-w-0 flex-col gap-1.5">
              <legend className="text-[11px] font-semibold text-[var(--shop-muted)]">Colour</legend>
              <div className="flex items-center gap-1.5">
                {product.colors.map((color) => {
                  const selected = productTypes.color === color;
                  return (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Choose ${color} colour`}
                      aria-pressed={selected}
                      onClick={() => setProductTypes((current) => ({ ...current, color }))}
                      className={`flex h-7 w-7 items-center justify-center rounded-full border transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--shop-orange)] ${selected ? "border-[var(--shop-navy)]" : "border-transparent hover:border-[var(--shop-muted)]"}`}
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-black/10" style={{ backgroundColor: color }}>
                        {selected && <Check size={12} className={color === "white" || color === "yellow" ? "text-black" : "text-white"} aria-hidden="true" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-base font-extrabold tracking-tight text-[var(--shop-navy)]">
            ${product.price.toFixed(2)}
          </p>
          <button
            type="button"
            onClick={handleAddToCart}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[var(--shop-navy)] px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[var(--shop-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--shop-orange)]"
          >
            <ShoppingCart size={15} aria-hidden="true" />
            Add to cart
          </button>
        </div>
      </div>
    </article>
  );
};

export default ProductCard;
