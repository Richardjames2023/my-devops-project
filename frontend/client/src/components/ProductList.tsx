import Categories from "./Categories";
import ProductCard from "./ProductCard";
import Filter from "./Filter";
import { CatalogQuery, getProducts } from "@/lib/catalog";

type Props = { query: CatalogQuery; showFilter?: boolean };
export default async function ProductList({ query, showFilter = false }: Props) {
  let result;
  try { result = await getProducts(query); }
  catch (error) {
    return <section className="rounded-2xl border border-[#F2D8C8] bg-[#FDF5ED] p-8 text-center"><h2 className="text-lg font-bold text-[#081C41]">We couldn’t load the catalogue</h2><p className="mt-2 text-sm text-[#6B7280]">{error instanceof Error ? error.message : "Please try again later."}</p></section>;
  }
  return (
    <section>
      <Categories selected={query.category} />
      {showFilter && <Filter q={query.q} category={query.category} sort={query.sort} minPrice={query.minPrice} maxPrice={query.maxPrice} />}
      <div className="mb-5 flex items-end justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#EC702E]">Curated for you</p><h2 className="mt-1 text-2xl font-bold tracking-tight text-[#081C41]">{query.category ? "Explore this category" : query.q ? `Results for “${query.q}”` : "Explore our collection"}</h2></div>
        <p className="text-xs text-[#7B8493]">{result.pagination.total} products</p>
      </div>
      {result.items.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">{result.items.map((product) => <ProductCard key={product.id} product={product} />)}</div> : <div className="rounded-2xl border border-dashed border-[#D9DDE5] bg-white px-6 py-14 text-center"><h3 className="font-semibold text-[#081C41]">No products found</h3><p className="mt-2 text-sm text-[#7B8493]">Try a different search or adjust your filters.</p></div>}
      {result.pagination.totalPages > 1 && <nav aria-label="Product pages" className="mt-8 flex items-center justify-center gap-4 text-sm"><span className="text-[#7B8493]">Page {result.pagination.page} of {result.pagination.totalPages}</span>{result.pagination.hasPreviousPage && <a className="font-semibold text-[#1D52BD]" href={pageUrl(query, result.pagination.page - 1)}>Previous</a>}{result.pagination.hasNextPage && <a className="font-semibold text-[#1D52BD]" href={pageUrl(query, result.pagination.page + 1)}>Next</a>}</nav>}
    </section>
  );
}
function pageUrl(query: CatalogQuery, page: number) { const params = new URLSearchParams(); for (const [key,value] of Object.entries({...query,page})) if (value !== undefined && value !== "") params.set(key,String(value)); return `/products?${params.toString()}`; }
