import ProductInteraction from "@/components/ProductInteraction";
import { products } from "@/lib/catalogue";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

type ProductPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ color?: string; size?: string }>;
};

export const generateMetadata = async ({ params }: Pick<ProductPageProps, "params">) => {
  const { id } = await params;
  const product = products.find((item) => String(item.id) === id);
  if (!product) return { title: "Product not found | ClickClickBuy" };
  return { title: product.name, description: product.description };
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
  const imageSrc =
    product.images[selectedColor] ??
    product.images.default ??
    Object.values(product.images)[0];

  return (
    <div className="mt-8 flex flex-col gap-8 lg:mt-12 lg:flex-row lg:gap-12">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-[var(--shop-search)] lg:w-5/12">
        <Image src={imageSrc} alt={product.name} fill sizes="(max-width: 1024px) 100vw, 42vw" className="object-contain" />
      </div>
      <div className="flex w-full flex-col gap-4 lg:w-7/12">
        <Link href={`/products?category=${product.categorySlug}`} className="text-xs font-semibold uppercase tracking-wide text-[var(--shop-orange-dark)] hover:underline">
          {product.categoryName}
        </Link>
        <p className="text-sm text-[var(--shop-muted)]">{product.brand}</p>
        <h1 className="text-2xl font-bold text-[var(--shop-navy)] sm:text-3xl">{product.name}</h1>
        <p className="leading-7 text-[var(--shop-muted)]">{product.description}</p>
        <p className="text-2xl font-bold text-[var(--shop-navy)]">₦{product.price.toLocaleString("en-NG")}</p>
        <ProductInteraction product={product} selectedSize={selectedSize} selectedColor={selectedColor} />
        <p className="text-xs text-[var(--shop-muted)]">Demonstration catalogue item. Product availability, pricing and checkout are sample storefront content until the catalogue is connected to the backend.</p>
      </div>
    </div>
  );
};

export default ProductPage;
