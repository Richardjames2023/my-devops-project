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
    image: "/hero/hero-kitchen.jpg",
    imageAlt:
      "Air fryer, blender, electric kettle and toaster arranged on a bright modern kitchen counter",
    primaryLabel: "Shop Appliances",
    secondaryLabel: "Explore Products",
  },
  {
    eyebrow: "ELECTRONICS & GADGETS",
    title: "Bring Your Everyday Tech Together",
    description:
      "Explore laptops, headphones, speakers, smartwatches and useful everyday electronics.",
    image: "/hero/hero-electronics.jpg",
    imageAlt:
      "Laptop, headphones, speaker, smartwatch, earbuds and camera arranged on a modern tabletop",
    primaryLabel: "Shop Electronics",
    secondaryLabel: "Explore Products",
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
            key={slide.image}
            className={`hero-slider__visual ${index === activeIndex ? "is-active" : ""}`}
            aria-hidden={index !== activeIndex}
          >
            <Image
              src={slide.image}
              alt={slide.imageAlt}
              fill
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
              {activeSlide.secondaryLabel}
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
