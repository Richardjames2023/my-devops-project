import useCartStore from "@/stores/cartStore";
import { ProductType } from "@/types";
import { ShoppingCart } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { toast } from "react-toastify";

const ProductCard = ({ product }: { product: ProductType }) => {
  const [productTypes, setProductTypes] = useState({
    size: product.sizes[0] ?? "",
    color: product.colors[0] ?? "default",
  });

  const { addToCart } = useCartStore();
  const imageSrc = product.images[productTypes.color] ?? product.images.default ?? Object.values(product.images)[0];

  const handleProductType = ({
    type,
    value,
  }: {
    type: "size" | "color";
    value: string;
  }) => {
    setProductTypes((prev) => ({ ...prev, [type]: value }));
  };

  const handleAddToCart = () => {
    if (product.stockStatus === "out-of-stock") {
      toast.error("This item is currently out of stock");
      return;
    }

    addToCart({
      ...product,
      quantity: 1,
      selectedSize: productTypes.size,
      selectedColor: productTypes.color,
    });
    toast.success("Product added to cart");
  };

  return (
    <article className="overflow-hidden rounded-xl border border-[var(--shop-border)] bg-white shadow-sm transition-shadow hover:shadow-lg">
      <Link href={`/products/${product.id}`} className="block">
        <div className="relative aspect-[4/3] bg-[var(--shop-search)]">
          <Image
            src={imageSrc}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw"
            className="object-cover transition-transform duration-300 hover:scale-105"
          />
        </div>
      </Link>
      <div className="flex flex-col gap-3 p-4">
        <div className="min-h-16">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--shop-orange-dark)]">{product.categoryName}</p>
          <h2 className="font-semibold text-[var(--shop-navy)]">{product.name}</h2>
          <p className="mt-1 line-clamp-2 text-sm text-[var(--shop-muted)]">{product.shortDescription}</p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="font-bold text-[var(--shop-navy)]">₦{product.price.toLocaleString("en-NG")}</p>
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={product.stockStatus === "out-of-stock"}
            className="flex items-center gap-2 rounded-lg bg-[var(--shop-navy)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--shop-orange-dark)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ShoppingCart className="h-4 w-4" />
            Add to Cart
          </button>
        </div>
      </div>
    </article>
  );
};

export default ProductCard;
