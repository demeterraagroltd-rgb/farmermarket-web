import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { brands, categories, inventoryMovements, products, staff } from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { InventoryService } from "./inventory.service";
import { CatalogService } from "../catalog/catalog.service";

describe("Inventory real SQL", () => {
  let t: TestDb; let inventory: InventoryService; let catalog: CatalogService;
  let productId: string; let actor: string;
  beforeAll(async () => {
    t = await createTestDb(); inventory = new InventoryService(t.db); catalog = new CatalogService(t.db);
    const [category] = await t.db.insert(categories).values({ name: "Inventory test" }).returning();
    const [brand] = await t.db.insert(brands).values({ name: "Inventory test" }).returning();
    const [admin] = await t.db.insert(staff).values({ email: "inventory@example.com", fullName: "Stock Admin", passwordHash: "x", role: "admin" }).returning(); actor = admin.id;
    const product = await catalog.createProduct({ name: "Test rice", imageUrl: "https://example.com/rice.png", priceNaira: 1000, categoryId: category.id, brandId: brand.id, unit: "bag", stockQuantity: 10 }, actor);
    productId = product.id;
  }, 20000);
  afterAll(async () => t?.close());
  it("records opening stock, receives once on retries, and retains actor and reference", async () => {
    const input = { kind: "receive" as const, quantity: 5, reason: "Supplier delivery", reference: "DEL-1", operationId: randomUUID() };
    const movement = await inventory.move(productId, input, actor);
    expect((await inventory.move(productId, input, actor)).id).toBe(movement.id);
    const history = await inventory.history(productId);
    expect(history.total).toBe(2); expect(history.items.find(m => m.id === movement.id)).toMatchObject({ actorName: "Stock Admin", reference: "DEL-1", availableBefore: 10, availableAfter: 15 });
    expect((await inventory.overview()).products[0]).toMatchObject({ available: 15, reserved: 0, onHand: 15 });
    await expect(inventory.move(productId, { ...input, quantity: 6 }, actor)).rejects.toThrow("already used");
  });
  it("rejects below-zero corrections atomically and supports reasoned adjustments", async () => {
    const before = (await inventory.history(productId)).total;
    await expect(inventory.move(productId, { kind: "adjustment", quantity: -16, reason: "Count correction", operationId: randomUUID() }, actor)).rejects.toThrow("Only 15");
    expect((await inventory.history(productId)).total).toBe(before);
    await inventory.move(productId, { kind: "adjustment", quantity: -12, reason: "Damaged bags removed", operationId: randomUUID() }, actor);
    await inventory.threshold(productId, 4, actor);
    expect((await inventory.overview()).products[0]).toMatchObject({ available: 3, stockStatus: "low_stock", lowStockThreshold: 4 });
  });
  it("prevents silent stock edits and permanent history edits", async () => {
    expect(() => catalog.updateProduct(productId, { stockQuantity: 100 })).toThrow("Use Inventory");
    await expect(t.db.update(inventoryMovements).set({ reason: "Rewritten" }).where(eq(inventoryMovements.productId, productId))).rejects.toThrow();
    await expect(t.db.delete(inventoryMovements).where(eq(inventoryMovements.productId, productId))).rejects.toThrow();
    expect((await t.db.select().from(products).where(eq(products.id, productId)))[0].stockQuantity).toBe(3);
  });
});
