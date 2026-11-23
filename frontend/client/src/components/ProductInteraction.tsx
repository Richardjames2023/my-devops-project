"use client";

import useCartStore from "@/stores/cartStore";
import { ProductType } from "@/types";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { toast } from "react-toastify";

const ProductInteraction = ({
  product,
  selectedSize,
  selectedColor,
}: {
  product: ProductType;
  selectedSize: string;
  selectedColor: string;
}) => {
  const [quantity, setQuantity] = useState(1);
  const { addToCart } = useCartStore();

  const handleAddToCart = () => {
    if (product.stockStatus === "out-of-stock") {
      toast.error("This item is currently out of stock");
      return;
    }
    addToCart({ ...product, quantity, selectedColor, selectedSize });
    toast.success("Product added to cart");
  };

  return (
    <div className="mt-4 flex flex-col gap-5">
      {product.sizes.length > 0 && (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="text-[var(--shop-muted)]">Size</legend>
          <div className="flex flex-wrap gap-2">
            {product.sizes.map((size) => (
              <span key={size} className={`rounded-md border px-3 py-2 text-xs ${selectedSize === size ? "border-[var(--shop-orange)] bg-[var(--shop-peach)] text-[var(--shop-navy)]" : "border-[var(--shop-border)]"}`}>{size.toUpperCase()}</span>
            ))}
          </div>
        </fieldset>
      )}
      {product.colors.length > 0 && (
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="text-[var(--shop-muted)]">Colour</legend>
          <div className="flex flex-wrap gap-2">
            {product.colors.map((color) => (
              <span key={color} className={`rounded-md border px-3 py-2 text-xs ${selectedColor === color ? "border-[var(--shop-orange)] bg-[var(--shop-peach)]" : "border-[var(--shop-border)]"}`}>{color}</span>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex items-center gap-3 text-sm">
        <span className="text-[var(--shop-muted)]">Quantity</span>
        <button type="button" aria-label="Decrease quantity" className="rounded border border-[var(--shop-border)] p-2" onClick={() => setQuantity((value) => Math.max(1, value - 1))}><Minus className="h-4 w-4" /></button>
        <span aria-live="polite" className="min-w-5 text-center">{quantity}</span>
        <button type="button" aria-label="Increase quantity" className="rounded border border-[var(--shop-border)] p-2" onClick={() => setQuantity((value) => value + 1)}><Plus className="h-4 w-4" /></button>
      </div>
      <button type="button" onClick={handleAddToCart} disabled={product.stockStatus === "out-of-stock"} className="flex items-center justify-center gap-2 rounded-lg bg-[var(--shop-navy)] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--shop-orange-dark)] disabled:cursor-not-allowed disabled:opacity-50">
        <ShoppingCart className="h-4 w-4" /> Add to Cart
      </button>
    </div>
  );
};

export default ProductInteraction;
