import ProductList from "@/components/ProductList";
import HeroSlider from "@/components/HeroSlider";
import ShopByCategory from "@/components/ShopByCategory";
import TrustBenefits from "@/components/TrustBenefits";
import FeaturedFinds from "@/components/FeaturedFinds";

const Homepage = async ({
  searchParams,
}: {
  searchParams: Promise<{ category: string }>;
}) => {
  const category = (await searchParams).category;
  return (
    <div>
      <HeroSlider />
      <ShopByCategory />
      <TrustBenefits />
      <ProductList category={category} params="homepage" />
      <FeaturedFinds />
    </div>
  );
};

export default Homepage;
