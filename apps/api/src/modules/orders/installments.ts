import { percentOfKobo } from "@farmermarket/core";
import type { bnplPlans } from "@farmermarket/db";

const DAY_MS = 24 * 60 * 60 * 1000;
type Plan = typeof bnplPlans.$inferSelect;

/** Pay Now: due at approval rather than on a date fixed when the order is placed. */
export const isPayNow = (plan: Plan) => !plan.durationDays && plan.durationMonths === 0;

/**
 * The repayment schedule for an order. Financed plans date every installment
 * from when the order was placed, so the dates a customer authorizes with
 * Recova before staff approval are exactly the dates approval writes.
 */
export function buildInstallments(totalKobo: bigint, plan: Plan, placedAt: Date) {
  const installments = plan.durationDays || plan.durationMonths === 0 ? 1 : plan.durationMonths;
  const totalWithFee = totalKobo + percentOfKobo(totalKobo, plan.interestPercent);
  const base = totalWithFee / BigInt(installments);
  const remainder = totalWithFee - base * BigInt(installments);

  return Array.from({ length: installments }, (_, i) => {
    const n = i + 1;
    const amountKobo = n === installments ? base + remainder : base; // remainder absorbed by the last installment
    const dueDate = plan.durationDays
      ? new Date(placedAt.getTime() + plan.durationDays * DAY_MS)
      : isPayNow(plan)
        ? new Date() // Pay Now — due immediately
        : new Date(placedAt.getTime() + n * 30 * DAY_MS);
    return { installmentNumber: n, totalInstallments: installments, amountKobo, dueDate };
  });
}

/** Phones (any format) allowed to see and use test-only plans. */
export function testPlanPhones() {
  return (process.env.TEST_PLAN_CUSTOMER_PHONES ?? "").split(",")
    .map((p) => p.replace(/\D/g, "").replace(/^0(?=\d{10}$)/, "234")).filter(Boolean);
}

export function canUseTestPlans(phone: string | null | undefined) {
  const normalised = (phone ?? "").replace(/\D/g, "").replace(/^0(?=\d{10}$)/, "234");
  return !!normalised && testPlanPhones().includes(normalised);
}
