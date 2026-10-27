import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { auditLogs, bnplPlans, orders, pickupCenters, staff, users, type Db } from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { OrdersService } from "./orders.service";

describe("Repayment setup link", () => {
  let t: TestDb; let db: Db; let staffId: string; let approved: string; let pending: string;
  const email = { send: vi.fn().mockResolvedValue(undefined) };
  const sms = { live: true, send: vi.fn().mockResolvedValue(undefined) };
  const service = () => new OrdersService(db, {} as never, {} as never, {} as never, email as never, sms);

  beforeAll(async () => {
    t = await createTestDb(); db = t.db;
    const [{ id: userId }] = await db.insert(users).values({ phone: "08012345678", email: "buyer@example.com", fullName: "Buyer" }).returning();
    [{ id: staffId }] = await db.insert(staff).values({ email: "staff@example.com", passwordHash: "x", fullName: "Admin", role: "admin" }).returning();
    const [{ id: planId }] = await db.insert(bnplPlans).values({ name: "Pay Next Salary", durationMonths: 0 }).returning();
    const [{ id: centreId }] = await db.insert(pickupCenters).values({ name: "Pickup", address: "Centre" }).returning();
    const base = { userId, bnplPlanId: planId, pickupCenterId: centreId, totalKobo: 147850n, subtotalKobo: 95000n };
    [{ id: approved }] = await db.insert(orders).values({ ...base, status: "confirmed", approvedAt: new Date() } as never).returning();
    [{ id: pending }] = await db.insert(orders).values({ ...base, status: "pending_approval" } as never).returning();
  }, 20000);
  afterAll(async () => t?.close());
  afterEach(() => { vi.unstubAllEnvs(); email.send.mockClear(); sms.send.mockClear(); });

  it("emails and texts the order link for an approved order and records who sent it", async () => {
    vi.stubEnv("RECOVA_DATA_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("WEB_BASE_URL", "https://shop.example.test");
    const result = await service().sendRepaymentSetupLink(approved, staffId);
    expect(result).toEqual({ email: "sent", sms: "sent", link: `https://shop.example.test/account/orders/${approved}` });
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: "buyer@example.com", subject: expect.stringContaining("set up repayment") }));
    expect(sms.send).toHaveBeenCalledWith("2348012345678", expect.stringContaining(result.link));
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.targetId, approved));
    expect(audit).toMatchObject({ action: "order.repayment_setup_link_sent", actorStaffId: staffId });
  });

  it("refuses unapproved orders and servers without Recova setup", async () => {
    vi.stubEnv("RECOVA_DATA_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    await expect(service().sendRepaymentSetupLink(pending, staffId)).rejects.toThrow("approved");
    vi.stubEnv("RECOVA_DATA_ENCRYPTION_KEY", "");
    await expect(service().sendRepaymentSetupLink(approved, staffId)).rejects.toThrow("not configured");
    expect(email.send).not.toHaveBeenCalled();
    expect(sms.send).not.toHaveBeenCalled();
  });
});
