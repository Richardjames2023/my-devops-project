import { Search } from "lucide-react";

const SearchBar = () => {
  return (
    <form
      action="/products"
      method="get"
      role="search"
      className="flex h-10 w-36 shrink-0 items-center rounded-full border border-[var(--shop-border)] bg-[var(--shop-search)] px-3 transition-colors focus-within:border-[var(--shop-orange)] focus-within:ring-2 focus-within:ring-[var(--shop-peach)] sm:w-48 md:w-56 lg:w-80 xl:w-[22rem]"
    >
      <button type="submit" aria-label="Search products" className="shrink-0 text-[var(--shop-navy)] transition-colors hover:text-[var(--shop-orange)]">
        <Search size={18} aria-hidden="true" />
      </button>
      <input
        id="search"
        name="q"
        type="search"
        placeholder="Search products, brands..."
        aria-label="Search products and brands"
        autoComplete="off"
        className="ml-2 min-w-0 flex-1 bg-transparent text-[12px] text-[var(--shop-navy)] outline-none placeholder:text-[var(--shop-muted)] sm:text-[14px]"
      />
    </form>
  );
};

export default SearchBar;
