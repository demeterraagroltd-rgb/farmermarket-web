import { addToCart } from "./cart";

export interface BundleItem {
  productId: string; quantity: number; name: string; imageUrl: string; unit: string; price: number;
  stockQuantity: number; status: string; isAvailable: boolean;
}
export interface Bundle {
  id: string; name: string; slug: string; description: string; imageUrl: string | null; category: string;
  bundlePrice: number | null; regularPrice: number; savings: number; savingsPercent: number;
  availableQuantity: number; isAvailable: boolean; stockStatus: string; itemCount: number;
  active: boolean; featured: boolean; ready: boolean; missingProducts: string[]; pricingNote: string; items: BundleItem[];
}

export async function fetchBundles(signal?: AbortSignal): Promise<Bundle[]> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/catalog/bundles`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("We couldn't load the bundles. Please try again.");
  return response.json();
}

export function addBundleToCart(bundle: Bundle, quantity = 1) {
  if (!bundle.isAvailable || !bundle.imageUrl || bundle.bundlePrice === null || quantity > bundle.availableQuantity) return false;
  addToCart({ id: bundle.id, kind: "bundle", slug: bundle.slug, name: bundle.name, imageUrl: bundle.imageUrl,
    unit: `Bundle · ${bundle.itemCount} items`, price: bundle.bundlePrice }, quantity);
  return true;
}
