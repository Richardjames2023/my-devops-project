"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";

type HeroCallToAction = {
  label: string;
  href: string;
};

type HeroSlide = {
  eyebrow?: string;
  title?: string;
  description?: string;
  badge?: {
    value: string;
    label: string;
  };
  image: string;
  imageAlt: string;
  primaryCta?: HeroCallToAction;
  secondaryCta?: HeroCallToAction;
};

const slides: HeroSlide[] = [
  {
    eyebrow: "KITCHEN & HOME APPLIANCES",
    title: "Make Every Day in the Kitchen Easier",
    description:
      "Spend less time on the prep and more time enjoying the moment. Find the appliances that make busy mornings, quick meals and family dinners feel effortless.",
    badge: { value: "50%", label: "OFF" },
    image: "https://cdn.shopify.com/s/files/1/0478/5989/2377/files/small-kitchen-appliances-everyday-cooking-guide.jpg?v=1777131849",
    imageAlt: "Air fryer, blender, toaster and coffee maker arranged on a modern kitchen counter",
    primaryCta: {
      label: "Shop Appliances",
      href: "/products",
    },
  },
  {
    eyebrow: "ELECTRICAL & EVERYDAY TECH",
    title: "A Smarter Setup for Everything You Do",
    description:
      "From getting work done to switching off at the end of the day, discover useful tech that keeps you connected, productive and entertained.",
    badge: { value: "NEW", label: "IN" },
    image: "https://images.unsplash.com/photo-1590643924142-b1b492f1dddc?auto=format&fit=crop&w=1800&q=85",
    imageAlt: "Laptop, camera, smartwatch and electronics accessories arranged on a tabletop",
    primaryCta: {
      label: "Shop Electronics",
      href: "/products",
    },
    secondaryCta: {
      label: "Explore Categories",
      href: "/products",
    },
  },
  {
    eyebrow: "KITCHEN & DINING",
    title: "Bring More Joy to the Everyday",
    description:
      "Set the table, make something delicious and make yourself at home with practical kitchen favourites chosen for everyday living.",
    badge: { value: "TOP", label: "PICKS" },
    image: "https://www.premiumhomesource.com/cdn/shop/files/2001-04_henck-zwil_enfingy_appliances-001_2.jpg?v=1738588042&width=1000",
    imageAlt: "Coordinated black blender, toaster and electric kettle displayed together",
    secondaryCta: {
      label: "Explore Products",
      href: "/products",
    },
  },
];

const AUTOPLAY_INTERVAL = 6000;

export default function HeroSlider() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const goTo = useCallback((index: number) => {
    setActiveIndex((index + slides.length) % slides.length);
  }, []);

  const goNext = useCallback(() => {
    setActiveIndex((current) => (current + 1) % slides.length);
  }, []);

  const goPrevious = useCallback(() => {
    setActiveIndex((current) => (current - 1 + slides.length) % slides.length);
  }, []);

  useEffect(() => {
    if (isPaused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const interval = window.setInterval(goNext, AUTOPLAY_INTERVAL);
    return () => window.clearInterval(interval);
  }, [goNext, isPaused]);

  const activeSlide = slides[activeIndex];

  return (
    <section
      aria-label="Featured shopping collections"
      aria-roledescription="carousel"
      className="hero-slider"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocusCapture={() => setIsPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsPaused(false);
        }
      }}
    >
      <div className="hero-slider__stage">
        {slides.map((slide, index) => (
          <div
            key={slide.eyebrow ?? slide.title ?? `slide-${index}`}
            className={`hero-slider__visual ${index === activeIndex ? "is-active" : ""}`}
            aria-hidden={index !== activeIndex}
          >
            <Image
              src={slide.image}
              alt={slide.imageAlt}
              fill
              unoptimized
              priority={index === 0}
              sizes="(max-width: 768px) 100vw, 1280px"
              className="hero-slider__image"
            />
          </div>
        ))}

        <div className="hero-slider__wash" />

        <div
          className="hero-slider__content"
          key={activeSlide.eyebrow ?? activeSlide.title ?? activeIndex}
        >
          {activeSlide.eyebrow && (
            <span className="hero-slider__eyebrow">
              <span className="hero-slider__eyebrow-mark" />
              {activeSlide.eyebrow}
            </span>
          )}

          {activeSlide.title && (
            <h1 className="hero-slider__title">{activeSlide.title}</h1>
          )}

          {activeSlide.description && (
            <p className="hero-slider__description">{activeSlide.description}</p>
          )}

          {(activeSlide.primaryCta || activeSlide.secondaryCta) && (
            <div className="hero-slider__actions">
              {activeSlide.primaryCta && (
                <Link
                  href={activeSlide.primaryCta.href}
                  className="hero-slider__button hero-slider__button--primary"
                >
                  {activeSlide.primaryCta.label}
                  <ArrowUpRight aria-hidden="true" size={19} strokeWidth={2.5} />
                </Link>
              )}

              {activeSlide.secondaryCta && (
                <Link
                  href={activeSlide.secondaryCta.href}
                  className="hero-slider__button hero-slider__button--secondary"
                >
                  {activeSlide.secondaryCta.label}
                </Link>
              )}
            </div>
          )}
        </div>

        {activeSlide.badge && (
          <div className="hero-slider__badge" aria-label={`${activeSlide.badge.value} ${activeSlide.badge.label}`}>
            <span className="hero-slider__badge-value">{activeSlide.badge.value}</span>
            <span className="hero-slider__badge-label">{activeSlide.badge.label}</span>
          </div>
        )}

        <button
          type="button"
          className="hero-slider__arrow hero-slider__arrow--previous"
          onClick={goPrevious}
          aria-label="Previous featured collection"
        >
          <ArrowLeft size={21} strokeWidth={2.4} />
        </button>
        <button
          type="button"
          className="hero-slider__arrow hero-slider__arrow--next"
          onClick={goNext}
          aria-label="Next featured collection"
        >
          <ArrowRight size={21} strokeWidth={2.4} />
        </button>

        <div className="hero-slider__pagination" aria-label="Choose featured collection">
          {slides.map((slide, index) => (
            <button
              key={slide.eyebrow ?? slide.title ?? `slide-${index}`}
              type="button"
              onClick={() => goTo(index)}
              className={`hero-slider__dot ${index === activeIndex ? "is-active" : ""}`}
              aria-label={`Show slide ${index + 1}: ${(slide.eyebrow ?? slide.title ?? "featured collection").toLowerCase()}`}
              aria-current={index === activeIndex ? "true" : undefined}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
