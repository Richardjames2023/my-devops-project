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
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  primaryCta: HeroCallToAction;
};

const slides: HeroSlide[] = [
  {
    eyebrow: "EVERYDAY STYLE",
    title: "Find the Pieces That Feel Like You.",
    description:
      "Refresh your everyday wardrobe with easy-to-wear T-shirts, versatile layers and styles you can make your own.",
    image: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1800&q=85",
    imageAlt: "Minimal everyday T-shirt styled for a clean casual wardrobe",
    primaryCta: {
      label: "Shop T-shirts",
      href: "/products?category=t-shirts",
    },
  },
  {
    eyebrow: "FOOTWEAR",
    title: "Make Every Step Count.",
    description:
      "Find everyday sneakers that bring comfort and confidence to the places your day takes you.",
    image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1800&q=85",
    imageAlt: "Red athletic sneaker photographed against a clean background",
    primaryCta: {
      label: "Explore Shoes",
      href: "/products?category=shoes",
    },
  },
  {
    eyebrow: "BAGS & ACCESSORIES",
    title: "Take Your Essentials Wherever Life Goes.",
    description:
      "Bring your everyday look together with practical finishing touches and carry-all essentials.",
    image: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1800&q=85",
    imageAlt: "Everyday backpack photographed as a lifestyle accessory",
    primaryCta: {
      label: "Shop Bags",
      href: "/products?category=bags",
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
