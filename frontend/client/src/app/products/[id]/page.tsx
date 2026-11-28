import ProductDetailsClient from "@/components/ProductDetailsClient";
import { products } from "@/lib/catalogue";
import { notFound } from "next/navigation";

type ProductPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ color?: string; size?: string }>;
};

export const generateMetadata = async ({ params }: Pick<ProductPageProps, "params">) => {
  const { id } = await params;
  const product = products.find((item) => String(item.id) === id);
  if (!product) return { title: "Product not found | ClickClickBuy" };
  return { title: `${product.name} | ClickClickBuy`, description: product.description };
};

const ProductPage = async ({ params, searchParams }: ProductPageProps) => {
  const [{ id }, options] = await Promise.all([params, searchParams]);
  const product = products.find((item) => String(item.id) === id);
  if (!product) notFound();

  const selectedSize = product.sizes.includes(options.size ?? "")
    ? options.size!
    : product.sizes[0] ?? "";
  const selectedColor = product.colors.includes(options.color ?? "")
    ? options.color!
    : product.colors[0] ?? "default";

  return <ProductDetailsClient product={product} selectedSize={selectedSize} selectedColor={selectedColor} />;
};

export default ProductPage;
