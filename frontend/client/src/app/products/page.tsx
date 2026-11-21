import ProductList from "@/components/ProductList";
import { CatalogQuery } from "@/lib/catalog";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Shop all products" };
type Search = { q?: string; category?: string; minPrice?: string; maxPrice?: string; sort?: string; page?: string };
export default async function ProductsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const sort = ["newest", "price_asc", "price_desc", "name_asc"].includes(params.sort ?? "") ? params.sort as CatalogQuery["sort"] : "newest";
  const page = Math.max(1, Number(params.page) || 1);
  return <ProductList query={{ q: params.q?.trim(), category: params.category, minPrice: params.minPrice, maxPrice: params.maxPrice, sort, page, limit: 12 }} showFilter />;
}
