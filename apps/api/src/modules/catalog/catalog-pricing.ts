import { BadRequestException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { calculateCatalogPrice, DEFAULT_CATALOG_PRICING, type CatalogPricingRates } from "@farmermarket/core";
import { config, products, type Db, type Tx } from "@farmermarket/db";

export const PRICING_KEY = "catalog_pricing";

/** All catalog writes acquire this lock before product locks. This prevents a
 * cost edit/import from writing a stale price during a global rate change. */
export async function lockCatalogPricing(tx: Tx): Promise<CatalogPricingRates> {
  const [row] = await tx.select().from(config).where(eq(config.key, PRICING_KEY)).for("update");
  if (!row) throw new BadRequestException("Catalog pricing migration has not been applied");
  return row.value as CatalogPricingRates;
}

export async function readCatalogPricing(db: Db): Promise<CatalogPricingRates> {
  const [row] = await db.select().from(config).where(eq(config.key, PRICING_KEY));
  return (row?.value as CatalogPricingRates | undefined) ?? DEFAULT_CATALOG_PRICING;
}

export async function saveCatalogPricing(db: Db, rates: CatalogPricingRates) {
  return db.transaction(async (tx) => {
    await lockCatalogPricing(tx);
    const rows = await tx.select().from(products).where(eq(products.pricingMode, "percentage")).orderBy(products.id).for("update");
    for (const product of rows) {
      if (!product.costPriceKobo || product.costPriceKobo <= 0n) throw new BadRequestException(`Missing cost for ${product.name}`);
      await tx.update(products).set({ priceKobo: calculateCatalogPrice(product.costPriceKobo, rates).priceKobo,
        discountPriceKobo: null, updatedAt: new Date() }).where(eq(products.id, product.id));
    }
    await tx.update(config).set({ value: rates, updatedAt: new Date() }).where(eq(config.key, PRICING_KEY));
    return { ...rates, updatedProducts: rows.length };
  });
}
