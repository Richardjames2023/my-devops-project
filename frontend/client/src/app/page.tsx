import ProductList from "@/components/ProductList";
import Image from "next/image";

const Homepage = async ({
  searchParams,
}: {
  searchParams: Promise<{ category: string }>;
}) => {
  const category = (await searchParams).category;
  return (
    <div className="">
      <div className="relative mb-8 aspect-[2/1] bg-white sm:mb-12 sm:aspect-[3/1]">
        <Image src="/featured.png" alt="Featured Product" fill className="object-contain sm:object-cover" />
      </div>
      <ProductList category={category} params="homepage"/>
    </div>
  );
};

export default Homepage;
