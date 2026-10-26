import { z } from "zod";

const money = z.number().int().min(0).max(100_000_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Use a valid calendar date (YYYY-MM-DD).");

export const previewSchema = z.object({
  asOf: z.string().datetime({ offset: true }),
  graceDays: z.number().int().min(0).max(90).default(0),
  pendingPayment: z.boolean().default(false),
  unresolvedDebit: z.boolean().default(false),
  installments: z.array(z.object({ dueDate: day, amountKobo: money.refine((v) => v > 0), paidKobo: money })
    .refine((v) => v.paidKobo <= v.amountKobo, "Paid amount cannot exceed the installment.")).min(1).max(36),
}).strict();

/** Policy preview only. It never submits a debit or modifies the repayment ledger. */
export function previewRepayment(input: z.input<typeof previewSchema>) {
  const p = previewSchema.parse(input);
  const now = new Date(p.asOf).getTime();
  const rows = [...p.installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const finalDue = rows[rows.length - 1].dueDate;
  // An installment remains collectable on its due date. Recovery starts after
  // the final due date has ended in Nigeria (UTC+1), plus any configured grace.
  const recoveryAt = new Date(new Date(`${finalDue}T00:00:00+01:00`).getTime() + (1 + p.graceDays) * 86_400_000);
  let outstandingKobo = 0;
  let dueKobo = 0;
  for (const r of rows) {
    const balance = r.amountKobo - r.paidKobo;
    outstandingKobo += balance;
    if (now >= new Date(`${r.dueDate}T00:00:00+01:00`).getTime()) dueKobo += balance;
  }
  const hold = p.pendingPayment ? "voluntary_payment_awaiting_reconciliation" : p.unresolvedDebit ? "unresolved_debit" : null;
  const matured = now >= recoveryAt.getTime();
  const stage = outstandingKobo === 0 ? "closed" : matured ? "recovery" : "collection";
  return {
    stage, hold, outstandingKobo, dueKobo,
    futureKobo: outstandingKobo - dueKobo,
    collectionTargetKobo: stage === "collection" && !hold ? dueKobo : 0,
    recoveryTargetKobo: stage === "recovery" && !hold ? outstandingKobo : 0,
    recoveryEligibleAt: recoveryAt.toISOString(),
    additionalInterestKobo: 0,
    executionEnabled: false,
    executionBlock: "Sandbox preview: Recova sweep endpoint, transition rules and reconciliation contract need confirmation.",
  };
}

export const consentSchema = z.object({
  testDataConfirmed: z.literal(true),
  // Provider tenure units are not stated in the public guide. A tester must
  // explicitly confirm these with the implementation manager before sending.
  tenureUnitsConfirmed: z.literal(true),
  loanReference: z.string().regex(/^fm-sandbox-[A-Za-z0-9-]{6,80}$/),
  customerID: z.string().trim().min(1).max(80),
  customerName: z.string().trim().min(3).max(150),
  customerEmail: z.string().email().max(254),
  phoneNumber: z.string().regex(/^\+?\d{10,15}$/),
  bvn: z.string().regex(/^\d{11}$/),
  preferredRepaymentBankCBNCode: z.string().regex(/^\d{3}$/),
  preferredRepaymentAccount: z.string().regex(/^\d{10}$/),
  loanAmountKobo: money.refine((v) => v > 0),
  loanTenure: z.number().int().min(1).max(365),
  repaymentType: z.enum(["Collection", "Recovery"]),
  installments: z.array(z.object({ dueDate: day, amountKobo: money.refine((v) => v > 0) })).min(1).max(36),
}).strict().superRefine((v, ctx) => {
  const total = v.installments.reduce((sum, r) => sum + r.amountKobo, 0);
  if (total < v.loanAmountKobo) ctx.addIssue({ code: "custom", message: "Scheduled total cannot be below the loan amount." });
  if (new Set(v.installments.map((r) => r.dueDate)).size !== v.installments.length) {
    ctx.addIssue({ code: "custom", message: "Use one installment per repayment date." });
  }
});

export function consentPayload(input: z.input<typeof consentSchema>) {
  const p = consentSchema.parse(input);
  return {
    bvn: p.bvn, loanReference: p.loanReference, customerID: p.customerID,
    customerName: p.customerName, customerEmail: p.customerEmail, phoneNumber: p.phoneNumber,
    loanAmount: p.loanAmountKobo / 100,
    totalRepaymentExpected: p.installments.reduce((sum, r) => sum + r.amountKobo, 0) / 100,
    loanTenure: p.loanTenure, linkedAccountNumber: p.preferredRepaymentAccount,
    repaymentType: p.repaymentType,
    preferredRepaymentBankCBNCode: p.preferredRepaymentBankCBNCode,
    preferredRepaymentAccount: p.preferredRepaymentAccount,
    // Midday WAT is 11:00Z on the same calendar day. Midnight WAT would be
    // 23:00Z the previous day, so a UTC-based provider could debit a day early.
    collectionPaymentSchedules: [...p.installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((r) => ({
      repaymentDate: `${r.dueDate}T12:00:00+01:00`, repaymentAmountInNaira: r.amountKobo / 100,
    })),
  };
}
