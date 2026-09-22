import { employerTokens } from "../kyc/bank-analysis";
import type { IncomeSource, IncomeSourcesResult } from "./income-sources";

// Two cheap, no-integration signals for "is this employer real": does the
// *name itself* read as a placeholder, and does the customer's own bank data
// actually show that employer paying them. Neither confirms a business is
// registered — that needs a registry lookup (CAC), deliberately out of scope
// here — so both are phrased as something for a human to weigh, not a verdict.

export interface EmployerNameCheck {
  suspicious: boolean;
  reasons: string[];
}

// Free text collected across many applications tends to repeat the same
// handful of non-answers. A name missing here is simply never flagged by this
// rule — the point is to catch the obvious cases cheaply, not every case.
const PLACEHOLDER_EXACT = new Set([
  "n a", "na", "none", "nil", "nothing", "test", "testing", "asdf", "idk",
  "unknown", "tbd", "pending", "company", "business", "employer", "my job",
  "abc", "abc company", "sample", "example", "xyz", "self",
]);

export function employerNameLooksReal(employer: string): EmployerNameCheck {
  const raw = employer.trim();
  if (!raw) return { suspicious: true, reasons: ["No employer name was given."] };

  const norm = raw.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const compact = norm.replace(/\s/g, "");
  const reasons: string[] = [];

  if (PLACEHOLDER_EXACT.has(norm)) reasons.push("Looks like a placeholder rather than a business name.");
  if (compact.length <= 2) reasons.push("Too short to identify a business.");
  else if (/^(.)\1+$/.test(compact)) reasons.push("Made up of one repeated character.");
  if (compact && /^\d+$/.test(compact)) reasons.push("Digits only, not a business name.");
  else if (compact && !/[a-z]/.test(compact)) reasons.push("Doesn't contain a recognisable name.");

  return { suspicious: reasons.length > 0, reasons };
}

export interface EmployerPaymentMatch {
  matched: boolean;
  /** The strongest of the customer's income sources that names this employer, if any. */
  source: IncomeSource | null;
}

/**
 * Does any of the customer's actual bank credits look like it came from the
 * declared employer? Reuses the same employer/narration matching as the
 * account-level snapshot ({@link employerTokens}), but against the fuller,
 * persisted transaction history rather than one sync's worth.
 */
export function employerPaymentMatch(employer: string | null | undefined, income: IncomeSourcesResult): EmployerPaymentMatch {
  if (!employer) return { matched: false, source: null };
  const tokens = employerTokens(employer);
  if (tokens.length === 0) return { matched: false, source: null };

  const hits = income.sources.filter((s) => s.samples.some((n) => tokens.some((tok) => n.toUpperCase().includes(tok))));
  if (hits.length === 0) return { matched: false, source: null };

  // A recurring, salary-shaped hit is stronger evidence than a one-off credit
  // that happens to share a word with the employer's name.
  const best = [...hits].sort(
    (a, b) => Number(b.likelySalary) - Number(a.likelySalary) || Number(b.recurring) - Number(a.recurring) || b.totalKobo - a.totalKobo,
  )[0];
  return { matched: true, source: best };
}
