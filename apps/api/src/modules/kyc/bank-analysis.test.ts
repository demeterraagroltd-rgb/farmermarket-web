import { describe, expect, it } from "vitest";
import { analyseBank } from "./bank-analysis";
import type { MonoTransaction } from "../integrations/mono/mono.types";

const META = { accountName: "ADA OKONKWO", institution: "GTBank", balanceKobo: 4_500_000 };

function salaryHistory(months: number, amountKobo: number, narration = "SALARY - ACME CORP"): MonoTransaction[] {
  const now = new Date();
  const out: MonoTransaction[] = [];
  for (let m = 0; m < months; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 26);
    out.push({ amountKobo, type: "credit", narration, date: d.toISOString(), balanceKobo: null });
    out.push({
      amountKobo: 800_000,
      type: "debit",
      narration: "TRANSFER",
      date: d.toISOString(),
      balanceKobo: null,
    });
  }
  return out;
}

describe("analyseBank", () => {
  it("prefers Mono's income insight when present", () => {
    const a = analyseBank(
      { monthlyIncomeKobo: 30_000_000, averageIncomeKobo: 29_000_000, confidence: "high", lastIncomeDescription: "SALARY" },
      salaryHistory(3, 30_000_000),
      { ...META, employer: "Acme Corp" },
    );
    expect(a.source).toBe("income_api");
    expect(a.salaryDetected).toBe(true);
    expect(a.estimatedMonthlyIncomeKobo).toBe(30_000_000);
    expect(a.incomeConfidence).toBe("high");
    expect(a.salaryRegularity).toBe("regular");
  });

  it("detects a regular salary from the statement when there's no income API", () => {
    const a = analyseBank(null, salaryHistory(6, 25_000_000), { ...META, employer: "Acme Corp Ltd" });
    expect(a.source).toBe("statement");
    expect(a.salaryDetected).toBe(true);
    expect(a.estimatedMonthlyIncomeKobo).toBe(25_000_000);
    expect(a.salaryRegularity).toBe("regular");
    expect(a.monthsAnalysed).toBe(6);
  });

  it("matches the declared employer against the salary narration", () => {
    const withEmployer = analyseBank(null, salaryHistory(4, 20_000_000, "SAL/ACME CORP/JUN"), {
      ...META,
      employer: "ACME Corporation",
    });
    expect(withEmployer.employerNameMatch).toBe(true);

    const wrongEmployer = analyseBank(null, salaryHistory(4, 20_000_000, "SAL/ACME CORP/JUN"), {
      ...META,
      employer: "Globex Industries",
    });
    expect(wrongEmployer.employerNameMatch).toBe(false);
  });

  it("returns null for employer match when no employer was declared", () => {
    const a = analyseBank(null, salaryHistory(3, 15_000_000), { ...META, employer: null });
    expect(a.employerNameMatch).toBeNull();
  });

  it("does not call an irregular trickle of credits a salary", () => {
    const now = new Date();
    const txns: MonoTransaction[] = [
      { amountKobo: 500_000, type: "credit", narration: "TRANSFER FROM MUM", date: new Date(now.getFullYear(), now.getMonth(), 3).toISOString(), balanceKobo: null },
      { amountKobo: 1_200_000, type: "credit", narration: "REFUND", date: new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString(), balanceKobo: null },
    ];
    const a = analyseBank(null, txns, { ...META, employer: "Acme" });
    expect(a.salaryDetected).toBe(false);
    expect(a.estimatedMonthlyIncomeKobo).toBeNull();
  });

  it("reports 'unavailable' when there's nothing to work with", () => {
    const a = analyseBank(null, [], { ...META, employer: "Acme" });
    expect(a.source).toBe("unavailable");
    expect(a.salaryDetected).toBe(false);
  });

  it("drops filler words so an employer 'match' actually means something", () => {
    // "Nigeria" alone must not count as a match.
    const a = analyseBank(null, salaryHistory(3, 18_000_000, "SALARY BANK OF NIGERIA"), {
      ...META,
      employer: "Zenith Nigeria Ltd",
    });
    expect(a.employerNameMatch).toBe(false); // "ZENITH" isn't in the narration; "NIGERIA"/"LTD" are filler
  });
});
