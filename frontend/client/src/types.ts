import { z } from "zod";

export type ProductType = {
  id: string | number;
  sku: string;
  name: string;
  brand: string;
  categoryName: string;
  categorySlug: string;
  shortDescription: string;
  description: string;
  price: number;
  /** Optional merchandising fields supplied by the public catalogue API when available. */
  compareAtPrice?: number | null;
  discountPercent?: number | null;
  reviewSummary?: {
    averageRating: number | null;
    totalReviews: number;
  } | null;
  soldCount?: number | null;
  availableQuantity?: number | null;
  sizes: string[];
  colors: string[];
  tags: string[];
  stockStatus: "in-stock" | "low-stock" | "out-of-stock";
  images: Record<string, string>;
};

export type ProductsType = ProductType[];

export type CartItemType = ProductType & {
  quantity: number;
  selectedSize: string;
  selectedColor: string;
};

export type CartItemsType = CartItemType[];

export const shippingFormSchema = z.object({
  name: z.string().min(2, "Enter the recipient's full name."),
  email: z.email("Enter a valid email address."),
  phone: z.string().trim().min(7, "Enter a valid phone number.").max(18, "Phone number is too long.").regex(/^[+\d\s()-]+$/, "Enter a valid phone number."),
  flatSuite: z.string().optional(),
  address: z.string().min(5, "Enter the house number and street."),
  landmark: z.string().optional(),
  area: z.string().min(2, "Choose or enter your area."),
  city: z.string().min(2, "Town or city is required."),
  state: z.string().min(2, "Select your state."),
  saveAddress: z.boolean().optional(),
  addressLabel: z.string().optional(),
  deliverySpeed: z.enum(["standard", "express"]),
  deliveryNote: z.string().optional(),
});

export type ShippingFormInputs = z.infer<typeof shippingFormSchema>;

export const paymentFormSchema = z.object({
  cardHolder: z.string().min(1, "Card holder is required!"),
  cardNumber: z
    .string()
    .min(16, "Card Number is required!")
    .max(16, "Card Number is required!"),
  expirationDate: z
    .string()
    .regex(
      /^(0[1-9]|1[0-2])\/\d{2}$/,
      "Expiration date must be in MM/YY format!"
    ),
  cvv: z.string().min(3, "CVV is required!").max(3, "CVV is required!"),
});

export type PaymentFormInputs = z.infer<typeof paymentFormSchema>;

export type CartStoreStateType = {
  cart: CartItemsType;
  hasHydrated: boolean;
};

export type CartStoreActionsType = {
  addToCart: (product: CartItemType) => void;
  removeFromCart: (product: CartItemType) => void;
  updateQuantity: (product: CartItemType, quantity: number) => void;
  clearCart: () => void;
};
