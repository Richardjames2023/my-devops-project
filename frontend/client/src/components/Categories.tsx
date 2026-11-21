import Link from "next/link";
import { getCategories } from "@/lib/catalog";

export default async function Categories({ selected }: { selected?: string }) {
  let categories: Awaited<ReturnType<typeof getCategories>> = [];
  try { categories = await getCategories(); } catch { return null; }
  return (
    <nav aria-label="Shop by category" className="mb-8 flex gap-3 overflow-x-auto pb-2">
      <Link href="/products" className={`whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-semibold transition ${!selected ? "bg-[#081C41] text-white" : "border border-[#E5E7EB] bg-white text-[#373E4B] hover:border-[#1D52BD]"}`}>All products</Link>
      {categories.map((category) => (
        <Link key={category.id} href={`/products?category=${encodeURIComponent(category.slug)}`} className={`whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-semibold transition ${selected === category.slug ? "bg-[#081C41] text-white" : "border border-[#E5E7EB] bg-white text-[#373E4B] hover:border-[#1D52BD]"}`}>
          {category.name}
        </Link>
      ))}
    </nav>
  );
}
