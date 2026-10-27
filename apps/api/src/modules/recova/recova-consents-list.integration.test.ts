import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bnplPlans, orders, pickupCenters, recovaConsents, users, type Db } from "@farmermarket/db";
import { createTestDb, type TestDb } from "../../test/test-db";
import { RecovaProductionController } from "./recova-production.controller";

describe("Staff list of Recova repayment setups", () => {
  let t: TestDb; let db: Db; let orderId: string;
  beforeAll(async () => {
    t = await createTestDb(); db = t.db;
    const [{ id: userId }] = await db.insert(users).values({ phone: "08012345678", fullName: "Buyer One" }).returning();
    const [{ id: planId }] = await db.insert(bnplPlans).values({ name: "Pay Next Salary", durationMonths: 0 }).returning();
    const [{ id: centreId }] = await db.insert(pickupCenters).values({ name: "Pickup", address: "Centre" }).returning();
    [{ id: orderId }] = await db.insert(orders).values({ userId, bnplPlanId: planId, pickupCenterId: centreId, totalKobo: 147850n, subtotalKobo: 95000n, status: "confirmed", approvedAt: new Date() } as never).returning();
    await db.insert(recovaConsents).values({ userId, orderId, reference: `fm-live-${orderId}`, status: "awaiting_consent", purpose: "Collection",
      bankCode: "058", accountLast4: "9837", payloadEncrypted: "secret-payload", approvalUrlEncrypted: "secret-link", scheduleSnapshot: [], consentVersion: "v1", submittedAt: new Date() });
  }, 20000);
  afterAll(async () => t?.close());

  it("shows the reference, status and customer without encrypted payloads or links", async () => {
    const rows = await new RecovaProductionController(db).consents();
    expect(rows).toEqual([expect.objectContaining({
      reference: `fm-live-${orderId}`, status: "awaiting_consent", customerName: "Buyer One", total: 1478.5, accountLast4: "9837", orderId,
    })]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("secret-payload");
    expect(text).not.toContain("secret-link");
  });
});
