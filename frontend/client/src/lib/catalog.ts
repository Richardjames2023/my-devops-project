const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000/api/v1").replace(/\/+$/, "");

export type CatalogImage = { id: string; url: string; altText: string | null; sortOrder: number; isPrimary: boolean };
export type CatalogVariant = { id: string; name: string; price: string; availableQuantity: number; inStock: boolean };
export type CatalogProduct = {
  id: string; name: string; slug: string; description: string | null; basePrice: string;
  priceFrom: string | null; priceTo: string | null; inStock: boolean; hasWarranty: boolean;
  warrantyDuration: number | null; warrantyTerms: string | null;
  category: { id: string; name: string; slug: string };
  images: CatalogImage[]; variants: CatalogVariant[]; createdAt: string; updatedAt: string;
};
export type CatalogCategory = { id: string; name: string; slug: string; description: string | null; productCount: number };
export type ProductListResponse = { message: string; items: CatalogProduct[]; pagination: { page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean } };
type CategoryListResponse = { message: string; categories: CatalogCategory[] };

export type CatalogQuery = { q?: string; category?: string; minPrice?: string; maxPrice?: string; sort?: "newest" | "price_asc" | "price_desc" | "name_asc"; page?: number; limit?: number };

async function getPublic<T>(path: string): Promise<T> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { next: { revalidate: 60 } });
    if (!response.ok) throw new Error(`Catalogue request failed (${response.status})`);
    return (await response.json()) as T;
  } catch {
    throw new Error("The shop catalogue is temporarily unavailable. Please try again shortly.");
  }
}

export async function getProducts(query: CatalogQuery = {}): Promise<ProductListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "" && value !== "all") params.set(key, String(value));
  }
  return getPublic<ProductListResponse>(`/products${params.size ? `?${params.toString()}` : ""}`);
}

export async function getCategories(): Promise<CatalogCategory[]> {
  const response = await getPublic<CategoryListResponse>("/categories");
  return response.categories;
}

export function formatNaira(value: string | number): string {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return "Price unavailable";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(amount);
}
