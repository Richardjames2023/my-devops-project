"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";

const slides = [
  {
    eyebrow: "KITCHEN & HOME APPLIANCES",
    title: "Smart Appliances for Modern Living",
    description:
      "Discover practical kitchen essentials and home appliances designed to make everyday living easier.",
    image: "https://cdn.shopify.com/s/files/1/0478/5989/2377/files/small-kitchen-appliances-everyday-cooking-guide.jpg?v=1777131849",
    imageAlt: "Air fryer, blender and toaster arranged on a modern kitchen counter",
    primaryLabel: "Shop Appliances",
  },
  {
    eyebrow: "ELECTRONICS & GADGETS",
    title: "Bring Your Everyday Tech Together",
    description:
      "Explore laptops, headphones, speakers, smartwatches and useful everyday electronics.",
    image: "https://images.unsplash.com/photo-1590643924142-b1b492f1dddc?auto=format&fit=crop&w=1800&q=85",
    imageAlt: "Laptop, camera, smartwatch and electronics accessories arranged on a tabletop",
    primaryLabel: "Shop Electronics",
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
            key={slide.eyebrow}
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

        <div className="hero-slider__content" key={activeSlide.eyebrow}>
          <span className="hero-slider__eyebrow">
            <span className="hero-slider__eyebrow-mark" />
            {activeSlide.eyebrow}
          </span>
          <h1 className="hero-slider__title">{activeSlide.title}</h1>
          <p className="hero-slider__description">{activeSlide.description}</p>
          <div className="hero-slider__actions">
            <Link href="/products" className="hero-slider__button hero-slider__button--primary">
              {activeSlide.primaryLabel}
              <ArrowUpRight aria-hidden="true" size={19} strokeWidth={2.5} />
            </Link>
            <Link href="/products" className="hero-slider__button hero-slider__button--secondary">
              Explore Products
            </Link>
          </div>
        </div>

        <button type="button" className="hero-slider__arrow hero-slider__arrow--previous" onClick={goPrevious} aria-label="Previous featured collection">
          <ArrowLeft size={21} strokeWidth={2.4} />
        </button>
        <button type="button" className="hero-slider__arrow hero-slider__arrow--next" onClick={goNext} aria-label="Next featured collection">
          <ArrowRight size={21} strokeWidth={2.4} />
        </button>

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
      </div>
    </section>
  );
}
