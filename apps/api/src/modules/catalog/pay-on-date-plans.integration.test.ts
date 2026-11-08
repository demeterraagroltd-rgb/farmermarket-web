import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { CatalogService } from "./catalog.service";
import { buildInstallments, isPayNow } from "../orders/installments";

describe("Customer payment options", () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); }, 20000);
  afterAll(async () => t?.close());

  it("offers exactly four options with monthly schedules", async () => {
    const plans = await new CatalogService(t.db).listActiveBnplPlans();
    expect(plans.map(p => p.name)).toEqual([
      "Pay Now", "Pay in a month", "Pay in 2 monthly installments", "Pay in 3 monthly installments",
    ]);
    const placedAt = new Date("2026-11-08T10:00:00Z");
    expect(isPayNow(plans[0])).toBe(true);
    for (const plan of plans.slice(1)) {
      const schedule = buildInstallments(100000n, plan, placedAt);
      expect(isPayNow(plan)).toBe(false);
      expect(schedule).toHaveLength(plan.durationMonths);
      schedule.forEach((payment, i) => {
        expect(payment.dueDate).toEqual(new Date(placedAt.getTime() + (i + 1) * 30 * 86400000));
      });
    }
  });
});
