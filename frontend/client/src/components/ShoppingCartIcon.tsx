"use client";

import useCartStore from "@/stores/cartStore";
import { ShoppingBag } from "lucide-react";
import Link from "next/link";

const ShoppingCartIcon = () => {
  const { cart, hasHydrated } = useCartStore();
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);

  return (
    <Link
      href="/cart"
      aria-label={hasHydrated ? `Shopping bag, ${itemCount} items` : "Shopping bag"}
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-[var(--shop-navy)] transition-colors hover:bg-[var(--shop-blue-light)] active:bg-[var(--shop-blue-light)] focus-visible:bg-[var(--shop-blue-light)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--shop-orange)]"
    >
      <ShoppingBag size={19} strokeWidth={1.8} />
      {hasHydrated && itemCount > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[var(--shop-orange)] px-1 text-[10px] font-bold leading-none text-white">
          {itemCount}
        </span>
      ) : null}
    </Link>
  );
};

export default ShoppingCartIcon;
