"use client";

import { useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Search, ArrowUpRight } from "lucide-react";
import { products } from "@/lib/catalogue";

const SearchBar = () => {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const suggestions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery.length < 2) return [];

    return products
      .filter((product) =>
        [product.name, product.shortDescription, product.description]
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
      .slice(0, 5);
  }, [query]);

  const isOpen = isFocused && query.trim().length >= 2;

  const submitSearch = (value = query) => {
    const normalizedValue = value.trim();
    if (!normalizedValue) return;
    setIsFocused(false);
    router.push(`/products?q=${encodeURIComponent(normalizedValue)}`);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitSearch();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) {
      if (event.key === "Enter") {
        event.preventDefault();
        submitSearch();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      submitSearch(suggestions[activeIndex].name);
    } else if (event.key === "Escape") {
      setIsFocused(false);
      setActiveIndex(-1);
    }
  };

  return (
    <form
      action="/products"
      method="get"
      role="search"
      onSubmit={handleSubmit}
      className="relative flex h-10 w-36 shrink-0 items-center rounded-full border border-[var(--shop-border)] bg-[var(--shop-search)] px-3 transition-colors focus-within:border-[var(--shop-orange)] focus-within:ring-2 focus-within:ring-[var(--shop-peach)] sm:w-48 md:w-56 lg:w-80 xl:w-[22rem]"
    >
      <button type="submit" aria-label="Search products" className="shrink-0 text-[var(--shop-navy)] transition-colors hover:text-[var(--shop-orange)]">
        <Search size={18} aria-hidden="true" />
      </button>
      <input
        id="search"
        name="q"
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(-1);
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder="Search products, brands..."
        aria-label="Search products and brands"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls="shop-search-suggestions"
        autoComplete="off"
        className="ml-2 min-w-0 flex-1 bg-transparent text-[12px] text-[var(--shop-navy)] outline-none placeholder:text-[var(--shop-muted)] sm:text-[14px]"
      />

      <div
        id="shop-search-suggestions"
        role="listbox"
        aria-label="Product suggestions"
        aria-hidden={!isOpen}
        className={`absolute left-0 right-0 top-[calc(100%+10px)] z-[80] origin-top rounded-2xl border border-[var(--shop-border)] bg-white p-2 shadow-xl transition-all duration-200 ease-out motion-reduce:transition-none ${isOpen ? "visible translate-y-0 scale-100 opacity-100" : "invisible -translate-y-2 scale-[0.98] opacity-0"}`}
      >
        {suggestions.length > 0 ? (
          <>
            <p className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--shop-muted)]">Suggested products</p>
            {suggestions.map((product, index) => (
              <button
                key={product.id}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => submitSearch(product.name)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 ${activeIndex === index ? "bg-[var(--shop-peach)] text-[var(--shop-orange)]" : "text-[var(--shop-navy)] hover:bg-[var(--shop-peach)]"}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{product.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--shop-muted)]">{product.shortDescription}</span>
                </span>
                <ArrowUpRight size={15} className="shrink-0" aria-hidden="true" />
              </button>
            ))}
            <button
              type="submit"
              className="mt-1 flex w-full items-center justify-center rounded-xl border-t border-[var(--shop-border)] px-3 py-2.5 text-xs font-semibold text-[var(--shop-orange)] transition-colors hover:bg-[var(--shop-peach)]"
            >
              See all results for &ldquo;{query.trim()}&rdquo;
            </button>
          </>
        ) : (
          <p className="px-3 py-4 text-center text-xs text-[var(--shop-muted)]">No matching suggestions. Press Enter to search anyway.</p>
        )}
      </div>
    </form>
  );
};

export default SearchBar;
