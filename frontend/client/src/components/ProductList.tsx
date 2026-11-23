import Categories from "./Categories";
import ProductCard from "./ProductCard";
import Link from "next/link";
import Filter from "./Filter";
import { products } from "@/lib/catalogue";

const ProductList = ({ category, query, sort, params }: { category?: string; query?: string; sort?: string; params: "homepage" | "products" }) => {
  const normalizedCategory = category?.toLowerCase();
  const categoryFilteredProducts =
    !normalizedCategory || normalizedCategory === "all"
      ? products
      : products.filter((product) => product.categorySlug === normalizedCategory);

  const normalizedQuery = query?.trim().toLocaleLowerCase() ?? "";
  const searchedProducts = normalizedQuery
    ? categoryFilteredProducts.filter((product) =>
        [product.name, product.brand, product.categoryName, product.categorySlug, product.shortDescription, product.description, ...product.tags]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
    : categoryFilteredProducts;

  const visibleProducts = [...searchedProducts].sort((a, b) => {
    switch (sort) {
      case "oldest": return String(b.id).localeCompare(String(a.id));
      case "asc": return a.price - b.price;
      case "desc": return b.price - a.price;
      case "newest":
      default: return 0;
    }
  });

  return (
    <div className="w-full">
      {params === "homepage" && (
        <div className="mb-5 flex flex-col gap-1 sm:mb-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--shop-orange-dark)]">A little something for every day</p>
          <h2 className="text-2xl font-extrabold tracking-tight text-[var(--shop-navy)] sm:text-3xl">Discover the ClickClickBuy collection</h2>
          <p className="max-w-2xl text-sm leading-6 text-[var(--shop-muted)] sm:text-base">Explore practical finds for your home, work, everyday routines and time outdoors.</p>
        </div>
      )}
      {query?.trim() && <p className="mb-4 text-sm text-[var(--shop-muted)]">Search results for <span className="font-semibold text-[var(--shop-navy)]">&ldquo;{query.trim()}&rdquo;</span> · {visibleProducts.length} {visibleProducts.length === 1 ? "product" : "products"} found</p>}
      {params === "products" && <Categories />}
      {params === "products" && <Filter />}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {visibleProducts.length > 0 ? visibleProducts.map((product) => <ProductCard key={product.id} product={product} />) : (
          <div className="col-span-full rounded-xl border border-[var(--shop-border)] bg-white px-6 py-12 text-center">
            <h2 className="text-lg font-semibold text-[var(--shop-navy)]">No products found</h2>
            <p className="mt-2 text-sm text-[var(--shop-muted)]">Try another product name or a broader search term.</p>
            <Link href="/products" className="mt-4 inline-flex rounded-lg bg-[var(--shop-orange)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--shop-orange-dark)]">Browse all products</Link>
          </div>
        )}
      </div>
      <Link href={category ? `/products/?category=${category}` : "/products"} className="mt-4 flex justify-end text-sm text-gray-500 underline">View all products</Link>
    </div>
  );
};

export default ProductList;
