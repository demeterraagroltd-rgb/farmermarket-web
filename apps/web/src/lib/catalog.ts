// Shared shape for GET /v1/catalog/products, read by both the marketplace
// grid and the product detail page. `CatalogService.listPublishedProducts`
// returns the raw kobo/UUID columns *and* the naira/name fields alongside
// them (kept for the Flutter app's existing parser) — this reads the naira
// side, since that's what a plain number formatter wants.
export interface Product {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  price: number;
  discountPrice: number | null;
  unit: string;
  category: string;
  brand: string;
  isAvailable: boolean;
  stockQuantity: number;
}

export interface Category {
  id: string;
  name: string;
}

/** The price a buyer actually pays — the discount price when one is set. */
export function effectivePrice(p: Product): number {
  return p.discountPrice ?? p.price;
}

export async function fetchProduct(id: string): Promise<Product | null> {
  const base = process.env.NEXT_PUBLIC_API_URL;
  const res = await fetch(`${base}/v1/catalog/products`);
  if (!res.ok) throw new Error("Failed to load the product catalog.");
  const products = (await res.json()) as Product[];
  return products.find((p) => p.id === id) ?? null;
}
