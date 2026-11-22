"use client";

import {
  Footprints,
  Glasses,
  Briefcase,
  Shirt,
  ShoppingBasket,
  Hand,
  Venus,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const categories = [
  { name: "All", icon: ShoppingBasket, slug: "all" },
  { name: "T-shirts", icon: Shirt, slug: "t-shirts" },
  { name: "Shoes", icon: Footprints, slug: "shoes" },
  { name: "Accessories", icon: Glasses, slug: "accessories" },
  { name: "Bags", icon: Briefcase, slug: "bags" },
  { name: "Dresses", icon: Venus, slug: "dresses" },
  { name: "Jackets", icon: Shirt, slug: "jackets" },
  { name: "Gloves", icon: Hand, slug: "gloves" },
];

const Categories = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const selectedCategory = searchParams.get("category") ?? "all";

  const handleChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("category");
    else params.set("category", value);
    router.push(`${pathname}${params.size ? `?${params.toString()}` : ""}`, { scroll: false });
  };

  return (
    <nav aria-label="Shop by category" className="mb-7">
      <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:thin] [scrollbar-color:var(--shop-border)_transparent]">
        {categories.map(({ name, icon: Icon, slug }) => {
          const isSelected = slug === selectedCategory;
          return (
            <button
              key={slug}
              type="button"
              aria-pressed={isSelected}
              onClick={() => handleChange(slug)}
              className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full border px-4 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--shop-orange)] sm:text-sm ${
                isSelected
                  ? "border-[var(--shop-navy)] bg-[var(--shop-navy)] text-white shadow-sm"
                  : "border-[var(--shop-border)] bg-white text-[var(--shop-body)] hover:border-[var(--shop-orange)] hover:bg-[var(--shop-peach-tint)] hover:text-[var(--shop-orange-dark)]"
              }`}
            >
              <Icon size={16} aria-hidden="true" />
              {name}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default Categories;
