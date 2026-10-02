import { koboToNaira } from "@farmermarket/core";
import { bundles, products } from "@farmermarket/db";

export type BundleComponent = { product: typeof products.$inferSelect; quantity: number };

export function describeBundle(bundle: typeof bundles.$inferSelect, components: BundleComponent[]) {
  const regularKobo = components.reduce((sum, { product, quantity }) => sum + (product.discountPriceKobo ?? product.priceKobo) * BigInt(quantity), 0n);
  const price = bundle.bundlePriceKobo;
  const savingsKobo = price === null ? 0n : regularKobo - price;
  const complete = components.length > 0 && bundle.missingProducts.length === 0;
  const ready = complete && !!bundle.imageUrl && price !== null && price > 0n && price <= regularKobo;
  const availableQuantity = complete ? Math.min(...components.map(({ product, quantity }) =>
    product.status === "published" && product.isAvailable ? Math.max(0, Math.floor(product.stockQuantity / quantity)) : 0)) : 0;
  return {
    id: bundle.id, name: bundle.name, slug: bundle.slug, description: bundle.description,
    imageUrl: bundle.imageUrl, category: bundle.category, featured: bundle.featured, active: bundle.active,
    missingProducts: bundle.missingProducts, pricingNote: bundle.pricingNote,
    regularPrice: koboToNaira(regularKobo), bundlePrice: price === null ? null : koboToNaira(price),
    savings: koboToNaira(savingsKobo), savingsPercent: regularKobo === 0n ? 0 : Number(savingsKobo * 10000n / regularKobo) / 100,
    availableQuantity, isAvailable: bundle.active && ready && availableQuantity > 0,
    stockStatus: !ready ? "incomplete" : availableQuantity > 0 ? "in_stock" : "out_of_stock",
    ready, itemCount: components.reduce((sum, item) => sum + item.quantity, 0),
    items: components.map(({ product, quantity }) => ({ productId: product.id, quantity,
      name: product.name, imageUrl: product.imageUrl, unit: product.unit,
      price: koboToNaira(product.discountPriceKobo ?? product.priceKobo), stockQuantity: product.stockQuantity,
      status: product.status, isAvailable: product.isAvailable })),
  };
}
