import Link from "next/link";

type Props = { q?: string; category?: string; sort?: string; minPrice?: string; maxPrice?: string };
export default function Filter({ q = "", category = "", sort = "newest", minPrice = "", maxPrice = "" }: Props) {
  return (
    <form action="/products" className="mb-7 flex flex-col gap-3 rounded-2xl border border-[#E9E6E1] bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
      {category && <input type="hidden" name="category" value={category} />}
      <div className="grid flex-1 grid-cols-2 gap-3 sm:max-w-lg">
        <label className="text-xs font-semibold text-[#373E4B]">Minimum price
          <input name="minPrice" inputMode="decimal" defaultValue={minPrice} placeholder="₦0" className="mt-1 w-full rounded-lg border border-[#E5E7EB] bg-[#FBF9F6] px-3 py-2.5 text-sm outline-none focus:border-[#1D52BD]" />
        </label>
        <label className="text-xs font-semibold text-[#373E4B]">Maximum price
          <input name="maxPrice" inputMode="decimal" defaultValue={maxPrice} placeholder="No maximum" className="mt-1 w-full rounded-lg border border-[#E5E7EB] bg-[#FBF9F6] px-3 py-2.5 text-sm outline-none focus:border-[#1D52BD]" />
        </label>
      </div>
      <div className="flex items-end gap-3">
        <label className="text-xs font-semibold text-[#373E4B]">Sort by
          <select name="sort" defaultValue={sort} className="mt-1 block rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#1D52BD]">
            <option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="name_asc">Name: A–Z</option>
          </select>
        </label>
        <button className="rounded-lg bg-[#1D52BD] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#153F91]">Apply</button>
        <Link href={category ? `/products?category=${encodeURIComponent(category)}` : "/products"} className="pb-2.5 text-xs font-semibold text-[#9E4A1B]">Reset</Link>
      </div>
    </form>
  );
}
