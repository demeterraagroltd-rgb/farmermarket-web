import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInstallments, canUseTestPlans, isPayNow } from "./installments";

const DAY = 86_400_000;
const plan = (over: Partial<Parameters<typeof buildInstallments>[1]> = {}) => ({
  id: "p", name: "Plan", durationMonths: 3, durationDays: null, testOnly: false, interestPercent: 0,
  isPopular: false, isActive: true, sortOrder: 0, ...over,
});
afterEach(() => vi.unstubAllEnvs());

describe("repayment schedule", () => {
  it("dates financed installments from when the order was placed, not from approval", () => {
    const placedAt = new Date("2026-10-01T10:00:00Z");
    const rows = buildInstallments(300_000n, plan(), placedAt);
    expect(rows.map((r) => r.dueDate.getTime() - placedAt.getTime())).toEqual([30 * DAY, 60 * DAY, 90 * DAY]);
    expect(rows.reduce((sum, r) => sum + r.amountKobo, 0n)).toBe(300_000n);
  });
  it("gives a day plan one repayment that many days after ordering", () => {
    const placedAt = new Date("2026-10-28T09:00:00Z");
    const p = plan({ durationMonths: 0, durationDays: 1, testOnly: true });
    expect(isPayNow(p)).toBe(false);
    expect(buildInstallments(150_000n, p, placedAt)).toEqual([
      { installmentNumber: 1, totalInstallments: 1, amountKobo: 150_000n, dueDate: new Date("2026-10-29T09:00:00Z") },
    ]);
  });
  it("treats a zero-month plan without days as Pay Now", () => {
    expect(isPayNow(plan({ durationMonths: 0 }))).toBe(true);
  });
  it("offers test plans only to listed phones, in any format", () => {
    vi.stubEnv("TEST_PLAN_CUSTOMER_PHONES", "08012345678, +2348099999999");
    expect(canUseTestPlans("2348012345678")).toBe(true);
    expect(canUseTestPlans("08099999999")).toBe(true);
    expect(canUseTestPlans("08000000000")).toBe(false);
    vi.stubEnv("TEST_PLAN_CUSTOMER_PHONES", "");
    expect(canUseTestPlans("08012345678")).toBe(false);
  });
});
