import { describe, expect, it } from "vitest";
import { consentPayload, previewRepayment } from "./recova-policy";

const installments = [
  { dueDate: "2026-11-21", amountKobo: 2_200_000, paidKobo: 2_200_000 },
  { dueDate: "2026-12-21", amountKobo: 2_200_000, paidKobo: 0 },
  { dueDate: "2027-01-21", amountKobo: 2_200_000, paidKobo: 0 },
];
describe("Recova repayment policy", () => {
  it("rolls missed installments into collection without collecting future balances", () => {
    const p = previewRepayment({ installments, asOf: "2026-12-22T10:00:00+01:00" });
    expect(p).toMatchObject({ stage: "collection", outstandingKobo: 4_400_000, collectionTargetKobo: 2_200_000, futureKobo: 2_200_000, recoveryTargetKobo: 0 });
  });
  it("keeps the last due day in collection and switches eligibility at Nigeria midnight", () => {
    expect(previewRepayment({ installments, asOf: "2027-01-21T22:59:59Z" }).stage).toBe("collection");
    expect(previewRepayment({ installments, asOf: "2027-01-21T23:00:00Z" })).toMatchObject({ stage: "recovery", recoveryTargetKobo: 4_400_000, collectionTargetKobo: 0, additionalInterestKobo: 0, executionEnabled: false });
  });
  it("respects optional grace days", () => {
    expect(previewRepayment({ installments, asOf: "2027-01-22T10:00:00Z", graceDays: 5 }).stage).toBe("collection");
  });
  it("reduces recovery for partial payments and closes a fully paid agreement", () => {
    const partial = installments.map((r, i) => i === 1 ? { ...r, paidKobo: 1_000_000 } : r);
    expect(previewRepayment({ installments: partial, asOf: "2027-02-01T00:00:00Z" }).recoveryTargetKobo).toBe(3_400_000);
    expect(previewRepayment({ installments: installments.map((r) => ({ ...r, paidKobo: r.amountKobo })), asOf: "2027-02-01T00:00:00Z" }).stage).toBe("closed");
  });
  it.each(["pendingPayment", "unresolvedDebit"] as const)("holds both collection and recovery for %s", (flag) => {
    for (const asOf of ["2026-12-22T10:00:00Z", "2027-02-01T00:00:00Z"]) {
      expect(previewRepayment({ installments, asOf, [flag]: true })).toMatchObject({ collectionTargetKobo: 0, recoveryTargetKobo: 0 });
    }
  });
  it("rejects invalid dates, fractional kobo and overpayments", () => {
    for (const change of [{ dueDate: "2026-02-30" }, { amountKobo: 1.5 }, { paidKobo: 3_000_000 }]) {
      expect(() => previewRepayment({ installments: [{ ...installments[0], ...change }], asOf: "2027-01-01T00:00:00Z" })).toThrow();
    }
  });
});

describe("Recova consent mapping", () => {
  const input = {
    testDataConfirmed: true as const, tenureUnitsConfirmed: true as const,
    loanReference: "fm-sandbox-unit-test", customerID: "unit-test", customerName: "Sandbox Tester",
    customerEmail: "sandbox@example.test", phoneNumber: "08000000000", bvn: "00000000000",
    preferredRepaymentBankCBNCode: "000", preferredRepaymentAccount: "0000000000",
    loanAmountKobo: 6_000_000, loanTenure: 3, repaymentType: "Collection" as const,
    installments: installments.map(({ dueDate, amountKobo }) => ({ dueDate, amountKobo })),
  };
  it("converts kobo into provider naira and strips sandbox-only confirmations", () => {
    const p = consentPayload(input);
    expect(p).toMatchObject({ loanAmount: 60000, totalRepaymentExpected: 66000, repaymentType: "Collection" });
    expect(p.collectionPaymentSchedules[0]).toEqual({ repaymentDate: "2026-11-21T12:00:00+01:00", repaymentAmountInNaira: 22000 });
    expect(p).not.toHaveProperty("testDataConfirmed");
  });
  it("rejects production-looking references and unconfirmed test data", () => {
    expect(() => consentPayload({ ...input, loanReference: "real-customer-loan" })).toThrow();
    expect(() => consentPayload({ ...input, testDataConfirmed: false as unknown as true })).toThrow();
  });
});
