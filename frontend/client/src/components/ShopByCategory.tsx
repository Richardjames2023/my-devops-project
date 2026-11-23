import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { categories, products } from "@/lib/catalogue";

const categoryDescriptions: Record<string, string> = {
  "home-living": "Storage, bedding & everyday home essentials",
  "garden-outdoor": "Plant care, outdoor living & garden finds",
  "electrical-lighting": "Lighting and useful electrical essentials",
  "kitchen-dining": "Cookware, tableware & food storage",
  "tools-hardware": "Tools for home fixes and DIY projects",
  "bags-luggage": "Everyday bags and travel essentials",
  "personal-care": "Grooming and personal-care essentials",
  "office-stationery": "Desk, work and study essentials",
  "home-decor": "Finishing touches for your space",
};

export default function ShopByCategory() {
  const categoryCards = categories.map((category) => {
    const representativeProduct = products.find(
      (product) => product.categorySlug === category.slug,
    );

    return {
      ...category,
      description: categoryDescriptions[category.slug],
      image: representativeProduct?.images.default,
    };
  });

  return (
    <section className="shop-categories" aria-labelledby="shop-categories-title">
      <div className="shop-categories__heading">
        <div>
          <p className="shop-categories__eyebrow">FIND WHAT YOU NEED</p>
          <h2 id="shop-categories-title">Shop by Category</h2>
          <p className="shop-categories__intro">
            Browse our departments and go straight to the things you came for.
          </p>
        </div>
        <Link href="/products" className="shop-categories__view-all">
          View all products <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </div>

      <div className="shop-categories__grid">
        {categoryCards.map((category) => (
          <Link
            key={category.slug}
            href={`/products?category=${category.slug}`}
            className="shop-categories__card"
          >
            <span className="shop-categories__image">
              {category.image ? (
                <Image
                  src={category.image}
                  alt=""
                  fill
                  unoptimized
                  sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 18vw"
                />
              ) : null}
            </span>
            <span className="shop-categories__copy">
              <span className="shop-categories__name">{category.name}</span>
              <span className="shop-categories__description">
                {category.description}
              </span>
              <span className="shop-categories__browse">
                Browse category <ArrowUpRight size={14} aria-hidden="true" />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
