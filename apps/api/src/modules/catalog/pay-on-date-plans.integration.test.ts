import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../../test/test-db";
import { CatalogService } from "./catalog.service";
import { buildInstallments, isPayNow } from "../orders/installments";

describe("Pay-on-date plans", () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); }, 20000);
  afterAll(async () => t?.close());

  it("offers Pay tomorrow and Pay in 7 days to every customer as single dated payments", async () => {
    const plans = await new CatalogService(t.db).listActiveBnplPlans();
    const placedAt = new Date("2026-10-28T10:00:00+01:00");
    for (const [name, days] of [["Pay tomorrow", 1], ["Pay in 7 days", 7]] as const) {
      const plan = plans.find((p) => p.name === name);
      expect(plan).toMatchObject({ durationDays: days, interestPercent: 0, testOnly: false });
      // Not Pay Now: these are dated, so Recova can collect them.
      expect(isPayNow(plan!)).toBe(false);
      const [only, ...rest] = buildInstallments(100000n, plan!, placedAt);
      expect(rest).toHaveLength(0);
      expect(only).toMatchObject({ amountKobo: 100000n, dueDate: new Date(placedAt.getTime() + days * 86_400_000) });
    }
  });
});
