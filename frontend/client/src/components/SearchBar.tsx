import { Search } from "lucide-react";

const SearchBar = () => {
  return (
    <form
      action="/products"
      method="get"
      role="search"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--shop-border)] bg-[var(--shop-search)] px-2.5 sm:w-36 sm:justify-start md:w-40 lg:w-64"
    >
      <Search size={16} className="shrink-0 text-[var(--shop-navy)]" aria-hidden="true" />
      <input
        id="search"
        name="q"
        type="search"
        placeholder="Search products, brands..."
        aria-label="Search products and brands"
        className="ml-2 hidden min-w-0 flex-1 bg-transparent text-[13px] text-[var(--shop-navy)] outline-none placeholder:text-[var(--shop-muted)] sm:block"
      />
    </form>
  );
};

export default SearchBar;
