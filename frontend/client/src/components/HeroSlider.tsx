"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Pause, Play } from "lucide-react";

type HeroCallToAction = {
  label: string;
  href: string;
};

type HeroSlide = {
  eyebrow: string;
  badgeText?: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  primaryCta: HeroCallToAction;
  secondaryCta?: HeroCallToAction;
};

const slides: HeroSlide[] = [
  {
    eyebrow: "EVERYDAY ESSENTIALS",
    title: "Everything You Need, All in One Place.",
    description:
      "Discover useful finds for your home, kitchen, garden and everyday life. Shop practical essentials that make each day a little easier.",
    image: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1800&q=85",
    imageAlt: "Warm, thoughtfully furnished modern living space",
    primaryCta: {
      label: "Explore Products",
      href: "/products",
    },
    secondaryCta: {
      label: "Shop Home & Living",
      href: "/products?category=home-living",
    },
  },
  {
    eyebrow: "KITCHEN & DINING",
    badgeText: "Everyday Favourites",
    title: "Make More of Every Moment at Home.",
    description:
      "Find practical kitchen tools, cookware and dining essentials that help make preparing and sharing meals easier.",
    image: "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=1800&q=85",
    imageAlt: "Bright, organised modern kitchen with everyday cooking essentials",
    primaryCta: {
      label: "Shop Kitchen & Dining",
      href: "/products?category=kitchen-dining",
    },
  },
  {
    eyebrow: "GARDEN & OUTDOOR",
    title: "Make Room for the Outdoors.",
    description:
      "Explore useful gardening and outdoor essentials for caring for your plants and making more of your outdoor space.",
    image: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1800&q=85",
    imageAlt: "Green plants and gardening essentials in a bright outdoor space",
    primaryCta: {
      label: "Shop Garden & Outdoor",
      href: "/products?category=garden-outdoor",
    },
    secondaryCta: {
      label: "Explore All Products",
      href: "/products",
    },
  },
];

const AUTOPLAY_INTERVAL = 7000;

export default function HeroSlider() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isAutoplayEnabled, setIsAutoplayEnabled] = useState(true);

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
    if (
      !isAutoplayEnabled ||
      isPaused ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const interval = window.setInterval(goNext, AUTOPLAY_INTERVAL);
    return () => window.clearInterval(interval);
  }, [goNext, isAutoplayEnabled, isPaused]);

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
            key={slide.eyebrow}
            className={`hero-slider__visual ${index === activeIndex ? "is-active" : ""}`}
            aria-hidden={index !== activeIndex}
          >
            <Image
              src={slide.image}
              alt={index === activeIndex ? slide.imageAlt : ""}
              fill
              unoptimized
              priority={index === 0}
              sizes="(max-width: 768px) 100vw, 1400px"
              className="hero-slider__image"
            />
          </div>
        ))}

        <div className="hero-slider__wash" />

        <div
          className="hero-slider__content"
          key={activeSlide.eyebrow}
          aria-live="polite"
        >
          {activeSlide.badgeText ? (
            <span className="hero-slider__badge">{activeSlide.badgeText}</span>
          ) : null}
          <span className="hero-slider__eyebrow">
            <span className="hero-slider__eyebrow-mark" />
            {activeSlide.eyebrow}
          </span>
          <h1 className="hero-slider__title">{activeSlide.title}</h1>
          <p className="hero-slider__description">{activeSlide.description}</p>
          <div className="hero-slider__actions">
            <Link
              href={activeSlide.primaryCta.href}
              className="hero-slider__button hero-slider__button--primary"
            >
              {activeSlide.primaryCta.label}
              <ArrowUpRight aria-hidden="true" size={19} strokeWidth={2.5} />
            </Link>
            {activeSlide.secondaryCta ? (
              <Link
                href={activeSlide.secondaryCta.href}
                className="hero-slider__button hero-slider__button--secondary"
              >
                {activeSlide.secondaryCta.label}
              </Link>
            ) : null}
          </div>
        </div>

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

        <div className="hero-slider__controls">
          <div className="hero-slider__pagination" aria-label="Choose featured collection">
            {slides.map((slide, index) => (
              <button
                key={slide.eyebrow}
                type="button"
                onClick={() => goTo(index)}
                className={`hero-slider__dot ${index === activeIndex ? "is-active" : ""}`}
                aria-label={`Show slide ${index + 1}: ${slide.eyebrow.toLowerCase()}`}
                aria-current={index === activeIndex ? "true" : undefined}
              />
            ))}
          </div>
          <button
            type="button"
            className="hero-slider__autoplay"
            onClick={() => setIsAutoplayEnabled((enabled) => !enabled)}
            aria-label={isAutoplayEnabled ? "Pause automatic slide changes" : "Resume automatic slide changes"}
          >
            {isAutoplayEnabled ? <Pause size={13} /> : <Play size={13} />}
            <span>{isAutoplayEnabled ? "Pause" : "Play"}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
