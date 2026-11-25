import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { products } from "@/lib/catalogue";

const campaigns = [
  {
    label: "NEW IN",
    headline: "Give your space a fresh start.",
    action: "Shop the home edit",
    href: "/products?category=home-living",
    image: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1200&q=85",
    imageAlt: "Warm, styled living room with carefully selected home furnishings",
    theme: "home",
  },
];

const promotionalProductIds = [
  "demo-electrical-001",
  "demo-kitchen-001",
  "demo-tools-001",
  "demo-bags-001",
];

const promotionalProducts = promotionalProductIds
  .map((id) => products.find((product) => product.id === id))
  .filter((product) => product && product.compareAtPrice && product.compareAtPrice > product.price);

const getDiscount = (price: number, compareAtPrice: number) =>
  Math.round(((compareAtPrice - price) / compareAtPrice) * 100);

export default function FeaturedFinds() {
  return (
    <section className="featured-finds" aria-label="Featured promotional campaigns">
      <div className="featured-finds__inner">
        <div className="featured-finds__campaigns">
          {campaigns.map((campaign) => (
            <Link
              href={campaign.href}
              className={`featured-finds__campaign featured-finds__campaign--${campaign.theme}`}
              key={campaign.label}
            >
              <Image
                className="featured-finds__campaign-photo"
                src={campaign.image}
                alt={campaign.imageAlt}
                fill
                unoptimized
                sizes="(max-width: 640px) 100vw, 50vw"
              />
              <span className="featured-finds__campaign-shade" aria-hidden="true" />
              <div className="featured-finds__campaign-copy">
                <span className="featured-finds__campaign-label">{campaign.label}</span>
                <h2>{campaign.headline}</h2>
                <strong>{campaign.action} <ArrowUpRight size={15} aria-hidden="true" /></strong>
              </div>
            </Link>
          ))}

          <div className="featured-finds__campaign featured-finds__campaign--tech" aria-label="Rotating product promotion">
            <span className="featured-finds__campaign-shade" aria-hidden="true" />
            <div className="featured-finds__campaign-copy featured-finds__campaign-copy--tech">
              <span className="featured-finds__campaign-label">LIMITED-TIME DEALS</span>
              <h2>Upgrade your everyday.</h2>
              <p>Selected essentials at special prices.</p>
              <Link href="/products?category=electrical-lighting" className="featured-finds__campaign-cta">
                Shop the offers <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <div className="featured-finds__deal-stage" aria-label="Featured discounted products">
              {promotionalProducts.map((product, index) => {
                const discount = getDiscount(product.price, product.compareAtPrice!);
                return (
                  <Link
                    href={`/products/${product.id}`}
                    className="featured-finds__deal-slide"
                    style={{ "--deal-index": index, "--deal-count": promotionalProducts.length } as React.CSSProperties}
                    key={product.id}
                    aria-label={`${product.name}, ${discount}% off`}
                  >
                    <span className="featured-finds__deal-discount">{discount}% OFF</span>
                    <span className="featured-finds__deal-image">
                      <Image src={product.images.default} alt="" fill unoptimized sizes="(max-width: 640px) 35vw, 180px" />
                    </span>
                    <span className="featured-finds__deal-name">{product.name}</span>
                    <span className="featured-finds__deal-prices">
                      <strong>₦{product.price.toLocaleString("en-NG")}</strong>
                      <del>₦{product.compareAtPrice!.toLocaleString("en-NG")}</del>
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
