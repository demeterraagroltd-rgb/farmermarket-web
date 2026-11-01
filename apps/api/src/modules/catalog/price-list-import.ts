import { eq } from "drizzle-orm";
import { calculateCatalogPrice, nairaToKobo } from "@farmermarket/core";
import { brands, categories, inventoryMovements, products, type Db } from "@farmermarket/db";
import { lockCatalogPricing } from "./catalog-pricing";
import { PRICE_LIST_PRODUCTS } from "./price-list-data";
import { MARKET_PRICE_PRODUCTS } from "./market-price-data";
export { PRICE_LIST_PRODUCTS } from "./price-list-data";

export async function importMarketPrices(db: Db, imageBaseUrl: string, staffId: string) {
  const origin = new URL(imageBaseUrl).origin;
  return db.transaction(async tx => {
    await lockCatalogPricing(tx);
    let added = 0, skipped = 0, pending = 0;
    for (const item of MARKET_PRICE_PRODUCTS) {
      if (item.retailPriceNaira === null) { pending++; continue; }
      const [existing] = await tx.select({ id: products.id }).from(products).where(eq(products.sku, item.sku));
      if (existing) { skipped++; continue; }
      await tx.insert(categories).values({ name: item.category }).onConflictDoNothing();
      await tx.insert(brands).values({ name: item.brand }).onConflictDoNothing();
      const [category] = await tx.select().from(categories).where(eq(categories.name, item.category));
      const [brand] = await tx.select().from(brands).where(eq(brands.name, item.brand));
      const [product] = await tx.insert(products).values({ sku: item.sku, name: item.name, description: item.name, unit: item.unit,
        imageUrl: `${origin}/catalog/studio/${item.imageFile}`, priceKobo: nairaToKobo(item.retailPriceNaira),
        pricingMode: "manual", categoryId: category.id, brandId: brand.id, status: "draft", stockQuantity: 0,
        tags: ["online-retail-nov-2026", "needs-product-review"], createdBy: staffId }).returning();
      await tx.insert(inventoryMovements).values({ productId: product.id, productName: product.name, kind: "opening",
        availableDelta: 0, availableBefore: 0, availableAfter: 0, reason: "Online retail price draft; stock not supplied",
        actorStaffId: staffId, eventKey: `opening:${product.id}` });
      added++;
    }
    return { added, skipped, pending };
  });
}

/** Idempotent import: repeat runs never overwrite staff edits or invent stock. */
export async function importPriceList(db: Db, imageBaseUrl: string, staffId: string) {
  const origin = new URL(imageBaseUrl).origin;
  return db.transaction(async (tx) => {
    const rates = await lockCatalogPricing(tx);
    let added = 0;
    let skipped = 0;
    for (const item of PRICE_LIST_PRODUCTS) {
      const [existing] = await tx.select({ id: products.id }).from(products).where(eq(products.sku, item.sku));
      if (existing) { skipped++; continue; }
      await tx.insert(categories).values({ name: item.category }).onConflictDoNothing();
      await tx.insert(brands).values({ name: item.brand }).onConflictDoNothing();
      const [category] = await tx.select().from(categories).where(eq(categories.name, item.category));
      const [brand] = await tx.select().from(brands).where(eq(brands.name, item.brand));
      const costPriceKobo = nairaToKobo(item.costPriceNaira);
      const [product] = await tx.insert(products).values({
        sku: item.sku, name: item.name, unit: item.unit,
        description: `${item.sourceProduct}${item.sourceSize === "—" ? "" : ` — ${item.sourceSize}`}`,
        imageUrl: `${origin}/catalog/${item.imageFile ? `studio/${item.imageFile}` : "product-placeholder.svg"}`,
        costPriceKobo, pricingMode: "percentage",
        priceKobo: calculateCatalogPrice(costPriceKobo, rates).priceKobo,
        categoryId: category.id, brandId: brand.id, stockQuantity: 0, status: "draft", createdBy: staffId,
        tags: ["price-list-nov-2026", ...(item.reviewNote ? ["needs-product-review"] : [])],
      }).returning();
      await tx.insert(inventoryMovements).values({ productId: product.id, productName: product.name, kind: "opening",
        availableDelta: 0, availableBefore: 0, availableAfter: 0, reason: "Price-list import; physical stock not supplied",
        actorStaffId: staffId, eventKey: `opening:${product.id}` });
      added++;
    }
    return { added, skipped };
  });
}
