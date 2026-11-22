import { ProductsType } from "@/types";
import Categories from "./Categories";
import ProductCard from "./ProductCard";
import Link from "next/link";
import Filter from "./Filter";

// TEMPORARY
const products: ProductsType = [
  {
    id: 1,
    name: "Adidas CoreFit T-Shirt",
    shortDescription:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    description:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    price: 39.9,
    sizes: ["s", "m", "l", "xl", "xxl"],
    colors: ["gray", "purple", "green"],
    images: {
      gray: "/products/1g.png",
      purple: "/products/1p.png",
      green: "/products/1gr.png",
    },
  },
  {
    id: 2,
    name: "Puma Ultra Warm Zip",
    shortDescription:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    description:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    price: 59.9,
    sizes: ["s", "m", "l", "xl"],
    colors: ["gray", "green"],
    images: { gray: "/products/2g.png", green: "/products/2gr.png" },
  },
  {
    id: 3,
    name: "Nike Air Essentials Pullover",
    shortDescription:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    description:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    price: 69.9,
    sizes: ["s", "m", "l"],
    colors: ["green", "blue", "black"],
    images: {
      green: "/products/3gr.png",
      blue: "/products/3b.png",
      black: "/products/3bl.png",
    },
  },
  {
    id: 4,
    name: "Nike Dri Flex T-Shirt",
    shortDescription:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    description:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    price: 29.9,
    sizes: ["s", "m", "l"],
    colors: ["white", "pink"],
    images: { white: "/products/4w.png", pink: "/products/4p.png" },
  },
  {
    id: 5,
    name: "Under Armour StormFleece",
    shortDescription:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    description:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    price: 49.9,
    sizes: ["s", "m", "l"],
    colors: ["red", "orange", "black"],
    images: {
      red: "/products/5r.png",
      orange: "/products/5o.png",
      black: "/products/5bl.png",
    },
  },
  {
    id: 6,
    name: "Nike Air Max 270",
    shortDescription:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    description:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    price: 59.9,
    sizes: ["40", "42", "43", "44"],
    colors: ["gray", "white"],
    images: { gray: "/products/6g.png", white: "/products/6w.png" },
  },
  {
    id: 7,
    name: "Nike Ultraboost Pulse ",
    shortDescription:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    description:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    price: 69.9,
    sizes: ["40", "42", "43"],
    colors: ["gray", "pink"],
    images: { gray: "/products/7g.png", pink: "/products/7p.png" },
  },
  {
    id: 8,
    name: "Levi’s Classic Denim",
    shortDescription:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    description:
      "Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit. Lorem ipsum dolor sit amet consect adipisicing elit lorem ipsum dolor sit.",
    price: 59.9,
    sizes: ["s", "m", "l"],
    colors: ["blue", "green"],
    images: { blue: "/products/8b.png", green: "/products/8gr.png" },
  },
];

const categoryProductIds: Record<string, number[]> = {
  "t-shirts": [1, 4],
  shoes: [6, 7],
  accessories: [8, 5],
  bags: [8, 1],
  dresses: [4, 1],
  jackets: [2, 3, 5],
  gloves: [5, 2],
};

const ProductList = ({ category, query, sort, params }: { category?: string; query?: string; sort?: string; params: "homepage" | "products" }) => {
  const normalizedCategory = category?.toLowerCase();
  const categoryFilteredProducts =
    !normalizedCategory || normalizedCategory === "all"
      ? products
      : products.filter((product) => (categoryProductIds[normalizedCategory] ?? []).includes(product.id));

  const normalizedQuery = query?.trim().toLocaleLowerCase() ?? "";
  const searchedProducts = normalizedQuery
    ? categoryFilteredProducts.filter((product) => {
        const searchableText = [
          product.name, product.shortDescription, product.description,
          ...(categoryProductIds["t-shirts"]?.includes(product.id) ? ["t-shirts", "shirts", "clothing"] : []),
          ...(categoryProductIds.shoes?.includes(product.id) ? ["shoes", "sneakers", "footwear"] : []),
          ...(categoryProductIds.accessories?.includes(product.id) ? ["accessories"] : []),
          ...(categoryProductIds.bags?.includes(product.id) ? ["bags", "backpacks"] : []),
          ...(categoryProductIds.dresses?.includes(product.id) ? ["dresses"] : []),
          ...(categoryProductIds.jackets?.includes(product.id) ? ["jackets", "hoodies", "outerwear"] : []),
          ...(categoryProductIds.gloves?.includes(product.id) ? ["gloves"] : []),
        ].join(" ").toLocaleLowerCase();
        return searchableText.includes(normalizedQuery);
      })
    : categoryFilteredProducts;

  const visibleProducts = [...searchedProducts].sort((a, b) => {
    switch (sort) {
      case "oldest": return b.id - a.id;
      case "asc": return a.price - b.price;
      case "desc": return b.price - a.price;
      case "newest":
      default: return 0;
    }
  });

  return (
    <div className="w-full">
      {query?.trim() && <p className="mb-4 text-sm text-[var(--shop-muted)]">Search results for <span className="font-semibold text-[var(--shop-navy)]">&ldquo;{query.trim()}&rdquo;</span> · {visibleProducts.length} {visibleProducts.length === 1 ? "product" : "products"} found</p>}
      <Categories />
      {params === "products" && <Filter/>}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-12">
        {visibleProducts.length > 0 ? visibleProducts.map((product) => (
          <ProductCard key={product.id} product={product} />
        )) : (
          <div className="col-span-full rounded-xl border border-[var(--shop-border)] bg-white px-6 py-12 text-center">
            <h2 className="text-lg font-semibold text-[var(--shop-navy)]">No products found</h2>
            <p className="mt-2 text-sm text-[var(--shop-muted)]">Try another product name or a broader search term.</p>
            <Link href="/products" className="mt-4 inline-flex rounded-lg bg-[var(--shop-orange)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--shop-orange-dark)]">Browse all products</Link>
          </div>
        )}
      </div>
      <Link
        href={category ? `/products/?category=${category}` : "/products"}
        className="flex justify-end mt-4 underline text-sm text-gray-500"
      >
        View all products
      </Link>
    </div>
  );
};

export default ProductList;
