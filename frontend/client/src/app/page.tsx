import ProductList from "@/components/ProductList";
import HeroSlider from "@/components/HeroSlider";
import TrustBenefits from "@/components/TrustBenefits";

const Homepage = async ({
  searchParams,
}: {
  searchParams: Promise<{ category: string }>;
}) => {
  const category = (await searchParams).category;
  return (
    <div>
      <HeroSlider />
      <TrustBenefits />
      <ProductList category={category} params="homepage" />
    </div>
  );
};

export default Homepage;
