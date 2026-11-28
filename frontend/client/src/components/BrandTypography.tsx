import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type BrandTypographyVariant = "display" | "heading" | "body" | "label" | "caption";
type BrandTypographyFamily = "aftika" | "aftika-soft";
type BrandTypographyWeight = 200 | 300 | 400 | 600 | 700 | 800 | 900;

type BrandTypographyProps<T extends ElementType> = {
  as?: T;
  variant?: BrandTypographyVariant;
  family?: BrandTypographyFamily;
  weight?: BrandTypographyWeight;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "color">;

const variantFamilies: Record<BrandTypographyVariant, BrandTypographyFamily> = {
  display: "aftika-soft",
  heading: "aftika-soft",
  body: "aftika",
  label: "aftika",
  caption: "aftika",
};

export default function BrandTypography<T extends ElementType = "p">({
  as,
  variant = "body",
  family,
  weight,
  className,
  children,
  style,
  ...props
}: BrandTypographyProps<T>) {
  const Component = (as ?? "p") as ElementType;
  const selectedFamily = family ?? variantFamilies[variant];
  const classes = [
    "brand-typography",
    `brand-typography--${variant}`,
    `brand-typography--${selectedFamily}`,
    className,
  ].filter(Boolean).join(" ");

  return (
    <Component
      {...props}
      className={classes}
      style={{ ...style, ...(weight ? { fontWeight: weight } : {}) }}
    >
      {children}
    </Component>
  );
}
