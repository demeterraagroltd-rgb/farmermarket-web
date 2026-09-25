import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  MIN_DEBIT_KOBO,
  NOT_COUNTED_CODE,
  decideDebit,
  failureExplanation,
  isFcdaEmployer,
  mandateCapKobo,
  retryWaitHours,
  type AttemptHistory,
  type DebitDecisionInput,
} from "./debit-policy";

const NOW = new Date("2026-09-25T09:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const base: DebitDecisionInput = {
  now: NOW,
  dueDate: hoursAgo(1),
  remainingKobo: 5_000_000n, // ₦50,000
  mandate: { status: "active", amountKobo: 30_000_000n, collectedKobo: 0n },
  attempts: [],
  employer: "Acme Foods Ltd",
};
const failed = (hAgo: number, code: string | null = "51"): AttemptHistory => ({ status: "failed", responseCode: code, createdAt: hoursAgo(hAgo) });

describe("decideDebit", () => {
  it("debits the full remaining amount when the installment is due and everything is in order", () => {
    expect(decideDebit(base)).toEqual({ debit: true, reason: "due", amountKobo: 5_000_000n });
  });

  it("debits only what is still owed on a part-paid installment", () => {
    expect(decideDebit({ ...base, remainingKobo: 1_234_500n }).amountKobo).toBe(1_234_500n);
  });

  it("waits until the due date", () => {
    expect(decideDebit({ ...base, dueDate: new Date(NOW.getTime() + 60_000) })).toMatchObject({ debit: false, reason: "not_due" });
  });

  it("debits on the due instant itself", () => {
    expect(decideDebit({ ...base, dueDate: NOW }).debit).toBe(true);
  });

  it("never debits without an active mandate — none, awaiting, approved-but-not-ready, paused, cancelled", () => {
    expect(decideDebit({ ...base, mandate: null }).reason).toBe("no_active_mandate");
    for (const status of ["awaiting_authorisation", "approved", "paused", "cancelled", "rejected", "expired"]) {
      expect(decideDebit({ ...base, mandate: { ...base.mandate!, status } })).toMatchObject({ debit: false, reason: "no_active_mandate" });
    }
  });

  it("leaves an amount below Mono's ₦200 minimum for the customer to pay", () => {
    expect(decideDebit({ ...base, remainingKobo: BigInt(MIN_DEBIT_KOBO - 1) }).reason).toBe("below_minimum");
    expect(decideDebit({ ...base, remainingKobo: BigInt(MIN_DEBIT_KOBO) }).debit).toBe(true);
  });

  it("never takes more than the customer authorised", () => {
    const mandate = { status: "active", amountKobo: 10_000_000n, collectedKobo: 6_000_000n }; // ₦40,000 of room
    expect(decideDebit({ ...base, mandate })).toMatchObject({ debit: false, reason: "mandate_cap_reached" });
    expect(decideDebit({ ...base, mandate: { ...mandate, collectedKobo: 5_000_000n } }).debit).toBe(true); // exactly ₦50,000 of room
  });

  it("never stacks a second debit on one already in flight", () => {
    for (const status of ["initiated", "processing"] as const) {
      expect(decideDebit({ ...base, attempts: [{ status, responseCode: null, createdAt: hoursAgo(1) }] })).toMatchObject({ debit: false, reason: "in_flight" });
    }
  });

  it("stops entirely on an attempt a person has to review, even with old failures alongside", () => {
    const d = decideDebit({ ...base, attempts: [failed(200), { status: "needs_review", responseCode: null, createdAt: hoursAgo(100) }] });
    expect(d).toMatchObject({ debit: false, reason: "needs_review" });
  });

  it("waits a day after an insufficient-funds failure, then tries again", () => {
    const soon = decideDebit({ ...base, attempts: [failed(10, "51")] });
    expect(soon).toMatchObject({ debit: false, reason: "retry_wait" });
    expect(soon.retryAt!.getTime()).toBe(hoursAgo(10).getTime() + 24 * 3_600_000);
    expect(decideDebit({ ...base, attempts: [failed(25, "51")] }).debit).toBe(true);
  });

  it("waits three days after a do-not-honour decline", () => {
    expect(decideDebit({ ...base, attempts: [failed(48, "05")] })).toMatchObject({ debit: false, reason: "retry_wait" });
    expect(decideDebit({ ...base, attempts: [failed(48, "25")] }).reason).toBe("retry_wait");
    expect(decideDebit({ ...base, attempts: [failed(73, "05")] }).debit).toBe(true);
  });

  it("measures the wait from the most recent failure, not the first", () => {
    expect(decideDebit({ ...base, attempts: [failed(100), failed(5)] })).toMatchObject({ debit: false, reason: "retry_wait" });
  });

  it("gives up after the maximum number of failed attempts", () => {
    const attempts = Array.from({ length: MAX_ATTEMPTS }, (_, i) => failed(500 + i * 30));
    expect(decideDebit({ ...base, attempts })).toMatchObject({ debit: false, reason: "attempts_exhausted" });
    expect(decideDebit({ ...base, attempts: attempts.slice(1) }).debit).toBe(true);
  });

  it("doesn't count rate-limit / never-sent / staff-resolved failures against the customer's attempts", () => {
    const attempts = Array.from({ length: MAX_ATTEMPTS + 2 }, (_, i) => failed(500 + i * 30, NOT_COUNTED_CODE));
    expect(decideDebit({ ...base, attempts }).debit).toBe(true);
    // ...but a recent one still makes it wait out the day.
    expect(decideDebit({ ...base, attempts: [failed(2, NOT_COUNTED_CODE)] })).toMatchObject({ debit: false, reason: "retry_wait" });
  });

  it("never collects from FCDA staff — payroll deduction handles them", () => {
    expect(decideDebit({ ...base, employer: "FCDA" }).reason).toBe("fcda_payroll");
    expect(decideDebit({ ...base, employer: "Federal Capital Development Authority, Abuja" }).reason).toBe("fcda_payroll");
  });

  it("checks FCDA before anything else, so a payroll customer with a live mandate is still skipped", () => {
    expect(decideDebit({ ...base, employer: "fcda", mandate: { status: "active", amountKobo: 1n, collectedKobo: 0n } }).reason).toBe("fcda_payroll");
  });
});

