import { describe, expect, it } from "vitest";
import { DEFAULT_SCORECARD, runScorecard, type ScorecardFactors } from "./scorecard";

// Reproducibility gate (§13): replaying an application against its own
// scorecard must reproduce the original score exactly.
describe("runScorecard", () => {
  const strongApplicant: ScorecardFactors = {
    employmentType: 1,
    employerVerification: 1,
    netSalary: 0.9,
    salaryConsistency: 0.9,
    debtToIncome: 0.8,
    bureau: 0.85,
    behavioural: 0,
  };

  it("is a pure function — same inputs always produce the same score", () => {
    const first = runScorecard(DEFAULT_SCORECARD, strongApplicant);
    const second = runScorecard(DEFAULT_SCORECARD, strongApplicant);
    expect(second).toEqual(first);
  });

  it("scores within the 300-850 range", () => {
    const { score } = runScorecard(DEFAULT_SCORECARD, strongApplicant);
    expect(score).toBeGreaterThanOrEqual(300);
    expect(score).toBeLessThanOrEqual(850);
  });

  it("flags low net salary with a reason code", () => {
    const weakApplicant: ScorecardFactors = { ...strongApplicant, netSalary: 0.1 };
    const { reasonCodes } = runScorecard(DEFAULT_SCORECARD, weakApplicant);
    expect(reasonCodes).toContain("LOW_NET_SALARY");
  });
});
