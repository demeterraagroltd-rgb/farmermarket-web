import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { products, staff } from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { CatalogService } from "./catalog.service";
import { PRICE_LIST_PRODUCTS } from "./price-list-data";
import { catalogPricingSchema, createProductSchema } from "./dto/catalog.dto";
import { calculateCatalogPrice } from "@farmermarket/core";

describe("catalog pricing with actual PostgreSQL migrations", () => {
  let t: TestDb, catalog: CatalogService, actor: string;
  beforeAll(async () => {
    t = await createTestDb(); catalog = new CatalogService(t.db);
    const [person] = await t.db.insert(staff).values({ email: "pricing@test.com", passwordHash: "x", fullName: "Pricing Admin", role: "admin" }).returning();
    actor = person.id;
  }, 30000);
  afterAll(async () => t?.close());

  it("imports all 21 costs and totals exactly, without inventing stock or mismatching images", async () => {
    expect(await catalog.importPriceList("https://shop.example.com", actor)).toEqual({ added: 21, skipped: 0 });
    const rows = await catalog.listAllProducts();
    expect(rows).toHaveLength(21);
    let total = 0n;
    for (const item of PRICE_LIST_PRODUCTS) {
      const row = rows.find(p => p.sku === item.sku)!;
      expect(Number(row.priceKobo) / 100).toBe(item.expectedPriceNaira);
      expect(row.stockQuantity).toBe(0);
      expect(row.status).toBe("draft");
      total += row.priceKobo;
    }
    expect(total).toBe(80575275n);
    expect(rows.find(p => p.name === "Semovita" && p.unit === "10 kg")?.imageUrl).toContain("product-placeholder");
    expect(rows.find(p => p.name === "BUA Rice 50kg")?.imageUrl).toContain("1000191366-studio.png");
  });

  it("recalculates all percentage prices atomically and preserves manual prices and re-import edits", async () => {
    const bua = (await catalog.listAllProducts()).find(p => p.name === "BUA Rice 50kg")!;
    const manual = await catalog.createProduct(createProductSchema.parse({ name: "Manual", imageUrl: "https://example.com/manual.png",
      priceNaira: 500, categoryId: bua.categoryId, brandId: bua.brandId, unit: "bag" }), actor);
    await catalog.updateProduct(bua.id, { costPriceNaira: 60000 });
    expect((await catalog.updatePricing({ markupPercent: 20, insurancePercent: 2 })).updatedProducts).toBe(21);
    const rows = await catalog.listAllProducts();
    expect(rows.find(p => p.id === bua.id)?.priceKobo).toBe(7344000n);
    expect(rows.find(p => p.id === manual.id)?.priceKobo).toBe(50000n);
    expect(await catalog.importPriceList("https://another.example.com", actor)).toEqual({ added: 0, skipped: 21 });
    expect((await catalog.listAllProducts()).find(p => p.id === bua.id)?.costPriceKobo).toBe(6000000n);
    await catalog.updateProduct(manual.id, { pricingMode: "percentage", costPriceNaira: 100 });
    expect((await catalog.updatePricing({ markupPercent: 0, insurancePercent: 0 })).updatedProducts).toBe(22);
    expect((await catalog.listAllProducts()).find(p => p.id === manual.id)?.priceKobo).toBe(10000n);
  });

  it("returns recalculated buyer prices without exposing costs and rejects invalid edits", async () => {
    const bua = (await catalog.listAllProducts()).find(p => p.name === "BUA Rice 50kg")!;
    await catalog.updateProduct(bua.id, { status: "published", costPriceNaira: 61000 });
    const visible = (await catalog.listPublishedProducts()).find(p => p.id === bua.id)!;
    expect(visible.price).toBe(61000);
    expect(visible).not.toHaveProperty("costPriceKobo");
    await expect(catalog.updateProduct(bua.id, { discountPriceNaira: 1 })).rejects.toThrow("Percentage pricing");
    expect(() => catalog.updateProduct(bua.id, { stockQuantity: 2 })).toThrow("Inventory");
    expect(catalogPricingSchema.safeParse({ markupPercent: -1, insurancePercent: 1 }).success).toBe(false);
    expect(catalogPricingSchema.safeParse({ markupPercent: 10.001, insurancePercent: 1 }).success).toBe(false);
    await catalog.updatePricing({ markupPercent: 12.5, insurancePercent: 1.25 });
    const after = (await catalog.listAllProducts()).find(p => p.id === bua.id)!;
    expect(after.priceKobo).toBe(calculateCatalogPrice(6100000n, { markupPercent: 12.5, insurancePercent: 1.25 }).priceKobo);
    expect(after.stockQuantity).toBe(0);
  });

  it("imports verified online selling prices as manual drafts without marking them up twice", async () => {
    expect(await catalog.importMarketPrices("https://shop.example.com", actor)).toEqual({ added: 4, skipped: 0, pending: 1 });
    await catalog.updatePricing({ markupPercent: 30, insurancePercent: 3 });
    const rows = await catalog.listAllProducts();
    const emperor = rows.find(p => p.sku === "ONLINE-EMPEROR-OIL-25L")!;
    expect(emperor.priceKobo).toBe(8500000n);
    expect(emperor.costPriceKobo).toBeNull();
    expect(emperor.pricingMode).toBe("manual");
    expect(emperor.status).toBe("draft");
    expect(rows.find(p => p.sku === "ONLINE-ZYN-OIL-PENDING")).toBeUndefined();
    expect(await catalog.importMarketPrices("https://shop.example.com", actor)).toEqual({ added: 0, skipped: 4, pending: 1 });
  });
});
