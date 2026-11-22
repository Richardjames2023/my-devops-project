import { Search } from "lucide-react";

const SearchBar = () => {
  return (
    <form
      action="/products"
      method="get"
      role="search"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--shop-border)] bg-[var(--shop-search)] px-3 sm:w-48 sm:justify-start md:w-56 lg:w-80 xl:w-[22rem]"
    >
      <Search size={18} className="shrink-0 text-[var(--shop-navy)]" aria-hidden="true" />
      <input
        id="search"
        name="q"
        type="search"
        placeholder="Search products, brands..."
        aria-label="Search products and brands"
        className="ml-2 hidden min-w-0 flex-1 bg-transparent text-[14px] text-[var(--shop-navy)] outline-none placeholder:text-[var(--shop-muted)] sm:block"
      />
    </form>
  );
};

export default SearchBar;
