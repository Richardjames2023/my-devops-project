import ProductList from "@/components/ProductList";
import HeroSlider from "@/components/HeroSlider";

const Homepage = async ({
  searchParams,
}: {
  searchParams: Promise<{ category: string }>;
}) => {
  const category = (await searchParams).category;
  return (
    <div>
      <HeroSlider />
      <ProductList category={category} params="homepage" />
    </div>
  );
};

export default Homepage;
