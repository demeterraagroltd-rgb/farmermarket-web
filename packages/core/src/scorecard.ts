/**
 * Deterministic, versioned rules scorecard (§8). No ML — there is no
 * repayment history to train on yet. This is a pure function: same inputs
 * and same `ScorecardDefinition` always produce the same output, which is
 * what makes a `scorecard_runs` replay reproducible in CI.
 */

export interface ScorecardFactors {
  /** 0–1: employer type score (e.g. Government = 1, Private = 0.6) */
  employmentType: number;
  /** 0–1: employer verification status */
  employerVerification: number;
  /** 0–1: net monthly salary, normalized against policy bands */
  netSalary: number;
  /** 0–1: months of regular salary credit, normalized */
  salaryConsistency: number;
  /** 0–1: inverse of debt-to-income ratio (1 = no debt) */
  debtToIncome: number;
  /** 0–1: bureau score & delinquency history, normalized */
  bureau: number;
  /** -1–1: behavioural adjustment from internal order/repayment history */
  behavioural: number;
}

export interface ScorecardWeights {
  employmentType: number;
  employerVerification: number;
  netSalary: number;
  salaryConsistency: number;
  debtToIncome: number;
  bureau: number;
}

export interface ScorecardDefinition {
  id: string;
  version: number;
  weights: ScorecardWeights;
  behaviouralWeight: number;
  policyCapKobo: Record<string, bigint>;
  salaryMultiplier: Record<string, number>;
}

export const DEFAULT_SCORECARD: ScorecardDefinition = {
  id: "default",
  version: 1,
  weights: {
    employmentType: 0.15,
    employerVerification: 0.1,
    netSalary: 0.2,
    salaryConsistency: 0.15,
    debtToIncome: 0.15,
    bureau: 0.2,
  },
  behaviouralWeight: 0.05,
  policyCapKobo: {
    A: 5_000_000n, // ₦50,000
  },
  salaryMultiplier: {
    A: 1.5,
  },
};

export interface ScorecardResult {
  score: number;
  band: string;
  reasonCodes: string[];
}

const SCORE_MIN = 300;
const SCORE_MAX = 850;

export function runScorecard(
  definition: ScorecardDefinition,
  factors: ScorecardFactors,
): ScorecardResult {
  const weighted =
    factors.employmentType * definition.weights.employmentType +
    factors.employerVerification * definition.weights.employerVerification +
    factors.netSalary * definition.weights.netSalary +
    factors.salaryConsistency * definition.weights.salaryConsistency +
    factors.debtToIncome * definition.weights.debtToIncome +
    factors.bureau * definition.weights.bureau +
    factors.behavioural * definition.behaviouralWeight;

  const clamped = Math.max(0, Math.min(1, weighted));
  const score = Math.round(SCORE_MIN + clamped * (SCORE_MAX - SCORE_MIN));

  const band = score >= 750 ? "A" : score >= 650 ? "B" : score >= 550 ? "C" : "D";

  const reasonCodes: string[] = [];
  if (factors.netSalary < 0.4) reasonCodes.push("LOW_NET_SALARY");
  if (factors.salaryConsistency < 0.4) reasonCodes.push("INCONSISTENT_SALARY_CREDIT");
  if (factors.debtToIncome < 0.4) reasonCodes.push("HIGH_DEBT_TO_INCOME");
  if (factors.bureau < 0.4) reasonCodes.push("BUREAU_DELINQUENCY");
  if (factors.employerVerification < 0.5) reasonCodes.push("EMPLOYER_UNVERIFIED");

  return { score, band, reasonCodes };
}
