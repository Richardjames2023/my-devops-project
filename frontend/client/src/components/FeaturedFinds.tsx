import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { products } from "@/lib/catalogue";

const campaigns = [
  {
    eyebrow: "HOME & LIVING",
    title: "Make room for what matters.",
    description: "Practical finds for a more organised home.",
    href: "/products?category=home-living",
    image: products.find((product) => product.categorySlug === "home-living")?.images.default,
    imageAlt: "Home and living product collection",
    tone: "warm",
  },
  {
    eyebrow: "WORK & EVERYDAY",
    title: "Make every day work better.",
    description: "Useful essentials for your everyday routine.",
    href: "/products?category=office-stationery",
    image: products.find((product) => product.categorySlug === "office-stationery")?.images.default,
    imageAlt: "Office and everyday essentials",
    tone: "cool",
  },
];

const spotlightProducts = products.slice(0, 8);

export default function FeaturedFinds() {
  return (
    <section className="featured-finds" aria-label="Featured finds and product discovery">
      <div className="featured-finds__inner">
        <div className="featured-finds__campaigns">
          {campaigns.map((campaign) => (
            <Link
              href={campaign.href}
              className={`featured-finds__campaign featured-finds__campaign--${campaign.tone}`}
              key={campaign.eyebrow}
            >
              <div className="featured-finds__campaign-copy">
                <span>{campaign.eyebrow}</span>
                <h2>{campaign.title}</h2>
                <p>{campaign.description}</p>
                <strong>Explore now <ArrowUpRight size={14} aria-hidden="true" /></strong>
              </div>
              {campaign.image ? (
                <div className="featured-finds__campaign-image">
                  <Image src={campaign.image} alt={campaign.imageAlt} fill unoptimized sizes="(max-width: 640px) 100vw, 50vw" />
                </div>
              ) : null}
            </Link>
          ))}
        </div>

        <div className="featured-finds__spotlight">
          <div className="featured-finds__spotlight-intro">
            <span>CLICKCLICKBUY FINDS</span>
            <h2>Everyday essentials</h2>
            <p>Useful things for home, work and everything in between.</p>
            <Link href="/products">Shop all <ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>

          <div className="featured-finds__products">
            {spotlightProducts.map((product) => (
              <Link href={`/products/${product.id}`} className="featured-finds__product" key={product.id}>
                <span className="featured-finds__product-name">{product.name}</span>
                <span className="featured-finds__product-image">
                  <Image
                    src={product.images.default}
                    alt={product.name}
                    fill
                    unoptimized
                    sizes="(max-width: 640px) 34vw, (max-width: 1024px) 18vw, 12vw"
                  />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
