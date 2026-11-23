import ProductList from "@/components/ProductList";

const ProductsPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string; sort?: string }>;
}) => {
  const { category, q, sort } = await searchParams;

  return (
    <div className="">
      <ProductList category={category} query={q} sort={sort} params="products" />
    </div>
  );
};

export default ProductsPage;
