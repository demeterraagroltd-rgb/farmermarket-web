import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictException } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import {
  bnplPlans,
  brands,
  categories,
  orders,
  pickupCenters,
  products,
  staff,
  stockLots,
  stockMovements,
  users,
  type Db,
} from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { LedgerService } from "../ledger/ledger.service";
import { OrdersService } from "../orders/orders.service";
import { CatalogService } from "../catalog/catalog.service";
import { InventoryService, OUT_OF_STOCK } from "./inventory.service";

// Real SQL against real migrations (test/test-db.ts). Stock bugs are
// arithmetic across three tables that must stay in step, so every test ends
// by checking the books still balance — see `assertBooksBalance`.

const DAY = 86_400_000;

describe("Inventory (real Postgres)", { timeout: 30_000 }, () => {
  let t: TestDb;
  let db: Db;
  let inventory: InventoryService;
  let ordersSvc: OrdersService;
  let catalog: CatalogService;
  const sent: { to: string | null | undefined; subject: string }[] = [];

  let staffId: string;
  let buyerId: string;
  let planId: string;
  let centreId: string;
  let categoryId: string;
  let brandId: string;

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    const email = { send: async (m: { to: string | null | undefined; subject: string }) => void sent.push(m) } as never;
    const auth = { assertTxnPin: async () => {} } as never;
    const kyc = { assertVerified: async () => {}, getVerificationStatus: async () => "verified" } as never;
    inventory = new InventoryService(db, email);
    ordersSvc = new OrdersService(db, new LedgerService(), auth, kyc, email, inventory);
    catalog = new CatalogService(db);

    [{ id: staffId }] = await db
      .insert(staff)
      .values({ email: "stock@example.com", passwordHash: "x", fullName: "Sade Stock", role: "admin" })
      .returning({ id: staff.id });
    [{ id: buyerId }] = await db
      .insert(users)
      .values({ phone: "2348022222222", fullName: "Bola Buyer", email: "bola@example.com" })
      .returning({ id: users.id });
    [{ id: planId }] = await db
      .insert(bnplPlans)
      .values({ name: "Pay Now", durationMonths: 0 })
      .returning({ id: bnplPlans.id });
    [{ id: centreId }] = await db
      .insert(pickupCenters)
      .values({ name: "Ikeja", address: "1 Allen Ave" })
      .returning({ id: pickupCenters.id });
    [{ id: categoryId }] = await db.insert(categories).values({ name: "Rice" }).returning({ id: categories.id });
    [{ id: brandId }] = await db.insert(brands).values({ name: "Golden Penny" }).returning({ id: brands.id });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(() => {
    sent.length = 0;
  });

  let n = 0;
  async function newProduct(opts: { threshold?: number } = {}) {
    const [p] = await db
      .insert(products)
      .values({
        name: `Rice 50kg #${++n}`,
        imageUrl: "https://example.com/rice.png",
        priceKobo: 8_000_000n,
        categoryId,
        brandId,
        unit: "50kg bag",
        status: "published",
        lowStockThreshold: opts.threshold ?? 5,
      })
      .returning();
    return p.id;
  }

  async function levels(productId: string) {
    const [p] = await db.select().from(products).where(eq(products.id, productId));
    return { onHand: p.stockQuantity, reserved: p.stockReserved, available: p.stockQuantity - p.stockReserved };
  }

  function place(items: { productId: string; quantity: number }[]) {
    return ordersSvc.create(buyerId, {
      items,
      pickupCenterId: centreId,
      pickupDate: new Date(Date.now() + 2 * DAY),
      bnplPlanId: planId,
      txnPin: "1234",
    });
  }

  /** on hand = Σ lot remaining = Σ on_hand_delta, and reserved = Σ reserved_delta. */
  async function assertBooksBalance(productId: string) {
    const [p] = await db.select().from(products).where(eq(products.id, productId));
    const [lots] = await db
      .select({ remaining: sql<number>`coalesce(sum(${stockLots.quantityRemaining}),0)::int` })
      .from(stockLots)
      .where(eq(stockLots.productId, productId));
    const [journal] = await db
      .select({
        onHand: sql<number>`coalesce(sum(${stockMovements.onHandDelta}),0)::int`,
        reserved: sql<number>`coalesce(sum(${stockMovements.reservedDelta}),0)::int`,
      })
      .from(stockMovements)
      .where(eq(stockMovements.productId, productId));
    expect(lots.remaining).toBe(p.stockQuantity);
    expect(journal.onHand).toBe(p.stockQuantity);
    expect(journal.reserved).toBe(p.stockReserved);
  }

  it("receiving creates a lot and puts it on hand", async () => {
    const pid = await newProduct();
    const lot = await inventory.receive(
      { productId: pid, quantity: 40, unitCostNaira: 72_000, expiryDate: "2027-06-30" },
      staffId,
    );
    expect(lot.lotCode).toMatch(/^RICE50-\d{6}-1$/);
    expect(lot.unitCost).toBe(72_000);
    expect(await levels(pid)).toEqual({ onHand: 40, reserved: 0, available: 40 });
    await assertBooksBalance(pid);
  });

  it("submitting an order reserves stock without taking it off the shelf", async () => {
    const pid = await newProduct();
    await inventory.receive({ productId: pid, quantity: 10 }, staffId);
    const order = await place([{ productId: pid, quantity: 3 }]);

    expect(await levels(pid)).toEqual({ onHand: 10, reserved: 3, available: 7 });
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.stockState).toBe("reserved");
    await assertBooksBalance(pid);
  });

  it("refuses an order for more than is available, and leaves no trace of it", async () => {
    const pid = await newProduct();
    await inventory.receive({ productId: pid, quantity: 5 }, staffId);
    await place([{ productId: pid, quantity: 4 }]);
    const before = await db.select({ c: sql<number>`count(*)::int` }).from(orders);

    const err = await place([{ productId: pid, quantity: 2 }]).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: OUT_OF_STOCK, productId: pid, available: 1 });
    expect(err.getResponse().message).toMatch(/Only 1 left/);

    const after = await db.select({ c: sql<number>`count(*)::int` }).from(orders);
    expect(after[0].c).toBe(before[0].c); // the whole order rolled back
    expect(await levels(pid)).toEqual({ onHand: 5, reserved: 4, available: 1 });
    await assertBooksBalance(pid);
  });

  it("rolls back every line when one line of a multi-product order is short", async () => {
    const a = await newProduct();
    const b = await newProduct();
    await inventory.receive({ productId: a, quantity: 10 }, staffId);
    await inventory.receive({ productId: b, quantity: 1 }, staffId);

    await expect(
      place([
        { productId: a, quantity: 2 },
        { productId: b, quantity: 5 },
      ]),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await levels(a)).toEqual({ onHand: 10, reserved: 0, available: 10 });
    await assertBooksBalance(a);
  });

  it("counts duplicate cart lines for the same product together", async () => {
    const pid = await newProduct();
    await inventory.receive({ productId: pid, quantity: 3 }, staffId);
    await expect(
      place([
        { productId: pid, quantity: 2 },
        { productId: pid, quantity: 2 },
      ]),
    ).rejects.toBeInstanceOf(ConflictException);
    await place([
      { productId: pid, quantity: 1 },
      { productId: pid, quantity: 2 },
    ]);
    expect(await levels(pid)).toEqual({ onHand: 3, reserved: 3, available: 0 });
  });

  it("rejecting a pending order releases its hold", async () => {
    const pid = await newProduct();
    await inventory.receive({ productId: pid, quantity: 10 }, staffId);
    const order = await place([{ productId: pid, quantity: 6 }]);
    await ordersSvc.reject(order.id, staffId, "Out of area");

    expect(await levels(pid)).toEqual({ onHand: 10, reserved: 0, available: 10 });
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.stockState).toBe("released");
    await assertBooksBalance(pid);
  });

  it("dispatch takes the oldest-received lot first (FIFO), across lots", async () => {
    const pid = await newProduct();
    // Logged second but received first — received date decides, not entry order.
    const newer = await inventory.receive({ productId: pid, quantity: 5 }, staffId);
    const older = await inventory.receive(
      { productId: pid, quantity: 4, receivedAt: new Date(Date.now() - 10 * DAY) },
      staffId,
    );
    const order = await place([{ productId: pid, quantity: 6 }]);

    const plan = await inventory.pickList(order.id);
    expect(plan.planned).toBe(true);
    expect(plan.lines[0].lots.map((l) => [l.lotId, l.quantity])).toEqual([
      [older.id, 4],
      [newer.id, 2],
    ]);

    await ordersSvc.approve(order.id, staffId);
    expect(await levels(pid)).toEqual({ onHand: 9, reserved: 6, available: 3 }); // approval doesn't move stock
    await ordersSvc.updateStatus(order.id, "preparing", staffId);

    expect(await levels(pid)).toEqual({ onHand: 3, reserved: 0, available: 3 });
    const lots = await db.select().from(stockLots).where(eq(stockLots.productId, pid));
    expect(lots.find((l) => l.id === older.id)!.quantityRemaining).toBe(0);
    expect(lots.find((l) => l.id === newer.id)!.quantityRemaining).toBe(3);

    const actual = await inventory.pickList(order.id);
    expect(actual.planned).toBe(false);
    expect(actual.lines[0].quantity).toBe(6);

    // Later steps don't dispatch twice.
    await ordersSvc.updateStatus(order.id, "on_the_way", staffId);
    await ordersSvc.updateStatus(order.id, "delivered", staffId);
    expect(await levels(pid)).toEqual({ onHand: 3, reserved: 0, available: 3 });
    await assertBooksBalance(pid);
  });

  it("cancelling after dispatch returns goods to the lots they left", async () => {
    const pid = await newProduct();
    const lot = await inventory.receive({ productId: pid, quantity: 8 }, staffId);
    const order = await place([{ productId: pid, quantity: 5 }]);
    await ordersSvc.approve(order.id, staffId);
    await ordersSvc.updateStatus(order.id, "preparing", staffId);
    await ordersSvc.updateStatus(order.id, "cancelled", staffId);

    expect(await levels(pid)).toEqual({ onHand: 8, reserved: 0, available: 8 });
    const [l] = await db.select().from(stockLots).where(eq(stockLots.id, lot.id));
    expect(l.quantityRemaining).toBe(8);
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.stockState).toBe("returned");
    await assertBooksBalance(pid);
  });

  it("a cancelled order can't be moved forward again", async () => {
    const pid = await newProduct();
    await inventory.receive({ productId: pid, quantity: 8 }, staffId);
    const order = await place([{ productId: pid, quantity: 2 }]);
    await ordersSvc.updateStatus(order.id, "cancelled", staffId);
    expect(await levels(pid)).toEqual({ onHand: 8, reserved: 0, available: 8 });
    await expect(ordersSvc.updateStatus(order.id, "preparing", staffId)).rejects.toThrow(/put back on the shelf/);
    await assertBooksBalance(pid);
  });

  it("adjustments record the reason and can't eat into reserved stock", async () => {
    const pid = await newProduct();
    const lot = await inventory.receive({ productId: pid, quantity: 10 }, staffId);
    await place([{ productId: pid, quantity: 7 }]);

    await expect(
      inventory.adjust({ lotId: lot.id, quantityDelta: -4, reason: "spoilage", note: "Wet bags" }, staffId),
    ).rejects.toThrow(/7 of .* are reserved/);

    await inventory.adjust({ lotId: lot.id, quantityDelta: -3, reason: "damage", note: "Torn bags" }, staffId);
    expect(await levels(pid)).toEqual({ onHand: 7, reserved: 7, available: 0 });

    await expect(
      inventory.adjust({ lotId: lot.id, quantityDelta: 4, reason: "count_correction", note: "Found" }, staffId),
    ).rejects.toThrow(/new delivery/);

    const history = await inventory.listMovements({ productId: pid });
    expect(history[0]).toMatchObject({ type: "adjust", onHandDelta: -3, reason: "damage", staffName: "Sade Stock" });
    await assertBooksBalance(pid);
  });

  it("the public catalog hides products with nothing available and reports what's left", async () => {
    const pid = await newProduct();
    let listed = (await catalog.listPublishedProducts()).find((p) => p.id === pid);
    expect(listed).toBeUndefined(); // nothing received yet

    await inventory.receive({ productId: pid, quantity: 4 }, staffId);
    await place([{ productId: pid, quantity: 1 }]);
    listed = (await catalog.listPublishedProducts()).find((p) => p.id === pid);
    expect(listed?.availableQuantity).toBe(3);

    await place([{ productId: pid, quantity: 3 }]);
    listed = (await catalog.listPublishedProducts()).find((p) => p.id === pid);
    expect(listed).toBeUndefined();
  });

  it("the daily sweep releases stale holds, and approving later re-reserves", async () => {
    const pid = await newProduct({ threshold: 5 });
    await inventory.receive({ productId: pid, quantity: 10, expiryDate: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10) }, staffId);
    const order = await place([{ productId: pid, quantity: 6 }]);
    await db.update(orders).set({ placedAt: new Date(Date.now() - 8 * DAY) }).where(eq(orders.id, order.id));

    const summary = await inventory.runDailySweep();
    expect(summary.releasedOrders).toContain(order.id);
    expect(await levels(pid)).toEqual({ onHand: 10, reserved: 0, available: 10 });
    expect(summary.expiringLots.some((l) => l.remaining === 10)).toBe(true);
    expect(sent.some((m) => m.to === "stock@example.com" && /Inventory:/.test(m.subject))).toBe(true);

    await ordersSvc.approve(order.id, staffId);
    expect(await levels(pid)).toEqual({ onHand: 10, reserved: 6, available: 4 });
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.stockState).toBe("reserved");

    // Now under its threshold of 5 → shows up as low.
    const stock = await inventory.listStock();
    expect(stock.find((s) => s.productId === pid)).toMatchObject({ available: 4, isLow: true, activeLots: 1 });
    await assertBooksBalance(pid);
  });

  it("approving a released order fails cleanly if the stock has gone meanwhile", async () => {
    const pid = await newProduct();
    await inventory.receive({ productId: pid, quantity: 5 }, staffId);
    const stale = await place([{ productId: pid, quantity: 5 }]);
    await db.update(orders).set({ placedAt: new Date(Date.now() - 8 * DAY) }).where(eq(orders.id, stale.id));
    await inventory.runDailySweep();
    await place([{ productId: pid, quantity: 4 }]); // someone else buys it

    await expect(ordersSvc.approve(stale.id, staffId)).rejects.toBeInstanceOf(ConflictException);
    const [row] = await db.select().from(orders).where(eq(orders.id, stale.id));
    expect(row.status).toBe("pending_approval"); // approval rolled back entirely
    expect(await levels(pid)).toEqual({ onHand: 5, reserved: 4, available: 1 });
    await assertBooksBalance(pid);
  });

  it("orders placed before inventory tracking never touch stock", async () => {
    const pid = await newProduct();
    await inventory.receive({ productId: pid, quantity: 5 }, staffId);
    const [legacy] = await db
      .insert(orders)
      .values({ userId: buyerId, status: "confirmed", subtotalKobo: 100n, totalKobo: 100n, bnplPlanId: planId })
      .returning();
    await ordersSvc.updateStatus(legacy.id, "preparing", staffId);
    await ordersSvc.updateStatus(legacy.id, "cancelled", staffId);
    expect(await levels(pid)).toEqual({ onHand: 5, reserved: 0, available: 5 });
  });
});
