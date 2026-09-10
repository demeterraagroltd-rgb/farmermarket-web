import type { MonoIncome, MonoTransaction } from "../integrations/mono/mono.types";

// The normalised summary a credit officer reads — computed from Mono's income
// insight when the product is enabled, otherwise from the raw statement.
// Naira-as-kobo integers, matching the rest of the money model.
export interface BankAnalysis {
  pulledAt: string;
  accountName: string | null;
  institution: string | null;
  balanceKobo: number | null;
  monthsAnalysed: number;
  salaryDetected: boolean;
  estimatedMonthlyIncomeKobo: number | null;
  incomeConfidence: "high" | "medium" | "low" | null;
  /** "regular" ≥80% of months, "partial" ≥50%, else "irregular". */
  salaryRegularity: "regular" | "partial" | "irregular" | null;
  /** Whether a salary-credit narration mentions the declared employer. null = no employer on file. */
  employerNameMatch: boolean | null;
  source: "income_api" | "statement" | "unavailable";
}

const SALARY_FLOOR_KOBO = 3_000_000; // ₦30,000 — below this we don't call it salary
const SALARY_KEYWORDS = /\b(salary|sal|payroll|wages|remuneration|stipend)\b/i;

function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** "ACME CORP LTD (NIGERIA)" → ["ACME","CORP"] — drop filler so a match is meaningful. */
function employerTokens(employer: string): string[] {
  return employer
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !["LTD", "LIMITED", "PLC", "NIG", "NIGERIA", "ENTERPRISE", "ENTERPRISES", "COMPANY", "AND", "THE"].includes(w));
}

export function analyseBank(
  income: MonoIncome | null,
  transactions: MonoTransaction[],
  opts: { accountName: string | null; institution: string | null; balanceKobo: number | null; employer?: string | null },
): BankAnalysis {
  const now = new Date().toISOString();
  const credits = transactions.filter((t) => t.type === "credit" && t.amountKobo > 0);
  const months = new Set(transactions.map((t) => monthKey(t.date)).filter(Boolean));
  const monthsAnalysed = months.size;

  // Largest credit per month — the salary candidate.
  const perMonthMax = new Map<string, MonoTransaction>();
  for (const c of credits) {
    const k = monthKey(c.date);
    if (!k) continue;
    const cur = perMonthMax.get(k);
    if (!cur || c.amountKobo > cur.amountKobo) perMonthMax.set(k, c);
  }
  const salaryCandidates = [...perMonthMax.values()].filter((c) => c.amountKobo >= SALARY_FLOOR_KOBO);

  // Employer-name match against any salary-ish credit narration.
  const tokens = opts.employer ? employerTokens(opts.employer) : [];
  const employerNameMatch = opts.employer
    ? credits.some((c) => tokens.some((tok) => c.narration.toUpperCase().includes(tok)))
    : null;

  // Prefer Mono's own income insight.
  if (income && (income.monthlyIncomeKobo ?? income.averageIncomeKobo)) {
    const est = income.monthlyIncomeKobo ?? income.averageIncomeKobo;
    return {
      pulledAt: now,
      accountName: opts.accountName,
      institution: opts.institution,
      balanceKobo: opts.balanceKobo,
      monthsAnalysed: monthsAnalysed || 6,
      salaryDetected: (est ?? 0) >= SALARY_FLOOR_KOBO,
      estimatedMonthlyIncomeKobo: est,
      incomeConfidence: income.confidence,
      salaryRegularity: income.confidence === "high" ? "regular" : income.confidence === "medium" ? "partial" : "irregular",
      employerNameMatch,
      source: "income_api",
    };
  }

  // Fall back to the statement.
  if (monthsAnalysed >= 2 && salaryCandidates.length >= 2) {
    const amounts = salaryCandidates.map((c) => c.amountKobo);
    const est = median(amounts);
    const near = amounts.filter((a) => Math.abs(a - est) <= est * 0.25).length;
    const coverage = salaryCandidates.length / monthsAnalysed;
    const keyworded = salaryCandidates.some((c) => SALARY_KEYWORDS.test(c.narration));
    return {
      pulledAt: now,
      accountName: opts.accountName,
      institution: opts.institution,
      balanceKobo: opts.balanceKobo,
      monthsAnalysed,
      salaryDetected: near >= 2,
      estimatedMonthlyIncomeKobo: est,
      incomeConfidence: keyworded && coverage >= 0.8 ? "high" : coverage >= 0.5 ? "medium" : "low",
      salaryRegularity: coverage >= 0.8 ? "regular" : coverage >= 0.5 ? "partial" : "irregular",
      employerNameMatch,
      source: "statement",
    };
  }

  return {
    pulledAt: now,
    accountName: opts.accountName,
    institution: opts.institution,
    balanceKobo: opts.balanceKobo,
    monthsAnalysed,
    salaryDetected: false,
    estimatedMonthlyIncomeKobo: null,
    incomeConfidence: null,
    salaryRegularity: null,
    employerNameMatch,
    source: transactions.length ? "statement" : "unavailable",
  };
}
