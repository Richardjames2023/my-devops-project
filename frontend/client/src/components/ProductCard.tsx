"use client";

import Image from "next/image";
import Link from "next/link";
import { CatalogProduct, formatNaira } from "@/lib/catalog";
import { ImageOff } from "lucide-react";

export default function ProductCard({ product }: { product: CatalogProduct }) {
  const image = product.images.find((item) => item.isPrimary) ?? product.images[0];
  const price = product.priceFrom ?? product.basePrice;
  return (
    <article className="group overflow-hidden rounded-2xl border border-[#EEEAE4] bg-white transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_35px_rgba(8,28,65,0.09)]">
      <Link href={`/products/${product.slug}`} className="block">
        <div className="relative aspect-[4/4.5] overflow-hidden bg-[#F4F6FA]">
          {image ? <Image src={image.url} alt={image.altText || product.name} fill unoptimized sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 25vw" className="object-cover transition duration-500 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center text-[#9CA3AF]"><ImageOff size={32} /></div>}
          {!product.inStock && <span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-[11px] font-bold text-[#6B7280]">Out of stock</span>}
          {product.hasWarranty && <span className="absolute right-3 top-3 rounded-full bg-[#E9F1FE] px-3 py-1 text-[11px] font-bold text-[#1D52BD]">Warranty</span>}
        </div>
        <div className="p-4">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7B8493]">{product.category.name}</p>
          <h3 className="line-clamp-2 min-h-10 text-sm font-semibold text-[#081C41]">{product.name}</h3>
          <p className="mt-3 text-base font-bold text-[#081C41]">{formatNaira(price)}</p>
          {product.priceTo && product.priceFrom && product.priceTo !== product.priceFrom && <p className="mt-1 text-xs text-[#7B8493]">Price varies by option</p>}
        </div>
      </Link>
    </article>
  );
}