describe("helpers", () => {
  it("isFcdaEmployer matches the same wording the phone app does, and nothing looser", () => {
    expect(isFcdaEmployer(" FCDA ")).toBe(true);
    expect(isFcdaEmployer("Federal Capital Development Authority")).toBe(true);
    expect(isFcdaEmployer("FCDA Contractors Ltd")).toBe(false);
    expect(isFcdaEmployer(null)).toBe(false);
  });

  it("retryWaitHours: 72 for do-not-honour, otherwise 24", () => {
    expect([retryWaitHours("05"), retryWaitHours("25"), retryWaitHours("51"), retryWaitHours(null)]).toEqual([72, 72, 24, 24]);
  });

  it("failureExplanation is plain and specific where the code is known", () => {
    expect(failureExplanation("51", null)).toMatch(/enough money/);
    expect(failureExplanation("05", null)).toMatch(/declined/);
    expect(failureExplanation(null, "Account Blocked")).toBe("account blocked");
    expect(failureExplanation(null, null)).toMatch(/couldn't complete/);
  });

  it("mandateCapKobo is the limit plus 25%, or what's already owed if that's more", () => {
    expect(mandateCapKobo(10_000_000n, 0n)).toBe(12_500_000n);
    expect(mandateCapKobo(10_000_000n, 20_000_000n)).toBe(20_000_000n);
    expect(mandateCapKobo(0n, 0n)).toBe(0n);
  });
});
