"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { categories } from "@/lib/catalogue";

const Categories = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const selectedCategory = searchParams.get("category") ?? "all";

  const handleChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("category");
    else params.set("category", value);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <nav aria-label="Shop by category" className="mb-5">
      <div className="flex gap-2 overflow-x-auto pb-2">
        <button
          type="button"
          aria-pressed={selectedCategory === "all"}
          onClick={() => handleChange("all")}
          className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${selectedCategory === "all" ? "border-[var(--shop-navy)] bg-[var(--shop-navy)] text-white" : "border-[var(--shop-border)] bg-white text-[var(--shop-body)] hover:border-[var(--shop-blue)]"}`}
        >
          All products
        </button>
        {categories.map((category) => (
          <button
            key={category.slug}
            type="button"
            aria-pressed={selectedCategory === category.slug}
            onClick={() => handleChange(category.slug)}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${selectedCategory === category.slug ? "border-[var(--shop-navy)] bg-[var(--shop-navy)] text-white" : "border-[var(--shop-border)] bg-white text-[var(--shop-body)] hover:border-[var(--shop-blue)]"}`}
          >
            {category.name}
          </button>
        ))}
      </div>
    </nav>
  );
};

export default Categories;
