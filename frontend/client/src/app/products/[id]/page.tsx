import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react";
import { formatNaira, getProductBySlug } from "@/lib/catalog";
import type { Metadata } from "next";

type Props = { params: Promise<{ id: string }> };
async function loadProduct(slug: string) { try { return await getProductBySlug(slug); } catch { return null; } }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params; const product = await loadProduct(id);
  return product ? { title: product.name, description: product.description ?? `Explore ${product.name} on ShopSphere.` } : { title: "Product not found" };
}
export default async function ProductPage({ params }: Props) {
  const { id } = await params; const product = await loadProduct(id); if (!product) notFound();
  const image = product.images.find((item) => item.isPrimary) ?? product.images[0];
  const price = product.priceFrom ?? product.basePrice;
  return <div className="mx-auto max-w-6xl">
    <Link href="/products" className="mb-7 inline-flex items-center gap-2 text-sm font-semibold text-[#1D52BD]"><ArrowLeft size={16}/> Back to shop</Link>
    <div className="grid gap-9 lg:grid-cols-2 lg:gap-14">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="relative aspect-square overflow-hidden rounded-3xl bg-[#F4F6FA] sm:col-span-2">{image ? <Image src={image.url} alt={image.altText || product.name} fill unoptimized sizes="(max-width: 1024px) 100vw, 50vw" className="object-contain"/> : <div className="flex h-full items-center justify-center text-sm text-[#7B8493]">No product image available</div>}</div>
        {product.images.filter((item) => item.id !== image?.id).slice(0,2).map((item) => <div key={item.id} className="relative aspect-square overflow-hidden rounded-2xl bg-[#F4F6FA]"><Image src={item.url} alt={item.altText || product.name} fill unoptimized sizes="(max-width: 640px) 45vw, 25vw" className="object-cover"/></div>)}
      </div>
      <div className="py-2">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#EC702E]">{product.category.name}</p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-[#081C41] sm:text-4xl">{product.name}</h1>
        <p className="mt-5 text-2xl font-bold text-[#081C41]">{formatNaira(price)}{product.priceTo && product.priceFrom && product.priceTo !== product.priceFrom ? <span className="ml-2 text-sm font-normal text-[#7B8493]">– {formatNaira(product.priceTo)}</span> : null}</p>
        <div className="mt-5 flex items-center gap-2 text-sm">{product.inStock ? <><CheckCircle2 size={17} className="text-[#337245]"/> <span className="font-semibold text-[#337245]">In stock</span></> : <span className="font-semibold text-[#7B8493]">Currently out of stock</span>}</div>
        {product.description && <div className="mt-7 border-t border-[#EEEAE4] pt-6"><h2 className="font-bold text-[#081C41]">Product details</h2><p className="mt-3 whitespace-pre-line text-sm leading-7 text-[#626B79]">{product.description}</p></div>}
        <div className="mt-7 border-t border-[#EEEAE4] pt-6"><h2 className="font-bold text-[#081C41]">Available options</h2>{product.variants.length ? <ul className="mt-3 divide-y divide-[#EEEAE4] rounded-xl border border-[#EEEAE4] bg-white">{product.variants.map((variant) => <li key={variant.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="font-medium text-[#373E4B]">{variant.name}</span><span className="text-right"><span className="block font-semibold text-[#081C41]">{formatNaira(variant.price)}</span><span className={variant.inStock ? "text-xs text-[#337245]" : "text-xs text-[#7B8493]"}>{variant.inStock ? `${variant.availableQuantity} available` : "Unavailable"}</span></span></li>)}</ul> : <p className="mt-2 text-sm text-[#7B8493]">No options listed for this product.</p>}</div>
        {product.hasWarranty && <div className="mt-6 flex gap-3 rounded-2xl bg-[#E9F1FE] p-4 text-sm text-[#081C41]"><ShieldCheck size={20} className="shrink-0 text-[#1D52BD]"/><div><p className="font-bold">Warranty information</p>{product.warrantyDuration !== null && <p className="mt-1">{product.warrantyDuration} months</p>}{product.warrantyTerms && <p className="mt-1 leading-6 text-[#46556E]">{product.warrantyTerms}</p>}</div></div>}
      </div>
    </div>
  </div>;
}
