import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

const campaigns = [
  {
    label: "HOME REFRESH EVENT",
    headline: "Give your space a fresh start.",
    action: "Shop the home edit",
    href: "/products?category=home-living",
    image: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1200&q=85",
    imageAlt: "Warm, styled living room with carefully selected home furnishings",
    theme: "home",
  },
  {
    label: "EVERYDAY TECH PICKS",
    headline: "Small upgrades. Big difference.",
    action: "Explore tech essentials",
    href: "/products?category=electrical-lighting",
    image: "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?auto=format&fit=crop&w=1200&q=85",
    imageAlt: "Modern laptop and workspace setup",
    theme: "tech",
  },
];

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
        </div>
      </div>
    </section>
  );
}
