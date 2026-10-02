import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { brands, categories, products, bundles, bundleItems, users, staff, orders, bnplPlans, pickupCenters, type Db } from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { OrdersService } from "./orders.service";
import { BundlesService } from "../catalog/bundles.service";
import { bundleSchema } from "../catalog/dto/bundle.dto";
import { createOrderItemSchema } from "./dto/create-order.dto";

describe("Bundles through real order SQL and migrations", () => {
  let t: TestDb; let db: Db; let service: OrdersService; let catalog: BundlesService;
  let rice: string; let oil: string; let bundle: string; let userId: string; let staffId: string; let plan: string; let centre: string;
  beforeAll(async () => {
    t = await createTestDb(); db = t.db;
    const [{ id: categoryId }] = await db.insert(categories).values({ name: "Groceries" }).returning();
    const [{ id: brandId }] = await db.insert(brands).values({ name: "Test brand" }).returning();
    const rows = await db.insert(products).values([
      { name: "Rice", imageUrl: "https://example.com/rice.png", priceKobo: 100000n, discountPriceKobo: 90000n, categoryId, brandId, unit: "bag", stockQuantity: 10, status: "published" },
      { name: "Oil", imageUrl: "https://example.com/oil.png", priceKobo: 50000n, categoryId, brandId, unit: "bottle", stockQuantity: 10, status: "published" },
    ]).returning(); rice = rows[0].id; oil = rows[1].id;
    [{ id: userId }] = await db.insert(users).values({ phone: "08012345678", email: "buyer@example.com", fullName: "Buyer" }).returning();
    [{ id: staffId }] = await db.insert(staff).values({ email: "staff@example.com", passwordHash: "x", fullName: "Test Admin", role: "admin" }).returning();
    [{ id: plan }] = await db.insert(bnplPlans).values({ name: "Pay Now", durationMonths: 0 }).returning();
    [{ id: centre }] = await db.insert(pickupCenters).values({ name: "Pickup", address: "Real test centre" }).returning();
    [{ id: bundle }] = await db.insert(bundles).values({ name: "Kitchen", slug: "kitchen", description: "Rice and oil", imageUrl: "https://example.com/bundle.png", bundlePriceKobo: 170000n, active: true, featured: true }).returning();
    await db.insert(bundleItems).values([{ bundleId: bundle, productId: rice, quantity: 1 }, { bundleId: bundle, productId: oil, quantity: 2 }]);
    service = new OrdersService(db, {} as never, { assertTxnPin: vi.fn().mockResolvedValue(undefined) } as never,
      { assertVerified: vi.fn().mockResolvedValue(undefined) } as never, { send: vi.fn().mockResolvedValue(undefined) } as never);
    catalog = new BundlesService(db);
  }, 20000);
  afterAll(async () => t?.close());
  beforeEach(async () => {
    await db.update(products).set({ stockQuantity: 10, status: "published", isAvailable: true }).where(eq(products.id, rice));
    await db.update(products).set({ stockQuantity: 10, status: "published", isAvailable: true, priceKobo: 50000n }).where(eq(products.id, oil));
    await db.update(bundles).set({ active: true, bundlePriceKobo: 170000n }).where(eq(bundles.id, bundle));
  });
  const input = (items: { productId?: string; bundleId?: string; quantity: number }[]) => ({ items, pickupCenterId: centre, pickupDate: new Date(), bnplPlanId: plan, txnPin: "1234" });
  const stock = async (id: string) => (await db.select().from(products).where(eq(products.id, id)))[0].stockQuantity;

  it("calculates dynamic effective regular prices, savings, and limiting stock", async () => {
    const view = await catalog.findBySlug("kitchen");
    expect(view.regularPrice).toBe(1900); expect(view.bundlePrice).toBe(1700); expect(view.savings).toBe(200);
    expect(view.availableQuantity).toBe(5); expect(view.isAvailable).toBe(true);
    await db.update(products).set({ priceKobo: 60000n, stockQuantity: 1 }).where(eq(products.id, oil));
    const changed = await catalog.findBySlug("kitchen"); expect(changed.regularPrice).toBe(2100); expect(changed.savings).toBe(400); expect(changed.isAvailable).toBe(false);
  });
  it("keeps one bundle line, multiplies components, aggregates mixed stock, and snapshots prices", async () => {
    const placed = await service.create(userId, input([{ bundleId: bundle, quantity: 2 }, { productId: oil, quantity: 1 }]));
    expect(placed.items).toHaveLength(2); expect(placed.items[0].bundleId).toBe(bundle); expect(placed.items[0].unitPrice).toBe(1700);
    expect(placed.items[0].components.find((i) => i.productId === oil)?.totalQuantity).toBe(4);
    expect(placed.subtotal).toBe(3900); expect(await stock(oil)).toBe(5); expect(await stock(rice)).toBe(8);
    await db.update(bundles).set({ name: "Renamed", bundlePriceKobo: 180000n }).where(eq(bundles.id, bundle));
    await db.update(products).set({ priceKobo: 70000n }).where(eq(products.id, oil));
    const history = await service.findOneForUser(userId, placed.id);
    expect(history.items[0].name).toBe("Kitchen"); expect(history.items[0].unitPrice).toBe(1700);
    expect(history.items[0].components.find((i) => i.productId === oil)?.unitPrice).toBe(500);
    await db.update(bundles).set({ name: "Kitchen" }).where(eq(bundles.id, bundle));
  });
  it("rejects combined oversell and rolls back earlier deductions", async () => {
    const before = (await db.select().from(orders)).length;
    await expect(service.create(userId, input([{ bundleId: bundle, quantity: 5 }, { productId: oil, quantity: 1 }]))).rejects.toThrow("Not enough stock");
    expect(await stock(oil)).toBe(10); expect(await stock(rice)).toBe(10); expect((await db.select().from(orders)).length).toBe(before);
  });
  it("rejects inactive or unpublished components", async () => {
    await db.update(products).set({ status: "draft" }).where(eq(products.id, oil));
    await expect(service.create(userId, input([{ bundleId: bundle, quantity: 1 }]))).rejects.toThrow("not available");
    await db.update(bundles).set({ active: false }).where(eq(bundles.id, bundle));
    await expect(catalog.findBySlug("kitchen")).rejects.toThrow("not found");
  });
  it("releases original component quantities once on rejection despite bundle edits", async () => {
    const placed = await service.create(userId, input([{ bundleId: bundle, quantity: 2 }]));
    await db.update(bundleItems).set({ quantity: 3 }).where(eq(bundleItems.productId, oil));
    await service.reject(placed.id, staffId, "Not approved");
    expect(await stock(oil)).toBe(10); expect(await stock(rice)).toBe(10);
    await expect(service.reject(placed.id, staffId, "Again")).rejects.toThrow("already rejected");
    expect(await stock(oil)).toBe(10);
    await db.update(bundleItems).set({ quantity: 2 }).where(eq(bundleItems.productId, oil));
  });
  it("preserves individual discounted purchasing and releases cancelled stock once", async () => {
    const placed = await service.create(userId, input([{ productId: rice, quantity: 2 }]));
    expect(placed.items[0].bundleId).toBeNull(); expect(placed.items[0].components).toEqual([]); expect(placed.subtotal).toBe(1800); expect(await stock(rice)).toBe(8);
    await db.update(orders).set({ status: "confirmed" }).where(eq(orders.id, placed.id));
    await service.updateStatus(placed.id, "cancelled"); expect(await stock(rice)).toBe(10);
    await expect(service.updateStatus(placed.id, "preparing")).rejects.toThrow("already closed");
  });
  it("rolls back inventory if a later checkout validation fails", async () => {
    await expect(service.create(userId, { ...input([{ bundleId: bundle, quantity: 1 }]), bnplPlanId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow("Selected plan");
    expect(await stock(oil)).toBe(10);
  });
  it("allows drafts but prevents publishing missing image/mapping/invalid savings", async () => {
    const base = bundleSchema.parse({ name: "Draft", slug: "draft", items: [{ productId: rice, quantity: 1 }], bundlePrice: 800 });
    const draft = await catalog.save(base); expect(draft.active).toBe(false);
    await expect(catalog.save({ ...base, active: true }, draft.id)).rejects.toThrow("To publish");
    await expect(catalog.save({ ...base, active: true, imageUrl: "https://example.com/image.png", missingProducts: ["Maggi"] }, draft.id)).rejects.toThrow("To publish");
    await expect(catalog.save({ ...base, active: true, imageUrl: "https://example.com/image.png", bundlePrice: 1000 }, draft.id)).rejects.toThrow("To publish");
    const ready = await catalog.save({ ...base, active: true, imageUrl: "https://example.com/image.png" }, draft.id); expect(ready.isAvailable).toBe(true);
  });
  it("validates one identity per line and rejects duplicate components", () => {
    expect(createOrderItemSchema.safeParse({ productId: rice, bundleId: bundle, quantity: 1 }).success).toBe(false);
    expect(createOrderItemSchema.safeParse({ quantity: 1 }).success).toBe(false);
    expect(bundleSchema.safeParse({ name: "x", slug: "x", items: [{ productId: rice, quantity: 1 }, { productId: rice, quantity: 2 }] }).success).toBe(false);
  });
});
