import ProductList from "@/components/ProductList";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export default function Homepage() {
  return (
    <div>
      <section className="relative mb-12 overflow-hidden rounded-3xl bg-[#081C41] px-6 py-12 text-white sm:px-10 sm:py-16 lg:px-16">
        <div className="absolute -right-20 -top-28 h-80 w-80 rounded-full bg-[#1D52BD]/40 blur-3xl" /><div className="absolute -bottom-36 right-1/3 h-72 w-72 rounded-full bg-[#EC702E]/20 blur-3xl" />
        <div className="relative max-w-2xl"><div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-[#FDF0E8]"><Sparkles size={14} className="text-[#EC702E]" /> YOUR EVERYDAY DISCOVERY</div><h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">Find something <span className="text-[#EC702E]">you’ll love.</span></h1><p className="mt-5 max-w-lg text-sm leading-7 text-white/70 sm:text-base">Explore the collection and discover products selected for your everyday needs.</p><Link href="/products" className="mt-8 inline-flex items-center gap-3 rounded-xl bg-[#EC702E] px-6 py-3.5 text-sm font-bold text-white transition hover:bg-[#D85E20]">Explore the shop <ArrowRight size={17} /></Link></div>
        <div className="pointer-events-none absolute -bottom-16 -right-4 hidden h-72 w-72 rounded-full border border-white/10 lg:block" /><div className="pointer-events-none absolute -bottom-6 right-14 hidden h-48 w-48 rounded-full border border-white/10 lg:block" />
      </section>
      <ProductList query={{ page: 1, limit: 12, sort: "newest" }} />
    </div>
  );
}
