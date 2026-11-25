import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { products } from "@/lib/catalogue";

const campaigns = [
  {
    label: "THE HOME REFRESH",
    headline: "A fresh feel for every room",
    action: "Shop the collection",
    href: "/products?category=home-living",
    image: products.find((product) => product.id === "demo-home-001")?.images.default,
    imageAlt: "Woven home storage and living essentials",
    theme: "home",
  },
  {
    label: "WORK & TECH PICKS",
    headline: "Little upgrades. Better workdays.",
    action: "Explore the picks",
    href: "/products?category=office-stationery",
    image: products.find((product) => product.id === "demo-office-001")?.images.default,
    imageAlt: "Everyday workspace and office essentials",
    theme: "work",
  },
];

const spotlightProducts = [
  "demo-home-001",
  "demo-garden-001",
  "demo-kitchen-001",
  "demo-tools-001",
  "demo-bags-001",
  "demo-care-001",
  "demo-office-001",
  "demo-decor-001",
].map((id) => products.find((product) => product.id === id)).filter((product) => product !== undefined);

export default function FeaturedFinds() {
  return (
    <section className="featured-finds" aria-label="Promotional banners and featured products">
      <div className="featured-finds__inner">
        <div className="featured-finds__campaigns">
          {campaigns.map((campaign) => (
            <Link
              href={campaign.href}
              className={`featured-finds__campaign featured-finds__campaign--${campaign.theme}`}
              key={campaign.label}
            >
              <div className="featured-finds__campaign-copy">
                <span className="featured-finds__campaign-label">{campaign.label}</span>
                <h2>{campaign.headline}</h2>
                <strong>{campaign.action} <ArrowUpRight size={14} aria-hidden="true" /></strong>
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
            <p>Find useful things for every day.</p>
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
                    sizes="64px"
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
