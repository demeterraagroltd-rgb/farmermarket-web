import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as s from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { CustomerTestDeletionService } from "./customer-test-deletion.service";

describe("Permanent test account deletion with isolated SQL", () => {
  let test: TestDb; let db: s.Db; let service: CustomerTestDeletionService;
  let staffId: string; let planId: string; let warehouseId: string; let productId: string;
  let serial = 0;
  beforeAll(async () => {
    test = await createTestDb(); db = test.db; service = new CustomerTestDeletionService(db);
    [ { id: staffId } ] = await db.insert(s.staff).values({ fullName: "Test Admin", email: "reset@example.test", passwordHash: "x", role: "super_admin" }).returning();
    [ { id: planId } ] = await db.insert(s.bnplPlans).values({ name: "Test", durationMonths: 1 }).returning();
    [ { id: warehouseId } ] = await db.insert(s.pickupCenters).values({ name: "Test warehouse", address: "Test" }).returning();
    const [category] = await db.insert(s.categories).values({ name: "Test" }).returning();
    const [brand] = await db.insert(s.brands).values({ name: "Test" }).returning();
    [ { id: productId } ] = await db.insert(s.products).values({ name: "Test rice", categoryId: category.id, brandId: brand.id, unit: "bag", imageUrl: "test", priceKobo: 100n, stockQuantity: 10 }).returning();
    await db.insert(s.warehouseStocks).values({ productId, warehouseId, available: 10, reserved: 4 });
  }, 60000);
  afterAll(async () => { await test?.close(); });
  async function customer(active = false) {
    const [user] = await db.insert(s.users).values({ phone: `23480000${String(++serial).padStart(5, "0")}`, fullName: "Test Customer", deactivatedAt: active ? null : new Date() }).returning();
    const [order] = await db.insert(s.orders).values({ userId: user.id, bnplPlanId: planId, subtotalKobo: 100n, totalKobo: 110n, status: "confirmed" }).returning();
    const [schedule] = await db.insert(s.repaymentSchedules).values({ userId: user.id, orderId: order.id, amountKobo: 110n, dueDate: new Date(Date.now() + 86400000), installmentNumber: 1, totalInstallments: 1 }).returning();
    return { user, order, schedule };
  }
  const confirmation = (id: string) => ({ confirmation: `DELETE ${id}`, testDataConfirmed: true, reason: "Remove confirmed test data" });
  it("requires explicit confirmation and refuses active accounts", async () => {
    const { user } = await customer(true);
    expect((await service.preview(user.id)).allowed).toBe(false);
    await expect(service.remove(user.id, staffId, { ...confirmation(user.id), confirmation: "wrong" })).rejects.toThrow("Confirm the exact");
    await expect(service.remove(user.id, staffId, confirmation(user.id))).rejects.toThrow("Suspend");
    expect(await db.select().from(s.users).where(eq(s.users.id, user.id))).toHaveLength(1);
  });
  it("removes only the selected test account, releases stock, removes whole test journals and frees registration", async () => {
    const { user, order } = await customer();
    const other = await customer();
    await db.update(s.orders).set({ stockReserved: true, stockWarehouseId: warehouseId }).where(eq(s.orders.id, order.id));
    await db.insert(s.orderItems).values({ orderId: order.id, productId, name: "Test rice", imageUrl: "test", quantity: 2, unitPriceKobo: 50n });
    await db.insert(s.creditProfiles).values({ userId: user.id, creditLimitKobo: 110n, usedCreditKobo: 110n });
    await db.insert(s.recovaConsents).values({ userId: user.id, orderId: order.id, reference: `fm-live-${order.id}`, purpose: "Collection", bankCode: "999", accountLast4: "0000", payloadEncrypted: "test", scheduleSnapshot: [], consentVersion: "test" });
    const [account] = await db.insert(s.ledgerAccounts).values({ name: "Test asset", type: "asset" }).returning();
    const transactionId = crypto.randomUUID();
    await db.insert(s.ledgerEntries).values(["D", "C"].map(direction => ({ transactionId, accountId: account.id, direction, orderId: order.id, amountKobo: 110n })));
    expect((await service.preview(user.id)).outstandingKobo).toBe("110");
    await service.remove(user.id, staffId, confirmation(user.id));
    for (const table of [s.orders, s.repaymentSchedules, s.creditProfiles, s.recovaConsents]) expect(await db.select().from(table).where(eq(table.userId, user.id))).toHaveLength(0);
    expect(await db.select().from(s.users).where(eq(s.users.id, user.id))).toHaveLength(0);
    expect(await db.select().from(s.users).where(eq(s.users.id, other.user.id))).toHaveLength(1);
    expect(await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.transactionId, transactionId))).toHaveLength(0);
    const [stock] = await db.select().from(s.warehouseStocks).where(eq(s.warehouseStocks.productId, productId));
    expect(stock).toMatchObject({ available: 12, reserved: 2 });
    expect((await db.select().from(s.products).where(eq(s.products.id, productId)))[0].stockQuantity).toBe(12);
    expect((await db.select().from(s.warehouseMovements))[0].orderId).toBe(order.id);
    expect(await db.select().from(s.auditLogs).where(eq(s.auditLogs.targetId, user.id))).toHaveLength(1);
    await expect(db.insert(s.users).values({ phone: user.phone, fullName: "Fresh application" })).resolves.toBeDefined();
  });
  it("blocks actual payments and submitted provider requests", async () => {
    const paid = await customer();
    await db.insert(s.repayments).values({ repaymentScheduleId: paid.schedule.id, amountKobo: 1n });
    await expect(service.remove(paid.user.id, staffId, confirmation(paid.user.id))).rejects.toThrow("Recorded payments");
    const submitted = await customer();
    await db.insert(s.recovaConsents).values({ userId: submitted.user.id, orderId: submitted.order.id, reference: `fm-live-${submitted.order.id}`, purpose: "Collection", bankCode: "999", accountLast4: "0000", payloadEncrypted: "test", scheduleSnapshot: [], consentVersion: "test", status: "needs_review", submittedAt: new Date() });
    await expect(service.remove(submitted.user.id, staffId, confirmation(submitted.user.id))).rejects.toThrow("Recova request");
  });
  it("rolls back deletion if a ledger transaction spans another account", async () => {
    const target = await customer(); const other = await customer();
    const [account] = await db.select().from(s.ledgerAccounts).limit(1);
    const transactionId = crypto.randomUUID();
    await db.insert(s.ledgerEntries).values([{ transactionId, accountId: account.id, direction: "D", orderId: target.order.id, amountKobo: 100n }, { transactionId, accountId: account.id, direction: "C", orderId: other.order.id, amountKobo: 100n }]);
    await expect(service.remove(target.user.id, staffId, confirmation(target.user.id))).rejects.toThrow("other records");
    expect(await db.select().from(s.ledgerEntries).where(eq(s.ledgerEntries.transactionId, transactionId))).toHaveLength(2);
    expect(await db.select().from(s.users).where(eq(s.users.id, target.user.id))).toHaveLength(1);
  });
});
